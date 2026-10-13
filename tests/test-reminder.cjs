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

const day = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ago = (n) => iso(Date.now() - n * day);

async function boot(build, settings = {}) {
  const v = makeVault();
  build(v);
  const p = new PluginClass(v.app, { id: "personal-crm" });
  p.__data = Object.assign({ configured: true, notifyOnStartup: true, showStatusBar: false,
    personFolders: ["People"], journalSources: [{ folder: "Daily", format: "YYYY-MM-DD" }] }, settings);
  const opened = [];
  const real = p.openReminder.bind(p);
  p.openReminder = () => { const m = real(); if (m) opened.push(m); return m; };
  await p.onload();
  await new Promise((r) => setTimeout(r, 10));
  return { plugin: p, opened, ...v };
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

  console.log("\nLabels and the once-a-day gate");
  check("today and tomorrow by name", () => {
    assert.strictEqual(R.dayLabel("2026-10-13", 0), "Today");
    assert.strictEqual(R.dayLabel("2026-10-14", 1), "Tomorrow");
  });
  check("later days by weekday and date", () => assert.strictEqual(R.dayLabel("2026-10-15", 2), "Thu 10-15"));
  check("shown once per day", () => {
    assert.strictEqual(R.shouldShowReminder("", TODAY), true);
    assert.strictEqual(R.shouldShowReminder("2026-10-12", TODAY), true);
    assert.strictEqual(R.shouldShowReminder(TODAY, TODAY), false);
  });

  console.log("\nStartup");
  {
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20));
    check("the first open of the day shows the pop-up", () => assert.strictEqual(opened.length, 1));
    check("and remembers the day", () => assert.strictEqual(plugin.settings.lastReminderDate, iso(Date.now())));
    check("no text notice any more", () =>
      assert.ok(!notices.some((n) => String(n).includes("reach out to"))));
    const content = JSON.stringify(opened[0].contentEl, (k, val) => (k === "parent" ? undefined : val));
    check("the pop-up lists the overdue person", () => assert.ok(content.includes("Akos")));
  }
  {
    const { plugin, opened, app } = await boot((v) => { seen(v, "Akos", 20); seen(v, "Bea", 30); });
    const modal = opened[0];
    const rows = () => modal.contentEl.querySelectorAll(".prm-row");
    const before = rows().map((r) => r.dataset.prmPath);
    await plugin.logContact(app.vault.getAbstractFileByPath("People/Akos.md"), iso(Date.now()));
    plugin.engine.rebuild();
    const after = rows();
    check("logging someone from the pop-up keeps every row where it was", () =>
      assert.deepStrictEqual(after.map((r) => r.dataset.prmPath), before));
    check("and marks only that row done", () =>
      assert.deepStrictEqual(after.filter((r) => r.classes.has("prm-row-done")).map((r) => r.dataset.prmPath),
        ["People/Akos.md"]));
  }
  {
    const { opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderDate: iso(Date.now()) });
    check("a second open the same day stays quiet", () => assert.strictEqual(opened.length, 0));
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
    const { plugin, opened } = await boot((v) => seen(v, "Akos", 20), { lastReminderDate: iso(Date.now()) });
    plugin.__cmds.find((c) => c.id === "show-reminder").callback();
    check("the command opens it regardless of the day gate", () => assert.strictEqual(opened.length, 1));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
