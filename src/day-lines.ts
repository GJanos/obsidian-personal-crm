import type { App, TFile } from "obsidian";
import { type DayLine, parseDayLines } from "./journal";

interface Entry {
	mtime: number;
	pattern: string;
	days: DayLine[];
}

/**
 * Where each day starts inside multi-day notes (week notes with a `*MM-DD*` line
 * per day), read from the files themselves.
 *
 * This is the one place the index depends on file text, which bends invariant
 * 3.1 on purpose: the day lines are plain italics, so the metadata cache has no
 * record of them. It stays cheap because only sources with a day-line pattern
 * are read (a week note is ~52 files a year), each file is read once per
 * modification, and the reading happens off the rebuild: `get` answers from
 * memory or queues the file, the engine dates that note by its filename for one
 * pass, and `flush` reads the queue and asks for a rebuild that can use it.
 */
export class DayLineIndex {
	private entries = new Map<string, Entry>();
	private queued = new Map<string, { file: TFile; pattern: RegExp }>();
	private reading: Promise<void> | null = null;

	constructor(
		private app: App,
		private onLoaded: () => void,
	) {}

	/** The note's day lines if they're known for its current version; otherwise queue a read. */
	get(file: TFile, pattern: RegExp): DayLine[] | null {
		const entry = this.entries.get(file.path);
		if (entry && entry.mtime === file.stat.mtime && entry.pattern === pattern.source) {
			return entry.days;
		}
		this.queued.set(file.path, { file, pattern });
		return null;
	}

	/** Read everything `get` queued, then request one rebuild. A no-op while a read runs. */
	flush(): void {
		if (this.reading || this.queued.size === 0) return;
		const batch = [...this.queued.values()];
		this.queued.clear();
		this.reading = this.read(batch).finally(() => {
			this.reading = null;
			this.onLoaded();
		});
	}

	/** Resolves once no read is running, including reads the follow-up rebuild started. */
	async settled(): Promise<void> {
		while (this.reading) await this.reading;
	}

	private async read(batch: { file: TFile; pattern: RegExp }[]): Promise<void> {
		for (const { file, pattern } of batch) {
			// Taken before the read: if the note changes mid-read, the stored mtime is
			// already stale and the next rebuild reads it again.
			const mtime = file.stat.mtime;
			let days: DayLine[] = [];
			try {
				days = parseDayLines(await this.app.vault.cachedRead(file), pattern);
			} catch {
				// Remember the failure as "no day lines" for this version of the file.
				// Leaving it unknown would queue it again on the very rebuild this read
				// triggers, and that would loop for as long as the file can't be read.
			}
			this.entries.set(file.path, { mtime, pattern: pattern.source, days });
		}
	}
}
