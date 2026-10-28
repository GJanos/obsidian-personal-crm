/**
 * What a logged contact asks of the Journal plugin.
 *
 * The writing itself is Journal's: a line in a day's week note is note editing, and Journal owns
 * that shape (api v2, `addDayLine`). The CRM decides only whether to ask — a log on a day that
 * already names the person is not written twice — and what shape to ask for:
 *
 * - `line`: a plain bullet in the day's log, `- Met [[Sam]] — coffee`.
 * - `highlight`: the shape Journal's Day entry writes for a person met, `h: Met [[Sam]]` with one
 *   `e:` detail per note line.
 * - `none`: nothing (and no Journal call at all).
 *
 * A date whose week note doesn't exist is left alone: Journal starts its own weeks, a logger
 * doesn't. Everything here stays pure: text in, answer out.
 */

/** How a logged contact reaches the day's journal note. */
export type JournalLogStyle = "line" | "highlight" | "none";

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

/**
 * Does the day `monthDay` ("MM-DD") of a week note already name `name` anywhere — the With line,
 * a highlight, the private log? A day says you saw someone once, however many times the reminder
 * was clicked, so that day is left alone.
 */
export function dayMentions(content: string, pattern: RegExp, monthDay: string, name: string): boolean {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => pattern.exec(line.trim())?.[1] === monthDay);
	if (start === -1) return false;
	const next = lines.findIndex((line, i) => i > start && pattern.test(line.trim()));
	const end = next === -1 ? lines.length : next;
	for (let i = start; i < end; i++) if (linksName(bare(lines[i]), name)) return true;
	return false;
}
