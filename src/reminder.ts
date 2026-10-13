import { addDays } from "./dates";
import type { PersonRecord } from "./types";

/** One day of the reminder: who falls due on it. */
export interface ReminderDay {
	date: string;
	/** Days from today: 0 is today. */
	offset: number;
	records: PersonRecord[];
}

export interface ReminderBuckets {
	/** Past their due date, most overdue first. */
	overdue: PersonRecord[];
	/** Today, then each following day up to the lookahead, empty ones included. */
	days: ReminderDay[];
	total: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Sort people into the daily reminder's sections.
 *
 * Status is not the test for a day, `overdueDays` is: the due-soon window is a
 * dashboard setting, and a lookahead longer than it should still show the people
 * it reaches. Status only rules people out — snoozed, paused or untracked.
 */
export function reminderBuckets(
	records: PersonRecord[],
	today: string,
	lookahead: number,
	tierOrder: string[],
): ReminderBuckets {
	const horizon = Math.max(0, Math.floor(lookahead));
	const rank = (r: PersonRecord) => {
		const i = r.tierId === null ? -1 : tierOrder.indexOf(r.tierId);
		return i < 0 ? tierOrder.length : i;
	};
	const byTierThenName = (a: PersonRecord, b: PersonRecord) =>
		rank(a) - rank(b) || a.name.localeCompare(b.name);

	const overdue: PersonRecord[] = [];
	const days: ReminderDay[] = [];
	for (let offset = 0; offset <= horizon; offset++) {
		days.push({ date: addDays(today, offset), offset, records: [] });
	}

	for (const r of records) {
		if (r.status === "snoozed" || r.status === "paused" || r.status === "untracked") continue;
		if (r.dueDate === null || !Number.isFinite(r.overdueDays)) continue;
		if (r.overdueDays > 0) overdue.push(r);
		else if (-r.overdueDays <= horizon) days[-r.overdueDays].records.push(r);
	}

	overdue.sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name));
	for (const d of days) d.records.sort(byTierThenName);

	const total = overdue.length + days.reduce((n, d) => n + d.records.length, 0);
	return { overdue, days, total };
}

/** "Today", "Tomorrow", then weekday and month-day: "Thu 10-15". */
export function dayLabel(date: string, offset: number): string {
	if (offset === 0) return "Today";
	if (offset === 1) return "Tomorrow";
	const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
	return `${weekday} ${date.slice(5)}`;
}

/** The pop-up shows on the first open of each day. */
export function shouldShowReminder(lastShown: string, today: string): boolean {
	return lastShown !== today;
}
