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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch(e => { console.error("SUITE ERROR:", e.stack); process.exit(1); });
