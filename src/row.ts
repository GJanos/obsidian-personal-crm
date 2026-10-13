import { TFile, setIcon } from "obsidian";
import type PrmPlugin from "./main";
import { tierById } from "./settings";
import type { PersonRecord, PersonStatus } from "./types";
import { formatDuration, relativeToToday, todayISO } from "./dates";
import { LogContactModal, PersonActionsModal, SnoozeModal, TierPickerModal } from "./modals";

/**
 * One person's row, as the dashboard draws it.
 *
 * Shared by the dashboard and the daily reminder, so the pop-up shows the same row
 * as the main page instead of a look-alike that drifts. The dashboard's own powers —
 * selection, and filtering by a tag or place — come in as hooks; without them the
 * row is plain: those chips don't click, and a click on the row opens its actions.
 */
export interface RowHooks {
	selection?: {
		has(path: string): boolean;
		/** The checkbox's click; only a click carries the shift modifier. */
		onBoxClick(path: string, evt: MouseEvent, box: HTMLInputElement): void;
		/** Ctrl/Cmd or shift click on the row body. */
		toggle(path: string, shift: boolean): void;
	};
	/** Clicking a `#tag` or a place filters to it. */
	toggleQuery?: (query: string) => void;
	showBirthday?: boolean;
	/**
	 * Say when an on-track person falls due. The reminder's lookahead can reach
	 * past the due-soon window; on the dashboard an on-track row has no chip.
	 */
	showDueWhenOk?: boolean;
}

export const STATUS_LABEL: Record<PersonStatus, string> = {
	overdue: "overdue",
	"due-soon": "due soon",
	ok: "on track",
	snoozed: "snoozed",
	paused: "paused",
	untracked: "unclassified",
};

/**
 * One built SVG per icon name, cloned thereafter.
 *
 * Three icon buttons per row means setIcon() runs once per button — 9,000 times on a
 * 3,000-person list — and building an SVG is an order of magnitude dearer than
 * cloning one. Measured on 9,000 icons: 24.6 ms to build each, 12.6 ms to clone,
 * against 3.7 ms for the same number of plain divs. Lucide glyphs are drawn in
 * `currentColor` and don't vary by theme or state, so one is as good as another.
 */
const iconTemplates = new Map<string, Element>();

export function appendIcon(el: HTMLElement, name: string): void {
	let template = iconTemplates.get(name);
	if (template === undefined) {
		const probe = createDiv();
		setIcon(probe, name);
		const built = probe.firstElementChild;
		// An unknown icon name inserts nothing; fall through to setIcon each time
		// rather than caching a miss.
		if (!built) {
			setIcon(el, name);
			return;
		}
		template = built;
		iconTemplates.set(name, built);
	}
	el.appendChild(template.cloneNode(true));
}

export function iconButton(
	parent: HTMLElement,
	icon: string,
	tooltip: string,
	onClick: () => void | Promise<void>,
): void {
	const btn = parent.createEl("button", { cls: "clickable-icon prm-icon-btn" });
	appendIcon(btn, icon);
	btn.setAttribute("aria-label", tooltip);
	btn.onclick = () => void onClick();
}

