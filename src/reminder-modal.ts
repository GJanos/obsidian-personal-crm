import type PrmPlugin from "./main";
import { PrmModal } from "./modals";
import { dayLabel, type ReminderBuckets } from "./reminder";
import { renderPersonRow } from "./row";
import type { PersonRecord } from "./types";
import { todayISO } from "./dates";

/**
 * The daily reminder: who's overdue and who falls due in the next few days, as the
 * dashboard's own rows.
 *
 * It stays until it's dismissed on purpose — X or Escape. A click on the backdrop
 * is too easily a stray click on the way to the note behind it.
 *
 * Handling someone from here doesn't remove their row or re-sort the list: the row
 * is redrawn where it was, dimmed, so nothing jumps under the pointer.
 */
export class ReminderModal extends PrmModal {
	/** Each shown person's row container and the record it was opened with. */
	private slots = new Map<string, { el: HTMLElement; original: PersonRecord }>();
	private unsubscribe: (() => void) | null = null;

	constructor(
		private plugin: PrmPlugin,
		private buckets: ReminderBuckets,
	) {
		super(plugin.app);
		this.modalEl.addClass("prm-reminder-modal");
	}

	onOpen(): void {
		// Capture on the container runs before Obsidian's own backdrop handler.
		this.containerEl.addEventListener(
			"click",
			(evt) => {
				if ((evt.target as HTMLElement).hasClass?.("modal-bg")) evt.stopImmediatePropagation();
			},
			true,
		);

		const { overdue, days, total } = this.buckets;
		this.titleEl.setText("Reach out");
		const { contentEl } = this;
		contentEl.addClass("prm-reminder");
		const lookahead = days.length - 1;
		contentEl.createDiv({
			cls: "prm-reminder-summary",
			text:
				`${total} ${total === 1 ? "person" : "people"}: ${overdue.length} overdue, ` +
				`${total - overdue.length} due ${
					lookahead === 0 ? "today" : `within ${lookahead} ${lookahead === 1 ? "day" : "days"}`
				}.`,
		});

		const today = todayISO();
		if (overdue.length > 0) this.section(`Overdue (${overdue.length})`, overdue, today);
		for (const day of days) {
			this.section(`${dayLabel(day.date, day.offset)} (${day.records.length})`, day.records, today);
		}

		const footer = contentEl.createDiv({ cls: "prm-reminder-footer" });
		const dash = footer.createEl("button", { text: "Open dashboard" });
		dash.onclick = () => {
			this.close();
			void this.plugin.openDashboard();
		};

		this.unsubscribe = this.plugin.engine.onChange(() => this.refresh());
	}

	onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.slots.clear();
		this.contentEl.empty();
	}

	private section(heading: string, records: PersonRecord[], today: string): void {
		const section = this.contentEl.createDiv({ cls: "prm-reminder-section" });
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
		const row = renderPersonRow(this.plugin, el, record, today, { showDueWhenOk: true });
		if (!handled) return;
		row.addClass("prm-row-done");
		// A snooze already says so on its own chip.
		if (record.status !== "snoozed") {
			row.querySelector(".prm-name-row")?.createSpan({ cls: "prm-chip prm-chip-done", text: "done" });
		}
	}

	/** Redraw every row in place from the fresh index, marking who was handled. */
	private refresh(): void {
		const today = todayISO();
		for (const [path, slot] of this.slots) {
			const fresh = this.plugin.engine.get(path);
			const record = fresh ?? slot.original;
			const handled =
				fresh === null ||
				fresh.status === "snoozed" ||
				fresh.status === "paused" ||
				(fresh.dueDate ?? "") > (slot.original.dueDate ?? "");
			slot.el.empty();
			this.drawRow(slot.el, record, handled, today);
		}
	}
}
