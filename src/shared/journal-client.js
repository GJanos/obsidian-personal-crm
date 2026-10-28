// How a plugin reaches the Journal plugin's log: through its versioned API, looked up at call time
// (so plugin load order doesn't matter). Version 2 adds addDayLine(date, { style, name, note }), the
// one writer for a line in a day. Without Journal, or with another version, callers get null and
// keep their own behaviour — no log line, no menu item.
//
// Source: plugin-tools/shared/journal-client.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.
// globals: none

const ID = "journal";
const VERSION = 2;

/**
 * @typedef {{ style: "line" | "highlight", name: string, note?: string }} DayLine
 * @typedef {{ version: number,
 *   logToday: (text: string) => Promise<void>,
 *   logOn: (date: Date, text: string) => Promise<void>,
 *   addDayLine: (date: Date, entry: DayLine) => Promise<boolean> }} JournalApi
 */

// Journal's API (version 2), or null when the plugin is missing, disabled or another version.
/**
 * @param {unknown} app the Obsidian app (its `plugins` field is not in the public type)
 * @returns {JournalApi | null}
 */
export function journalApi(app) {
    const host = /** @type {{ plugins?: { getPlugin?: (id: string) => { api?: { version?: number } } | null } } | undefined } */ (app);
    const api = host?.plugins?.getPlugin?.(ID)?.api;
    return api?.version === VERSION ? /** @type {JournalApi} */ (api) : null;
}
