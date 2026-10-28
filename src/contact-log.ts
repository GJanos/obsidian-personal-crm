/**
 * One entry per day in a person's contact log, for callers that ask for it.
 *
 * The Journal plugin's Day entry saves a day as often as it is edited, so logging a
 * day the log already has adds to that day's bullet instead of writing a second one,
 * and an edited note replaces its old text rather than piling up next to it.
 */

/** A log bullet: "- 2026-10-17", "- [[2026-10-17]]" or "- [[Note|2026-10-17]]", then " — the note". */
const LOG_LINE = /^[-*] (?:\[\[(?:[^\]|]*\|)?(\d{4}-\d{2}-\d{2})\]\]|(\d{4}-\d{2}-\d{2}))(?: — (.*))?\s*$/;

/** Where `date`'s bullet is between `from` and `to` (offsets of the log section): its first line. */
export interface LogEntry {
	start: number;
	/** Offset of the line's end, before any `\r`. */
	end: number;
	line: string;
}

export function findLogEntry(content: string, from: number, to: number, date: string): LogEntry | null {
	let start = from;
	while (start < to) {
		const newline = content.indexOf("\n", start);
		const next = newline === -1 || newline >= to ? to : newline + 1;
		const end = newline === -1 || newline >= to ? to : content[newline - 1] === "\r" ? newline - 1 : newline;
		const line = content.slice(start, end);
		const match = LOG_LINE.exec(line);
		if (match && (match[1] ?? match[2]) === date) return { start, end, line };
		start = next;
	}
	return null;
}

/**
 * A bullet's line with `note` in it. When the line has `previous` (the day's earlier
 * note) the note takes its place, so an edited note replaces the old text and a
 * cleared one removes it. Otherwise it is added after "; " (after " — " when the bullet
 * has no note yet), unless the line already says it (case aside). A multi-line note
 * joins into one line.
 */
export function mergeLogNote(line: string, note: string, previous = ""): string {
	const added = note.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).join(" ");
	const text = LOG_LINE.exec(line)?.[3]?.trim() ?? "";
	const head = text ? line.slice(0, line.lastIndexOf(text)).replace(/ — $/, "") : line.trimEnd();
	const withText = (next: string): string => (next ? `${head} — ${next}` : head);
	const old = previous.trim();
	if (text && old && text.includes(old)) {
		const next = text
			.replace(old, () => added)
			.replace(/(?:;\s*){2,}/g, "; ")
			.replace(/^\s*;\s*|\s*;\s*$/g, "")
			.trim();
		return withText(next);
	}
	if (!added || text.toLowerCase().includes(added.toLowerCase())) return line;
	return withText(text ? `${text}; ${added}` : added);
}

/** A bullet's date as a bare date or a link whose target is the date itself. */
const RELINKABLE_DATE = /^([-*]) (?:\[\[(\d{4}-\d{2}-\d{2})\]\]|(\d{4}-\d{2}-\d{2}))/;

/**
 * The line with its log date replaced by `token(date)`, when the bullet starts with
 * one. Only a bare date and a link whose target is the date itself are rewritten: a
 * `[[Note|2026-10-17]]` link points at another note, and rewriting it would lose that.
 * A line whose date already reads as `token` comes back unchanged.
 */
export function relinkLogLine(line: string, token: (date: string) => string): string {
	const match = RELINKABLE_DATE.exec(line);
	if (!match) return line;
	const date = match[2] ?? match[3];
	const current = match[0].slice(2);
	const next = token(date);
	return next === current ? line : `${match[1]} ${next}${line.slice(match[0].length)}`;
}
