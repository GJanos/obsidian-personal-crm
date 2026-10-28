/** One bullet per day in the contact log; an older day never moves the last contact back. */
const Module = require("module");
const assert = require("assert");
const { makeStub, makeVault } = require("./stub-obsidian.cjs");
const harness = require("./build.cjs");

const notices = [];
const stub = makeStub(notices);
Module._load = ((orig) => (r, p, m) => (r === "obsidian" ? stub : orig(r, p, m)))(Module._load);
global.window = { setTimeout, clearTimeout, requestAnimationFrame: (f)=>setTimeout(f,0), cancelAnimationFrame: clearTimeout };

const PluginClass = harness.loadPlugin();

let passed=0, failed=0;
const check=(n,f)=>{try{f();console.log(`  ✓ ${n}`);passed++;}catch(e){console.error(`  ✗ ${n}\n     ${e.message}`);failed++;}};

(async () => {
  const v = makeVault();
  v.addFile("People/Sam.md", "---\ntags:\n  - people\nprm-tier: close\n---\n# Facts\n- met at a talk\n\n## Contact log\n- 2026-08-10 — coffee\n\n## Later\n- 2026-08-17 — not a log line\n");
  const plugin = new PluginClass(v.app, { id: "personal-crm" });
  plugin.__data = { configured: true, notifyOnStartup: false, showStatusBar: false, logToBody: true,
    linkDailyNoteInLog: false, personFolders: ["People"], journalSources: [] };
  await plugin.onload();
  plugin.engine.rebuild();
  const file = v.app.vault.getAbstractFileByPath("People/Sam.md");
  const text = () => v.store.get(file.path);
  const bullets = (date) => text().split("\n").filter((l) => l.startsWith(`- ${date}`));

  await plugin.logContact(file, "2026-08-17", "Talked over the phone", { merge: true });
  await plugin.logContact(file, "2026-08-17", "Talked over the phone", { merge: true });
  check("logging the same day twice keeps one bullet", () =>
    assert.deepStrictEqual(bullets("2026-08-17").slice(0, 1), ["- 2026-08-17 — Talked over the phone"]));
  check("a same-dated line under another heading isn't the log", () =>
    assert.ok(text().includes("## Later\n- 2026-08-17 — not a log line"), text()));

  await plugin.logContact(file, "2026-08-17", "lunch", { merge: true });
  check("a new note joins the day's bullet", () =>
    assert.ok(text().includes("- 2026-08-17 — Talked over the phone; lunch"), text()));

  await plugin.logContact(file, "2026-08-17", "Talked for an hour", { merge: true, previous: "Talked over the phone" });
  check("an edited note replaces its old text", () =>
    assert.ok(text().includes("- 2026-08-17 — Talked for an hour; lunch"), text()));

  await plugin.logContact(file, "2026-08-10", undefined, { merge: true });
  check("a day logged without a note stays as it was", () =>
    assert.ok(text().includes("- 2026-08-10 — coffee\n"), text()));

  await plugin.logContact(file, "2026-08-17", undefined, { merge: true, previous: "lunch" });
  check("a cleared note takes its old text out", () =>
    assert.ok(text().includes("- 2026-08-17 — Talked for an hour\n"), text()));
  await plugin.logContact(file, "2026-08-17", "Talked", { merge: true, previous: "Talked for an hour" });
  check("a shorter note still replaces the longer one", () =>
    assert.ok(text().includes("- 2026-08-17 — Talked\n"), text()));
  await plugin.logContact(file, "2026-08-17", "paid $& for it", { merge: true, previous: "Talked" });
  check("$ in a note is written as typed", () =>
    assert.ok(text().includes("- 2026-08-17 — paid $& for it\n"), text()));

  check("an older day doesn't move the last contact back", () =>
    assert.match(text().split("---")[1], /prm-last-contacted: ['"]?2026-08-17/));

  const before = text();
  await plugin.logContact(file, "2026-08-17", "and a walk", { merge: true });
  await plugin.performUndo();
  check("undo takes a merge back exactly", () => assert.strictEqual(text(), before));

  await plugin.logContact(file, "2026-08-17", "again");
  check("without merge every call adds a bullet, as upstream", () =>
    assert.strictEqual(bullets("2026-08-17").length, 3, text()));
  await plugin.logContact(file, "2026-08-01");
  check("without merge an older day still sets the last contact (a wrong date can be corrected)", () =>
    assert.match(text().split("---")[1], /prm-last-contacted: ['"]?2026-08-01/));

  console.log("\nLogging a day that lives in a week note links back to that day");
  {
    const w = makeVault();
    w.addFile("People/Sam.md", "---\ntags:\n  - people\nprm-tier: close\n---\n");
    w.addFile("Weeks/2026-W43.md", "*10-19* ^d1019\nquiet\n\n*10-23* ^d1023\ncall\n");
    const withWeeks = new PluginClass(w.app, { id: "personal-crm" });
    withWeeks.__data = { configured: true, notifyOnStartup: false, showStatusBar: false, logToBody: true,
      linkDailyNoteInLog: true, personFolders: ["People"],
      journalSources: [{ folder: "Weeks", format: "GGGG-[W]WW", dayLine: "^\\*(\\d{2}-\\d{2})\\*(?:\\s+\\^d\\d{4})?\\s*$" }] };
    await withWeeks.onload();
    withWeeks.engine.rebuild();
    await withWeeks.engine.whenDayLinesRead();
    const sam = w.app.vault.getAbstractFileByPath("People/Sam.md");
    await withWeeks.logContact(sam, "2026-10-23", "talked");
    check("the bullet jumps to the day's anchor", () =>
      assert.ok(w.store.get("People/Sam.md").includes("- [[2026-W43#^d1023|2026-10-23]] — talked"), w.store.get("People/Sam.md")));
    check("and the day it names is read back", () =>
      assert.ok(withWeeks.engine.get("People/Sam.md").contactDates.includes("2026-10-23")));
  }
  {
    const w = makeVault();
    w.addFile("People/Sam.md", "---\ntags:\n  - people\nprm-tier: close\n---\n");
    w.addFile("Weeks/2026-W43.md", "*10-19*\nquiet\n\n*10-23*\ncall\n");
    const noAnchors = new PluginClass(w.app, { id: "personal-crm" });
    noAnchors.__data = { configured: true, notifyOnStartup: false, showStatusBar: false, logToBody: true,
      linkDailyNoteInLog: true, personFolders: ["People"],
      journalSources: [{ folder: "Weeks", format: "GGGG-[W]WW", dayLine: "^\\*(\\d{2}-\\d{2})\\*(?:\\s+\\^d\\d{4})?\\s*$" }] };
    await noAnchors.onload();
    noAnchors.engine.rebuild();
    await noAnchors.engine.whenDayLinesRead();
    const sam = w.app.vault.getAbstractFileByPath("People/Sam.md");
    await noAnchors.logContact(sam, "2026-10-23", "talked");
    check("a day line without an anchor still links the week", () =>
      assert.ok(w.store.get("People/Sam.md").includes("- [[2026-W43|2026-10-23]] — talked"), w.store.get("People/Sam.md")));
  }

  console.log("\nRelinking old log dates to the day they name");
  {
    const w = makeVault();
    w.addFile("People/Sam.md", "---\ntags:\n  - people\nprm-tier: close\n---\n" +
      "# Facts\n- seen on 2026-10-23 elsewhere\n\n" +
      "## Contact log\n" +
      "- 2026-10-23 — call\n" +
      "- [[2026-10-19]] — older\n" +
      "- 2026-10-21 — bare, no anchor\n" +
      "- [[2026-10-20, standup|2026-10-20]] — an event note\n" +
      "- [[2026-10-18]] — no note that day\n\n" +
      "## Later\n- 2026-10-23 — not a log line\n");
    w.addFile("Weeks/2026-W43.md", "*10-19* ^d1019\nquiet\n\n*10-20*\nno anchor\n\n*10-21*\nplain\n\n*10-23* ^d1023\ncall\n");
    const relinker = new PluginClass(w.app, { id: "personal-crm" });
    relinker.__data = { configured: true, notifyOnStartup: false, showStatusBar: false, logToBody: true,
      linkDailyNoteInLog: true, personFolders: ["People"],
      journalSources: [{ folder: "Weeks", format: "GGGG-[W]WW", dayLine: "^\\*(\\d{2}-\\d{2})\\*(?:\\s+\\^d\\d{4})?\\s*$" }] };
    await relinker.onload();
    relinker.engine.rebuild();
    await relinker.engine.whenDayLinesRead();
    const before = w.store.get("People/Sam.md");

    await relinker.relinkLogDates();
    const after = w.store.get("People/Sam.md");

    check("a bare date becomes the week's day link", () =>
      assert.ok(after.includes(`- [[2026-W43#^d1023|2026-10-23]] — call`), after));
    check("a date link to its own note becomes the day anchor", () =>
      assert.ok(after.includes(`- [[2026-W43#^d1019|2026-10-19]] — older`), after));
    check("a day whose line has no anchor links the week", () =>
      assert.ok(after.includes(`- [[2026-W43|2026-10-21]] — bare, no anchor`), after));
    check("a link to another note that displays a date is left alone", () =>
      assert.ok(after.includes(`- [[2026-10-20, standup|2026-10-20]] — an event note`), after));
    check("a date no journal note holds keeps its bare text", () =>
      assert.ok(after.includes(`- 2026-10-18 — no note that day`), after));
    check("prose and other sections are untouched", () =>
      assert.ok(after.includes("# Facts\n- seen on 2026-10-23 elsewhere\n"), after));
    check("and a same-dated line under another heading", () =>
      assert.ok(after.includes("## Later\n- 2026-10-23 — not a log line"), after));
    await relinker.performUndo();
    check("undo puts every date back", () => assert.strictEqual(w.store.get("People/Sam.md"), before));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch(e => { console.error("SUITE ERROR:", e.stack); process.exit(1); });
