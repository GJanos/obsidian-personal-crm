/** The daily reach-out pop-up: who's overdue and who's due in the next few days. */
const Module = require("module");
const assert = require("assert");
const { makeStub, makeVault } = require("./stub-obsidian.cjs");
const harness = require("./build.cjs");
const notices = [];
const stub = makeStub(notices);
Module._load = ((o) => (r, p, m) => (r === "obsidian" ? stub : o(r, p, m)))(Module._load);
global.window = { setTimeout, clearTimeout,
  requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout };
const R = require(harness.bundleModule("src/reminder.ts"));
const PluginClass = harness.loadPlugin();

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n     ${e.message}`); failed++; } };

const TODAY = "2026-10-13"; // a Tuesday
const TIERS = ["inner", "close", "mid"];
const rec = (name, overdueDays, extra = {}) => ({
  path: `People/${name}.md`, name, tierId: "mid", status: overdueDays >= 0 ? "overdue" : "due-soon",
  dueDate: "2026-01-01", overdueDays, ...extra,
});
const names = (list) => list.map((r) => r.name);
const lastModal = () => globalThis.__lastModal;

const day = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ago = (n) => iso(Date.now() - n * day);
/** Today by the local clock, as the plugin's todayISO has it. */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function boot(build, settings = {}, options = {}) {
  delete global.window.__pluginStartupQueue;
  const v = makeVault();
  build(v);
  const p = new PluginClass(v.app, { id: "personal-crm" });
  p.__data = Object.assign({ configured: true, notifyOnStartup: true, showStatusBar: false,
    personFolders: ["People"], journalSources: [{ folder: "Daily", format: "YYYY-MM-DD" }] }, settings);
  const opened = [];
  p.domEvents = [];
  p.registerDomEvent = (target, type, handler) => p.domEvents.push({ target, type, handler });
  const real = p.openReminder.bind(p);
  p.openReminder = () => { const m = real(); if (m) opened.push(m); return m; };
  await p.onload();
  await new Promise((r) => setTimeout(r, 10));
  return { plugin: p, opened, ...(options.take === false ? {} : takeQueue()), ...v };
}

/**
 * The startup panel waits its turn in the shared startup queue: take its turn now instead of after
 * the queue's settle time. What was queued, and each show's promise (settles when it closes).
 */
function takeQueue() {
  const queue = global.window.__pluginStartupQueue;
  const queued = queue ? queue.items.map(({ id, priority }) => ({ id, priority })) : [];
  const shown = [];
  if (queue) {
    clearTimeout(queue.timer);
    for (const item of queue.items.splice(0)) shown.push(item.show());
  }
  return { queued, shown };
}

/** Someone on the 14-day "inner" tier last seen `n` days ago: due in 14 - n days. */
function seen(v, name, n) {
  v.addFile(`People/${name}.md`, "---\ntags:\n  - people\nprm-tier: inner\n---\n");
  v.addFile(`Daily/${ago(n)}.md`, `met [[${name}]]\n`);
}

(async () => {
  console.log("Buckets");
  {
    const b = R.reminderBuckets([
      rec("Old", 30), rec("Recent", 2), rec("Today", 0), rec("Tomorrow", -1),
      rec("InThree", -3), rec("InFour", -4),
    ], TODAY, 3, TIERS);
    check("overdue holds only people past their due date, most overdue first", () =>
      assert.deepStrictEqual(names(b.overdue), ["Old", "Recent"]));
    check("one day per offset from today through the lookahead", () =>
      assert.deepStrictEqual(b.days.map((d) => d.offset), [0, 1, 2, 3]));
    check("each person lands on their due day", () =>
      assert.deepStrictEqual(b.days.map((d) => names(d.records)), [["Today"], ["Tomorrow"], [], ["InThree"]]));
    check("the days carry their dates", () =>
      assert.deepStrictEqual(b.days.map((d) => d.date), ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]));
    check("beyond the lookahead is left out, and the total counts what's shown", () =>
      assert.strictEqual(b.total, 5));
  }

  console.log("\nWho is left out");
  {
    const b = R.reminderBuckets([
      rec("Snoozed", 5, { status: "snoozed" }), rec("Paused", 5, { status: "paused" }),
      rec("Untracked", 0, { status: "untracked", dueDate: null }), rec("Ok", -2, { status: "ok" }),
    ], TODAY, 3, TIERS);
    check("snoozed, paused and untracked are not reminders", () =>
      assert.deepStrictEqual(names(b.overdue), []));
    check("someone outside the due-soon window but inside the lookahead still shows", () =>
      assert.deepStrictEqual(names(b.days[2].records), ["Ok"]));
  }

  console.log("\nOrdering inside a day");
  {
    const b = R.reminderBuckets([
      rec("Zed", 0, { tierId: "inner" }), rec("Bea", 0, { tierId: "mid" }),
      rec("Ann", 0, { tierId: "mid" }), rec("Cy", 0, { tierId: "close" }),
      rec("Nobody", 0, { tierId: null }),
    ], TODAY, 0, TIERS);
    check("closest tier first, then name; unknown tiers last", () =>
      assert.deepStrictEqual(names(b.days[0].records), ["Zed", "Cy", "Ann", "Bea", "Nobody"]));
    check("lookahead 0 is just today", () => assert.strictEqual(b.days.length, 1));
  }

  console.log("\nLabels and the interval gate");
  check("today and tomorrow by name", () => {
    assert.strictEqual(R.dayLabel("2026-10-13", 0), "Today");
    assert.strictEqual(R.dayLabel("2026-10-14", 1), "Tomorrow");
  });
  check("later days by weekday and date", () => assert.strictEqual(R.dayLabel("2026-10-15", 2), "Thu 10-15"));
  check("shown once per interval", () => {
    const at = (h) => new Date(2026, 9, 13, h).getTime(), now = at(22);
    assert.strictEqual(R.shouldShowReminder(0, now, 8), true);
    assert.strictEqual(R.shouldShowReminder(at(14), now, 8), true);
    assert.strictEqual(R.shouldShowReminder(at(15), now, 8), false);
    assert.strictEqual(R.shouldShowReminder(at(15), now, 6), true);
  });
  check("and on the first open of a new day, within the interval too", () => {
    const yesterday = new Date(2026, 9, 12, 23).getTime(), today = new Date(2026, 9, 13, 1).getTime();
    assert.strictEqual(R.shouldShowReminder(yesterday, today, 24), true);
    assert.strictEqual(R.shouldShowReminder(today, today + 3600000, 24), false);
  });
  check("a last-shown time in the future (another device's clock) doesn't silence it", () =>
    assert.strictEqual(R.shouldShowReminder(Date.now() + day, Date.now(), 8), true));

  console.log("\nStartup");
  {
    const { plugin, opened, queued, shown } = await boot((v) => seen(v, "Akos", 20));
    check("the pop-up takes its turn in the shared startup queue, first", () =>
      assert.deepStrictEqual(queued, [{ id: "personal-crm", priority: 10 }]));
    check("the first open shows the pop-up", () => assert.strictEqual(opened.length, 1));
    check("and remembers when", () => assert.ok(Date.now() - plugin.lastReminderAt < 5000));
    check("no text notice any more", () =>
      assert.ok(!notices.some((n) => String(n).includes("reach out to"))));
    const content = JSON.stringify(opened[0].el, (k, val) => (k === "parent" ? undefined : val));
    check("the pop-up lists the overdue person", () => assert.ok(content.includes("Akos")));
    check("it floats on the page rather than opening a modal", () =>
      assert.ok(activeDocument.body.children.includes(opened[0].el)));
    opened[0].close();
    check("X takes it off the page", () => assert.ok(!activeDocument.body.children.includes(opened[0].el)));
    let settled = false;
    await Promise.race([shown[0].then(() => { settled = true; }), new Promise((r) => setTimeout(r, 50))]);
    check("and lets the queue move on", () => assert.ok(settled));
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20));
    plugin.__cmds.find((c) => c.id === "show-reminder").callback();
    check("opening it again replaces the panel instead of stacking a second", () =>
      assert.strictEqual(activeDocument.body.children.filter((c) => c.classes.has("prm-reminder-panel")).length, 1));
    opened.at(-1).close();
  }
  {
    const { plugin, opened, shown } = await boot((v) => seen(v, "Akos", 20));
    let settled = false;
    shown[0].then(() => { settled = true; });
    plugin.__cmds.find((c) => c.id === "show-reminder").callback(); // replace the queued panel
    await new Promise((r) => setTimeout(r, 20));
    check("replacing it keeps the queue waiting for the new panel", () => assert.strictEqual(settled, false));
    opened.at(-1).close();
    await new Promise((r) => setTimeout(r, 20));
    check("and the replacement's close moves the queue on", () => assert.strictEqual(settled, true));
  }
  {
    const { plugin } = await boot((v) => seen(v, "Akos", 20), {}, { take: false });
    check("a queued reminder isn't counted as shown before it shows", () =>
      assert.ok(!plugin.lastReminderAt));
    check("unloading drops the queued reminder", () => {
      assert.strictEqual(global.window.__pluginStartupQueue.items.length, 1);
      plugin.onunload();
      assert.strictEqual(global.window.__pluginStartupQueue.items.length, 0);
    });
  }
  {
    const { plugin } = await boot((v) => seen(v, "Akos", 20), {}, { take: false });
    const { shown } = takeQueue();
    await new Promise((r) => setTimeout(r, 20));
    check("once it shows, the interval starts", () => assert.ok(plugin.lastReminderAt > 0));
    plugin.reminderPanel?.close();
    await shown[0];
  }
  {
    const { plugin, opened, app } = await boot((v) => { seen(v, "Akos", 20); seen(v, "Bea", 30); });
    const panel = opened[0];
    const rows = () => panel.el.querySelectorAll(".prm-row");
    const done = () => rows().filter((r) => r.classes.has("prm-row-done")).map((r) => r.dataset.prmPath);
    const before = rows().map((r) => r.dataset.prmPath);

    // Logged somewhere else — the dashboard, a note — is news, not something done here.
    await plugin.logContact(app.vault.getAbstractFileByPath("People/Bea.md"), iso(Date.now()));
    plugin.engine.rebuild();
    check("a change made elsewhere doesn't mark the row done", () => assert.deepStrictEqual(done(), []));

    const akos = rows().find((r) => r.dataset.prmPath === "People/Akos.md");
    const logBtn = akos.querySelectorAll("button").find((b) => b.attrs["aria-label"] === "Log contact today");
    await logBtn.onclick();
    await new Promise((r) => setTimeout(r, 10));
    plugin.engine.rebuild();
    check("logging someone from the pop-up keeps every row where it was", () =>
      assert.deepStrictEqual(rows().map((r) => r.dataset.prmPath), before));
    check("and marks that row done", () => assert.deepStrictEqual(done(), ["People/Akos.md"]));
    panel.close();
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20));
    const panel = opened[0];
    const D = require(harness.bundleModule("src/dates.ts"));
    const row = () => panel.el.querySelectorAll(".prm-row").find((r) => r.dataset.prmPath === "People/Akos.md");
    const skipOf = (r) => r.querySelectorAll("button").find((b) => String(b.attrs["aria-label"]).startsWith("Skip this week"));
    const skip = skipOf(row());
    check("each row has a one-click Skip this week", () => assert.ok(skip));
    await skip.onclick();
    await new Promise((r) => setTimeout(r, 10));
    plugin.engine.rebuild();
    check("which snoozes them to next Monday", () =>
      assert.strictEqual(plugin.engine.get("People/Akos.md").snoozeUntil, D.nextMonday(todayLocal())));
    check("and marks the row done, in place", () => assert.ok(row().classes.has("prm-row-done")));
    check("a handled row has no Skip button", () => assert.ok(!skipOf(row())));
    panel.close();
  }
  {
    // Seen on the Sunday of a week note, k days ago, with a k-day cadence: due today.
    // Dated by the week's Monday instead, they'd be six days overdue.
    let k = 7;
    while (new Date(Date.now() - k * day).getUTCDay() !== 0) k++;
    const sunday = ago(k);
    // The ISO week is the one its Thursday falls in.
    const thursday = new Date(Date.parse(sunday) - 3 * day);
    const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((thursday - yearStart) / day + 1) / 7);
    const weekNote = `Weeks/${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}.md`;
    const { opened } = await boot((v) => {
      v.addFile("People/Dad.md", `---\ntags:\n  - people\nprm-tier: inner\nprm-cadence: ${k}\n---\n`);
      v.addFile(weekNote, `*${sunday.slice(5)}*\ncalled [[Dad]]\n`);
    }, { journalSources: [{ folder: "Weeks", format: "GGGG-[W]WW", dayLine: "^\\*(\\d{2}-\\d{2})\\*\\s*$" }] });
    const panel = opened[0];
    const section = (label) => panel.el.querySelectorAll(".prm-reminder-section")
      .find((s) => s.children[0].text.startsWith(label));
    const paths = (s) => s.querySelectorAll(".prm-row").map((r) => r.dataset.prmPath);
    check("startup waits for week-note day lines: due today, not overdue", () => {
      assert.ok(panel, "no panel opened");
      assert.strictEqual(section("Overdue"), undefined);
      assert.deepStrictEqual(paths(section("Today")), ["People/Dad.md"]);
    });
    check("and is not marked done", () =>
      assert.strictEqual(panel.el.querySelectorAll(".prm-row-done").length, 0));
    panel?.close();
  }
  {
    // A minute ago, so it's the same day too (unless this runs in the first minute after midnight).
    const { opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderAt: Date.now() - 60000 });
    check("an open within the interval stays quiet", () => assert.strictEqual(opened.length, 0));
  }
  {
    const { opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderAt: Date.now() - 9 * 3600000 });
    check("an open after the interval (8h by default) shows it again", () => assert.strictEqual(opened.length, 1));
    opened[0]?.close();
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderAt: Date.now() - 60000 });
    const focus = plugin.domEvents.filter((e) => e.type === "focus");
    check("it listens for the window coming back", () => assert.strictEqual(focus.length, 1));
    focus[0].handler();
    check("which stays quiet within the interval", () => assert.strictEqual(opened.length, 0));
    plugin.lastReminderAt = Date.now() - 9 * 3600000;
    focus[0].handler();
    takeQueue();
    check("and shows it once the interval has passed", () => assert.strictEqual(opened.length, 1));
    focus[0].handler();
    check("but not over one already open", () => assert.deepStrictEqual([opened.length, takeQueue().queued], [1, []]));
    opened[0].close();
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderDate: todayLocal() });
    check("seen today under the old once-a-day stamp counts as seen", () => assert.strictEqual(opened.length, 0));
    check("and the retired date leaves data.json with the rewrite", () =>
      assert.strictEqual(plugin.__data.lastReminderDate, undefined));
  }
  {
    const { plugin } = await boot((v) => seen(v, "Akos", 20), { lastReminderAt: Date.now() - 60000 });
    check("the retired settings stamp moves to device-local storage and leaves data.json", () => {
      assert.ok(plugin.lastReminderAt > 0);
      assert.strictEqual(plugin.__data.lastReminderAt, undefined);
    });
  }
  {
    const { plugin: big } = await boot(() => {}, { reminderIntervalHours: 1000 });
    const { plugin: small } = await boot(() => {}, { reminderIntervalHours: 0.4 });
    const { plugin: bad } = await boot(() => {}, { reminderIntervalHours: "soon" });
    check("a hand-edited interval is held to 1–24 whole hours", () =>
      assert.deepStrictEqual([big, small, bad].map((p) => p.settings.reminderIntervalHours), [24, 1, 8]));
  }
  {
    const { opened } = await boot((v) => seen(v, "Akos", 1));
    check("nobody due in the window: no pop-up", () => assert.strictEqual(opened.length, 0));
  }
  {
    const { opened } = await boot((v) => seen(v, "Akos", 20), { notifyOnStartup: false });
    check("the startup toggle still turns it off", () => assert.strictEqual(opened.length, 0));
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderAt: Date.now() });
    plugin.__cmds.find((c) => c.id === "show-reminder").callback();
    check("the command opens it regardless of the interval gate", () =>assert.strictEqual(opened.length, 1));
  }

  console.log("\nReview fixes");
  {
    // Disabled (or reloaded) before the week notes' day lines are read: the startup
    // reminder must not open afterwards, on a plugin that can no longer close it.
    const v = makeVault();
    seen(v, "Akos", 20);
    const p = new PluginClass(v.app, { id: "personal-crm" });
    p.__data = { configured: true, notifyOnStartup: true, showStatusBar: false,
      personFolders: ["People"], journalSources: [{ folder: "Daily", format: "YYYY-MM-DD" }] };
    const panels = () => activeDocument.body.children.filter((c) => c.classes.has("prm-reminder-panel")).length;
    const before = panels();
    await p.onload();
    p.onunload();
    await new Promise((r) => setTimeout(r, 20));
    check("unloaded during startup: no reminder is left on the page", () =>
      assert.strictEqual(panels(), before));
  }
  {
    const { plugin, opened, app } = await boot((v) => seen(v, "Akos", 20));
    const panel = opened[0];
    const row = () => panel.el.querySelectorAll(".prm-row").find((r) => r.dataset.prmPath === "People/Akos.md");
    const button = (label) => row().querySelectorAll("button").find((b) => b.attrs["aria-label"] === label);

    button("Snooze").onclick();
    lastModal().close();
    // Logged elsewhere afterwards: the due date moves, but nothing was done here.
    await plugin.logContact(app.vault.getAbstractFileByPath("People/Akos.md"), iso(Date.now()));
    plugin.engine.rebuild();
    check("Snooze opened and cancelled doesn't mark the row done", () =>
      assert.strictEqual(row().classes.has("prm-row-done"), false));

    button("Log contact with details…").onclick();
    lastModal().close();
    plugin.engine.rebuild();
    check("nor does the details dialog, cancelled", () =>
      assert.strictEqual(row().classes.has("prm-row-done"), false));
    panel.close();
  }
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20));
    const panel = opened[0];
    const row = () => panel.el.querySelectorAll(".prm-row").find((r) => r.dataset.prmPath === "People/Akos.md");
    row().querySelectorAll("button").find((b) => b.attrs["aria-label"] === "Snooze").onclick();
    lastModal().onChooseSuggestion({ label: "1 week", days: 7 });
    await new Promise((r) => setTimeout(r, 10));
    plugin.engine.rebuild();
    check("a snooze actually chosen still marks it", () => assert.ok(row().classes.has("prm-row-done")));
    panel.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
