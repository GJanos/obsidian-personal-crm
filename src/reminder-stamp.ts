import type { App } from "obsidian";

/**
 * When the startup reminder last showed, on this device only.
 *
 * It used to live in data.json, but both devices rewrite that stamp on start, and
 * a git merge of that one line invalidated the whole settings file (2026-11-04):
 * the plugin then loaded defaults and guessed a people folder. Obsidian's local
 * storage is per vault *and per device*, so it never reaches git.
 */
const KEY = "personal-crm:lastReminderAt";

/** The saved stamp in epoch ms, 0 when there is none (or storage is unavailable). */
export function loadReminderStamp(app: App): number {
	try {
		const raw: unknown = app.loadLocalStorage?.(KEY);
		const value = Number(raw ?? 0);
		return Number.isFinite(value) ? value : 0;
	} catch {
		return 0;
	}
}

/** Store the stamp. A blocked storage just means the reminder shows again next start. */
export function saveReminderStamp(app: App, at: number): void {
	try {
		app.saveLocalStorage?.(KEY, at);
	} catch {
		// Ignored on purpose: the stamp is an optimisation, not state worth failing over.
	}
}
