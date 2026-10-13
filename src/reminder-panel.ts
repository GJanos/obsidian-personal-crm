import type PrmPlugin from "./main";
import type { ReminderBuckets } from "./reminder";
import { dayLabel } from "./reminder";
import { appendIcon, renderPersonRow } from "./row";
import type { PersonRecord } from "./types";
import { todayISO } from "./dates";

/**
 * The daily reminder: who's overdue and who falls due in the next few days, as the
 * dashboard's own rows.
 *
 * A floating panel, not a modal: it blocks nothing behind it, so the vault stays
 * usable while it's up, and it stays until its X is clicked. The log and snooze
 * dialogs its rows open are modals, and sit above it.
 *
 * Acting on someone from here doesn't remove their row or re-sort the list: the row
 * is redrawn where it was, dimmed, so nothing jumps under the pointer.
 */
export class ReminderPanel {
	readonly el: HTMLElement;
	/** Each shown person's row container and the record it was opened with. */
	private slots = new Map<string, { el: HTMLElement; original: PersonRecord }>();
	/**
	 * People whose buttons were used here. Only these can show as done: a due date
	 * also moves when the index learns something on its own — week-note day lines
	 * read after startup did exactly that — and that is not the user's doing.
	 */
	private acted = new Set<string>();
	private unsubscribe: (() => void) | null = null;

	constructor(
		private plugin: PrmPlugin,
		private buckets: ReminderBuckets,
		private onClosed: () => void,
	) {
		this.el = createDiv({ cls: "prm-reminder-panel" });
		this.el.setAttribute("role", "dialog");
		this.el.setAttribute("aria-label", "Reach out");
	}

	open(): void {
		const { overdue, days, total } = this.buckets;
		const header = this.el.createDiv({ cls: "prm-reminder-header" });
		header.createDiv({ cls: "prm-reminder-title", text: "Reach out" });
		const close = header.createEl("button", { cls: "clickable-icon prm-reminder-close" });
		appendIcon(close, "x");
		close.setAttribute("aria-label", "Close");
		close.onclick = () => this.close();

		const body = this.el.createDiv({ cls: "prm-reminder-body" });
		const lookahead = days.length - 1;
		body.createDiv({
			cls: "prm-reminder-summary",
			text:
				`${total} ${total === 1 ? "person" : "people"}: ${overdue.length} overdue, ` +
				`${total - overdue.length} due ${
					lookahead === 0 ? "today" : `within ${lookahead} ${lookahead === 1 ? "day" : "days"}`
				}.`,
		});

		const today = todayISO();
		if (overdue.length > 0) this.section(body, `Overdue (${overdue.length})`, overdue, today);
		for (const day of days) {
			this.section(body, `${dayLabel(day.date, day.offset)} (${day.records.length})`, day.records, today);
		}

		const footer = body.createDiv({ cls: "prm-reminder-footer" });
		const dash = footer.createEl("button", { text: "Open dashboard" });
		dash.onclick = () => void this.plugin.openDashboard();

		this.unsubscribe = this.plugin.engine.onChange(() => this.refresh());
		activeDocument.body.appendChild(this.el);
	}

	close(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.slots.clear();
		this.el.remove();
		this.onClosed();
	}

	private section(parent: HTMLElement, heading: string, records: PersonRecord[], today: string): void {
		const section = parent.createDiv({ cls: "prm-reminder-section" });
		section.createDiv({ cls: "prm-reminder-heading", text: heading });
		const list = section.createDiv({ cls: "prm-reminder-list" });
		if (records.length === 0) {
			list.createDiv({ cls: "prm-reminder-nobody prm-muted", text: "nobody" });
			return;
		}
		for (const record of records) {
			const el = list.createDiv({ cls: "prm-reminder-slot" });
			this.slots.set(record.path, { el, original: record });
			this.drawRow(el, record, false, today);
		}
	}

	private drawRow(el: HTMLElement, record: PersonRecord, handled: boolean, today: string): void {
		const row = renderPersonRow(this.plugin, el, record, today, {
			showDueWhenOk: true,
			onAction: (r) => this.acted.add(r.path),
		});
		if (!handled) return;
		row.addClass("prm-row-done");
		// A snooze already says so on its own chip.
		if (record.status !== "snoozed") {
			row.querySelector(".prm-name-row")?.createSpan({ cls: "prm-chip prm-chip-done", text: "done" });
		}
	}

	/** Redraw every row in place from the fresh index, marking who was handled here. */
	private refresh(): void {
		const today = todayISO();
		for (const [path, slot] of this.slots) {
			const fresh = this.plugin.engine.get(path);
			const record = fresh ?? slot.original;
			const handled =
				this.acted.has(path) &&
				(fresh === null ||
					fresh.status === "snoozed" ||
					fresh.status === "paused" ||
					(fresh.dueDate ?? "") > (slot.original.dueDate ?? ""));
			slot.el.empty();
			this.drawRow(slot.el, record, handled, today);
		}
	}
}