export function renderPersonRow(
	plugin: PrmPlugin,
	list: HTMLElement,
	record: PersonRecord,
	today: string,
	hooks: RowHooks = {},
): HTMLElement {
	const { selection, toggleQuery } = hooks;
	const tier = tierById(plugin.settings, record.tierId);
	const row = list.createDiv({ cls: `prm-row prm-row-${record.status}` });
	row.dataset.prmPath = record.path;
	if (selection) row.toggleClass("prm-row-selected", selection.has(record.path));
	const bar = row.createDiv({ cls: "prm-bar" });
	const fill = bar.createDiv({ cls: "prm-bar-fill" });
	fill.style.setProperty("--prm-progress", `${Math.round(record.cadenceProgress * 100)}%`);
	if (tier) fill.style.setProperty("--prm-chip-color", tier.color);

	const main = row.createDiv({ cls: "prm-row-main" });

	const nameRow = main.createDiv({ cls: "prm-name-row" });

	if (selection) {
		// Inside the name row rather than a leading column of the row: under
		// ~700px the row stacks into a column, and a direct child there would
		// stretch to full width. Sidebar leaves are routinely that narrow.
		const check = nameRow.createEl("input", {
			cls: "prm-select",
			attr: { type: "checkbox", "aria-label": `Select ${record.name}` },
		});
		check.checked = selection.has(record.path);
		// Bind on click, not change: only a click carries the shift modifier.
		check.onclick = (evt) => selection.onBoxClick(record.path, evt, check);
	}

	const link = nameRow.createEl("a", { cls: "prm-name", text: record.name });
	link.onclick = (evt) => {
		evt.preventDefault();
		void plugin.openPerson(record, evt.metaKey || evt.ctrlKey);
	};

	// A button, not a <select>: one dropdown per row with an option per tier was
	// nearly half of all render cost.
	const tierBtn = nameRow.createEl("button", {
		cls: tier ? "prm-chip prm-chip-button" : "prm-chip prm-chip-button prm-chip-muted",
		text: record.tierMissing
			? `unknown tier: ${record.tierId}`
			: tier
				? tier.label
				: "unclassified",
	});
	if (tier) tierBtn.style.setProperty("--prm-chip-color", tier.color);
	if (record.tierMissing) tierBtn.addClass("prm-chip-overdue");
	tierBtn.setAttribute("aria-label", `Change cadence for ${record.name}`);
	tierBtn.onclick = () => new TierPickerModal(plugin, record).open();

	if (record.status === "overdue") {
		nameRow.createSpan({
			cls: "prm-chip prm-chip-overdue",
			text:
				record.overdueDays === 0
					? "due today"
					: `overdue ${formatDuration(record.overdueDays)}`,
		});
	} else if (record.status === "due-soon") {
		nameRow.createSpan({
			cls: "prm-chip prm-chip-soon",
			text: `due in ${formatDuration(record.overdueDays)}`,
		});
	} else if (hooks.showDueWhenOk && record.status === "ok" && record.dueDate) {
		nameRow.createSpan({
			cls: "prm-chip prm-chip-muted",
			text: `due in ${formatDuration(record.overdueDays)}`,
		});
	} else if (record.status === "snoozed" && record.snoozeUntil) {
		nameRow.createSpan({
			cls: "prm-chip prm-chip-muted",
			text: `snoozed to ${record.snoozeUntil}`,
		});
	}

	if (record.drifting) {
		const chip = nameRow.createSpan({ cls: "prm-chip prm-chip-drift", text: "drifting" });
		chip.setAttribute(
			"aria-label",
			record.typicalGapDays === null
				? "Quieter than usual"
				: `You normally talk every ${formatDuration(record.typicalGapDays)}`,
		);
	}

	if (record.openLoops.length > 0) {
		nameRow.createSpan({
			cls: "prm-chip prm-chip-loop",
			text:
				record.openLoops.length === 1
					? "1 follow-up"
					: `${record.openLoops.length} follow-ups`,
		});
	}

	const meta = main.createDiv({ cls: "prm-row-meta" });
	if (record.lastContact) {
		const last = meta.createEl("a", {
			cls: "prm-meta-link",
			text: `last ${relativeToToday(record.lastContact, today)}`,
		});
		last.onclick = (evt) => {
			evt.preventDefault();
			void plugin.openInteraction(record, record.lastContact as string);
		};
	} else if (record.baselineSource === "filesystem") {
		// Urgency derived from a file timestamp shouldn't look like real data:
		// sync and git clone both reset it.
		meta.createSpan({ cls: "prm-muted", text: "no contact history (estimated)" });
	} else {
		meta.createSpan({ text: "never in contact" });
	}

	if (record.cadenceDays !== null) {
		meta.createSpan({ text: `every ${formatDuration(record.cadenceDays)}` });
	}
	if (record.mentionCount > 0) {
		meta.createSpan({ text: `${record.mentionCount}× mentioned` });
	}
	if (hooks.showBirthday && record.daysUntilBirthday !== null) {
		meta.createSpan({
			cls: "prm-birthday",
			text:
				record.daysUntilBirthday === 0
					? "birthday today"
					: `birthday in ${formatDuration(record.daysUntilBirthday)}`,
		});
	}
	if (record.relationship) meta.createSpan({ text: record.relationship });

	if (record.location) {
		if (toggleQuery) {
			const place = meta.createEl("a", { cls: "prm-place", text: record.location });
			place.setAttribute("aria-label", `Show everyone in ${record.location}`);
			place.onclick = (evt) => {
				evt.preventDefault();
				toggleQuery(`@${record.location}`);
			};
		} else {
			meta.createSpan({ cls: "prm-place", text: record.location });
		}
	}

	for (const tag of record.tags) {
		if (toggleQuery) {
			const chip = meta.createEl("a", { cls: "prm-tag", text: `#${tag}` });
			chip.setAttribute("aria-label", `Filter by ${tag}`);
			chip.onclick = (evt) => {
				evt.preventDefault();
				// Clicking a tag filters to it; clicking the same one again clears.
				toggleQuery(`#${tag}`);
			};
		} else {
			meta.createSpan({ cls: "prm-tag", text: `#${tag}` });
		}
	}

	const actions = row.createDiv({ cls: "prm-row-actions" });

	iconButton(actions, "check", "Log contact today", async () => {
		const file = plugin.app.vault.getAbstractFileByPath(record.path);
		if (file instanceof TFile) await plugin.logContact(file, todayISO());
	});

	iconButton(actions, "pencil", "Log contact with details…", () => {
		new LogContactModal(plugin, record).open();
	});

	iconButton(actions, "alarm-clock", "Snooze", () => {
		new SnoozeModal(plugin, record).open();
	});

	row.setAttribute("aria-label", `${record.name} — ${STATUS_LABEL[record.status]}`);

	row.onclick = (evt) => {
		// Links, buttons and the checkbox own their own clicks; the row only
		// handles what's left, so nothing here shadows an existing control.
		if ((evt.target as HTMLElement).closest("a, button, input, textarea, select")) return;

		// Cmd/Ctrl is the conventional multi-select modifier, and shift extends
		// a range — matching the checkboxes and every file list users know.
		if (selection && (evt.metaKey || evt.ctrlKey)) {
			selection.toggle(record.path, false);
			return;
		}
		if (selection && evt.shiftKey) {
			selection.toggle(record.path, true);
			return;
		}
		new PersonActionsModal(plugin, record).open();
	};

	return row;
}
