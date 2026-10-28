/**
 * Writing a logged contact into the day's journal note.
 *
 * The other direction already works: the index reads a dated note's links, so a day
 * that names someone counts as contact. This is the reverse — a contact logged in the
 * CRM becomes a line in that day, so the journal records the conversation too.
 *
 * Two shapes, chosen per log. A plain line is free text in the day's log
 * (`- Met [[Sam]] — coffee`). A highlight is the shape the Journal plugin's Day entry
 * writes for a person met (`h: Met [[Sam]]` with one `e:` detail per note line), so
 * the two writers produce the same note and neither reads as a duplicate of the other.
 *
 * Only a day inside a multi-day note is written: it has a day section a line can go
 * into. A note titled by the date (a daily note, an event) has no such structure and is
 * left alone — the CRM is not the note's author.
 *
 * Everything here is pure: content in, content out.
 */

/** How a logged contact reaches the day's journal note. */
export type JournalLogStyle = "line" | "highlight" | "none";

const HIGHLIGHT = /^h:\s*(.*)$/i;
const EXTRA = /^e:\s*(.*)$/i;
const EMPTY_HIGHLIGHT = /^h:\s*$/i;
const EMPTY_EXTRA = /^e:\s*$/i;
const CHECKBOX = /^\s*- \[.\]/;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Is `name` linked in `text` — as `[[Name]]`, `[[Name|alias]]` or `[[folder/Name|alias]]`?
 * The vault's own link form, not a substring match, so "Sam" isn't credited for "Samara".
 */
export function linksName(text: string, name: string): boolean {
	const re = new RegExp(
		`\\[\\[\\s*(?:[^\\]|]*/)?${escapeRegExp(name)}\\s*(?:\\|[^\\]]*)?\\]\\]`,
	);
	return re.test(text);
}

/** A line as written, without the `\r` a CRLF file keeps after the split. */
const bare = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

/** The lines of the day `monthDay` ("MM-DD"): its day line, and where the next one starts. */
function daySection(
	lines: string[],
	pattern: RegExp,
	monthDay: string,
): { start: number; end: number } | null {
	const start = lines.findIndex((line) => pattern.exec(line.trim())?.[1] === monthDay);
	if (start === -1) return null;
	const next = lines.findIndex((line, i) => i > start && pattern.test(line.trim()));
	return { start, end: next === -1 ? lines.length : next };
}

/**
 * The note with a contact logged on `date`, or null when no day holds that date.
 *
 * Logging the same person twice on a day merges into the line or highlight already
 * there rather than adding a second: a day says you saw someone once, however many
 * times the reminder was clicked. Someone already named anywhere in the day (a
 * private-log sentence, a `With` line) is left alone — the day already records it.
 */
export function addJournalEntry(
	content: string,
	pattern: RegExp,
	date: string,
	name: string,
	style: JournalLogStyle,
	note = "",
): string | null {
	if (style === "none") return content;
	const lines = content.split("\n");
	const section = daySection(lines, pattern, date.slice(5));
	if (!section) return null;

	const eol = content.includes("\r\n") ? "\r" : "";
	const details = note
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	return style === "highlight"
		? highlightDay(lines, section, eol, name, details)
		: lineDay(lines, section, eol, name, details);
}

/** The existing `- Met [[name]] — …` bullet in the day, if there is one. */
function metBullet(lines: string[], section: { start: number; end: number }, name: string): number {
	const re = new RegExp(
		`^[-*]\\s+Met\\s+\\[\\[\\s*(?:[^\\]|]*/)?${escapeRegExp(name)}\\s*(?:\\|[^\\]]*)?\\]\\](?:\\s+—\\s+(.*))?$`,
	);
	for (let i = section.start + 1; i < section.end; i++) if (re.test(bare(lines[i]))) return i;
	return -1;
}

