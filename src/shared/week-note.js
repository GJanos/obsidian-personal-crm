// THE WEEK NOTE FORMAT, as every plugin reads it (journal writes the notes, Full Calendar shows
// their highlights, Personal CRM dates the contacts in them).
//
// A week note is named by its ISO week (`2026-W43`) and holds seven days, each started by an
// italic day line (`*10-19*`), which may end in the day's block ID (`*10-19* ^d1019`) so an event
// note can link to the exact day (`[[2026-W43#^d1019|Mon, Oct 19]]`). Under a day: the mantra
// checkboxes, `h: …` highlights with their `e: …` details, then the private log. The week table (`| date | imp | gen | … |`) has a row per
// day (`| **10-19** | Y | 7 | … |`); imp = Y marks a big day.
//
// Source: plugin-tools/shared/week-note.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy. Pure functions only.

export const DAY_HEADING = /^\*(\d{2}-\d{2})\*(?:\s+\^d\d{4})?\s*$/;
export const HIGHLIGHT = /^h:\s*(.*)$/i;
export const EXTRA = /^e:\s*(.*)$/i;
export const CHECKBOX = /^\s*- \[.\]/;
export const WEEK_NAME = /^(\d{4})-W(\d{2})$/;

export const isYes = value => /^y$/i.test(value ?? "");

// The block ID of the day "MM-DD": d + MMDD ("08-18" → "d0818"). Unique inside a week note.
export const dayAnchor = monthDay => `d${monthDay.replace("-", "")}`;

// The note with every bare day line given its block ID (`*10-19*` → `*10-19* ^d1019`). Lines that
// have one, and everything else, stay as they are; line endings are kept.
export function withDayAnchors(content) {
    return content.replace(/^\*(\d{2}-\d{2})\*[ \t]*(\r?)$/gm, (_, day, cr) => `*${day}* ^${dayAnchor(day)}${cr}`);
}

export function lines(content) {
    return content.replace(/\r\n/g, "\n").split("\n");
}

export function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

// The day rows of the week table, cells keyed by lowercase header: [{ date: "MM-DD", cells: { imp,
// gen, … } }]. null when the note has no table.
export function parseTable(content) {
    const all = lines(content);
    const headerLine = all.find(line => /^\|\s*date\s*\|/i.test(line));
    if (!headerLine) return null;
    const headers = splitRow(headerLine).slice(1).map(header => header.toLowerCase());
    return all
        .filter(line => line.startsWith("| **"))
        .map(line => {
            const [first, ...rest] = splitRow(line);
            const cells = {};
            headers.forEach((header, i) => cells[header] = rest[i] ?? "");
            return { date: first.replace(/\*/g, "").trim(), cells };
        });
}

// The days of a week note in note order: [{ date: "MM-DD", line, highlights, firstLine }], `line`
// the 0-based line of the day heading. A filled h: line starts a highlight ({ headline, details,
// line }) and each filled e: line under it adds a detail; empty h:/e: placeholders and the
// checkboxes are skipped. `firstLine` is the day's first other line (its log), for weeks written
// before h:/e: existed.
export function weekDays(content) {
    const days = [];
    let day = null;
    let current = null;
    lines(content).forEach((raw, index) => {
        const heading = DAY_HEADING.exec(raw);
        if (heading) {
            day = { date: heading[1], line: index, highlights: [], firstLine: "" };
            days.push(day);
            current = null;
            return;
        }
        const line = raw.trim();
        if (!day || !line || CHECKBOX.test(line)) return;
        const highlight = HIGHLIGHT.exec(line);
        const extra = EXTRA.exec(line);
        if (highlight) {
            current = highlight[1].trim() ? { headline: highlight[1].trim(), details: [], line: index } : null;
            if (current) day.highlights.push(current);
        } else if (extra) {
            if (current && extra[1].trim()) current.details.push(extra[1].trim());
        } else if (!day.firstLine) {
            day.firstLine = line;
        }
    });
    return days;
}

// "YYYY-MM-DD" of a calendar date, or null when it isn't one ("2026-02-30").
function realDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

// The Monday ("YYYY-MM-DD") of an ISO week name ("2026-W43"); null when it isn't a real week
// (W00, or W53 in a 52-week year). Weeks run Monday to Sunday and belong to the year of their
// Thursday, so week 1 holds January 4.
export function isoWeekMonday(name) {
    const match = WEEK_NAME.exec(name ?? "");
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const mondayOf = w => {
        const jan4 = new Date(Date.UTC(year, 0, 4));
        return new Date(Date.UTC(year, 0, 4 + (w - 1) * 7 - (jan4.getUTCDay() + 6) % 7));
    };
    const monday = mondayOf(week);
    // The week's Thursday must fall in the named year.
    const thursday = new Date(monday.getTime() + 3 * 86400000);
    if (week < 1 || thursday.getUTCFullYear() !== year) return null;
    return monday.toISOString().slice(0, 10);
}

// The full date ("YYYY-MM-DD") of the day "MM-DD" in the week starting `monday` ("YYYY-MM-DD"). A
// December → January week puts its January days in the next year. null for a day that isn't one
// of the seven (a typo like *11-20* in W43, or *02-30*).
export function dateInWeek(monday, monthDay) {
    const match = /^(\d{2})-(\d{2})$/.exec(monthDay ?? "");
    if (!monday || !match) return null;
    const year = Number(monday.slice(0, 4)) + (Number(match[1]) < Number(monday.slice(5, 7)) ? 1 : 0);
    const date = realDate(year, Number(match[1]), Number(match[2]));
    if (!date) return null;
    const offset = (Date.parse(date) - Date.parse(monday)) / 86400000;
    return offset >= 0 && offset < 7 ? date : null;
}