/** The day with a plain `- Met [[name]] — note` line, appended at its end. */
function lineDay(
	lines: string[],
	section: { start: number; end: number },
	eol: string,
	name: string,
	details: string[],
): string {
	const body = details.join("; ");
	const at = metBullet(lines, section, name);
	if (at !== -1) {
		const line = bare(lines[at]);
		const have = /—\s*(.*)$/.exec(line)?.[1]?.trim() ?? "";
		if (!body || have.toLowerCase().includes(body.toLowerCase())) return lines.join("\n");
		lines[at] = have ? `- Met [[${name}]] — ${have}; ${body}${eol}` : `- Met [[${name}]] — ${body}${eol}`;
		return lines.join("\n");
	}
	for (let i = section.start + 1; i < section.end; i++) {
		if (linksName(bare(lines[i]), name)) return lines.join("\n");
	}

	// At the day's end, above the blank lines before the next day — the same place the
	// Journal plugin puts its own day log.
	let last = section.end - 1;
	while (last > section.start && !bare(lines[last]).trim()) last--;

	// A day that is only its mantras: the line starts the body, under the blank line
	// that separates the checkboxes from it.
	let bodyStart = section.start + 1;
	while (bodyStart < section.end && CHECKBOX.test(bare(lines[bodyStart]).trim())) bodyStart++;
	let hasBody = false;
	for (let i = bodyStart; i < section.end && !hasBody; i++) hasBody = bare(lines[i]).trim().length > 0;

	const bullet = body.length > 0 ? `- Met [[${name}]] — ${body}` : `- Met [[${name}]]`;
	const gap = !hasBody && bodyStart > section.start + 1 ? [""] : [];
	lines.splice(last + 1, 0, ...gap, `${bullet}${eol}`);
	return lines.join("\n");
}

/** The day with a `h: Met [[name]]` highlight and one `e:` per detail line. */
function highlightDay(
	lines: string[],
	section: { start: number; end: number },
	eol: string,
	name: string,
	details: string[],
): string {
	// The highlight already naming them: new detail lines join its own.
	let at = -1;
	for (let i = section.start + 1; i < section.end && at === -1; i++) {
		const headline = HIGHLIGHT.exec(bare(lines[i]).trim())?.[1];
		if (headline && linksName(headline, name)) at = i;
	}
	if (at !== -1) {
		let last = at;
		while (last + 1 < section.end && EXTRA.test(bare(lines[last + 1]).trim())) last++;
		const have = new Set(
			lines.slice(at + 1, last + 1).map((line) => EXTRA.exec(bare(line).trim())?.[1]?.trim() ?? ""),
		);
		const add = details.filter((detail) => !have.has(detail));
		if (add.length === 0) return lines.join("\n");
		lines.splice(last + 1, 0, ...add.map((detail) => `e: ${detail}${eol}`));
		return lines.join("\n");
	}
	for (let i = section.start + 1; i < section.end; i++) {
		if (linksName(bare(lines[i]), name)) return lines.join("\n");
	}

	const headline = `h: Met [[${name}]]`;
	// The day template's empty h: placeholder is where a highlight was meant to go.
	let empty = -1;
	for (let i = section.start + 1; i < section.end; i++) {
		if (EMPTY_HIGHLIGHT.test(bare(lines[i]).trim())) {
			empty = i;
			break;
		}
	}
	if (empty !== -1) {
		lines[empty] = `${headline}${eol}`;
		let next = empty + 1;
		const add = [...details];
		if (next < section.end && EMPTY_EXTRA.test(bare(lines[next]).trim())) {
			if (add.length > 0) lines[next++] = `e: ${add.shift()}${eol}`;
			else lines.splice(next, 1);
		}
		lines.splice(next, 0, ...add.map((detail) => `e: ${detail}${eol}`));
		return lines.join("\n");
	}

	// Right after the day's run of h:/e: lines, else under the mantra gap above the
	// private log — the Journal plugin's own placement, so the two never interleave.
	const isHighlightLine = (i: number): boolean => {
		const line = bare(lines[i]).trim();
		return !CHECKBOX.test(line) && (HIGHLIGHT.test(line) || EXTRA.test(line));
	};
	let after = section.start;
	let first = section.start + 1;
	while (first < section.end && !isHighlightLine(first)) first++;
	if (first < section.end) {
		after = first;
		while (after + 1 < section.end && isHighlightLine(after + 1)) after++;
	} else {
		while (after + 1 < section.end && CHECKBOX.test(bare(lines[after + 1]).trim())) after++;
		if (after + 1 < section.end && !bare(lines[after + 1]).trim()) after++;
	}
	const gap = CHECKBOX.test(bare(lines[after]).trim()) ? [""] : [];
	lines.splice(after + 1, 0, ...gap, `${headline}${eol}`, ...details.map((d) => `e: ${d}${eol}`));
	return lines.join("\n");
}
