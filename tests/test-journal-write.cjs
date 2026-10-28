/** Logging a contact asks the Journal plugin to write it into that day's week note. */
const Module = require("module");
const assert = require("assert");
const { makeStub, makeVault } = require("./stub-obsidian.cjs");
const harness = require("./build.cjs");

const notices = [];
const stub = makeStub(notices);
Module._load = ((orig) => (r, p, m) => (r === "obsidian" ? stub : orig(r, p, m)))(Module._load);
global.window = { setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout };

const PluginClass = harness.loadPlugin();

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n     ${e.message}`); failed++; } };

const WEEKS = [{ folder: "Weeks", format: "GGGG-[W]WW",
  dayLine: "^\\*(\\d{2}-\\d{2})\\*(?:\\s+\\^d\\d{4})?\\s*$" }];

const WEEK = [
  "*10-26* ^d1026",
  "quiet",
  "",
  "*10-28* ^d1028",
  "- [ ] walk",
  "",
  "h: Shipped the CRM fix",
  "e: finally",
  "With [[Ana]] (lunch)",
  "- private note",
  "",
  "*10-29* ^d1029",
  "",
].join("\n");

// What Journal's api v2 was asked to write.
const writes = [];

/** A fake Journal whose api v2 records each request; `version` other than 2 stands for an old build. */
function fakeJournal(version = 2, answer = true) {
  writes.length = 0;
  return { api: { version, addDayLine: async (date, entry) => { writes.push({ date, ...entry }); return answer; } } };
}

async function boot(files, settings = {}, journal = fakeJournal()) {
  const v = makeVault();
  for (const [path, content] of Object.entries(files)) v.addFile(path, content);
  const plugin = new PluginClass(v.app, { id: "personal-crm" });
  plugin.__data = Object.assign({ configured: true, notifyOnStartup: false, showStatusBar: false,
    logToBody: false, personFolders: ["People"], journalSources: WEEKS }, settings);
  await plugin.onload();
  plugin.engine.rebuild();
  await plugin.engine.whenDayLinesRead();
  plugin.engine.rebuild();
  plugin.app.plugins = { getPlugin: (id) => (id === "journal" ? journal : null) };
  return { plugin, ...v };
}

const SAM = { "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n", "Weeks/2026-W44.md": WEEK };

(async () => {
  console.log("\nA log asks Journal for a line in that day");
  {
    const { plugin, store } = await boot(SAM);
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("one request, the day at noon, the setting's shape", () =>
      assert.deepStrictEqual(writes.map(({ date, style, name, note }) =>
        [date.toISOString().slice(0, 10), style, name, note]), [["2026-10-28", "line", "Sam", "coffee"]]));
    check("the week note is Journal's to change, the CRM wrote nothing", () =>
      assert.strictEqual(store.get("Weeks/2026-W44.md"), WEEK));
  }

  console.log("\nThe per-log shape, and the highlight style");
  {
    const { plugin } = await boot(SAM, { journalLogStyle: "highlight" });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "a note\nsecond line");
    check("highlight with the note as details", () =>
      assert.deepStrictEqual([writes[0].style, writes[0].note], ["highlight", "a note\nsecond line"]));
  }

  console.log("\nA day that already names the person is left alone");
  {
    // 10-28 carries `With [[Ana]]`; logging Ana that day asks Journal for nothing.
    const ana = "---\ntags:\n  - people\nprm-tier: close\n---\n";
    const { plugin } = await boot({ ...SAM, "People/Ana.md": ana });
    const file = plugin.app.vault.getAbstractFileByPath("People/Ana.md");
    await plugin.logContact(file, "2026-10-28", "lunch");
    check("nothing asked of Journal", () => assert.deepStrictEqual(writes, []));
    check("the contact is still logged", () =>
      assert.match(plugin.app.vault.getAbstractFileByPath("People/Ana.md").path, /Ana/));
  }

  console.log("\nThe journal's own Day entry never writes back");
  {
    const { plugin } = await boot(SAM);
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "from the day entry", { merge: true });
    check("merge: true asks Journal for nothing", () => assert.deepStrictEqual(writes, []));
  }

  console.log("\nTurning it off, or no Journal at all");
  {
    const { plugin, store } = await boot(SAM, { journalLogStyle: "none" });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("off asks Journal for nothing", () => assert.deepStrictEqual(writes, []));
    check("but the contact is still logged", () =>
      assert.match(store.get("People/Sam.md"), /prm-last-contacted: ['"]?2026-10-28/));
  }
  {
    const { plugin, store } = await boot(SAM, {}, null);
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    const before = notices.length;
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("without Journal the contact is still logged", () =>
      assert.match(store.get("People/Sam.md"), /prm-last-contacted: ['"]?2026-10-28/));
    check("and no journal error is shown", () =>
      assert.ok(!notices.slice(before).some((n) => /journal|Journal/.test(n)), notices.slice(before).join(" | ")));
  }
  {
    const { plugin } = await boot(SAM, {}, fakeJournal(1));
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("a Journal on another API version is not called", () => assert.deepStrictEqual(writes, []));
  }

  console.log("\nA day no note holds is skipped without failing");
  {
    const { plugin } = await boot(SAM);
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-05-05", "old");
    check("nothing asked of Journal", () => assert.deepStrictEqual(writes, []));
  }

  console.log("\nBulk logging asks once per person");
  {
    const lee = "---\ntags:\n  - people\nprm-tier: close\n---\n";
    const { plugin } = await boot({ ...SAM, "People/Lee.md": lee });
    await plugin.bulkLogContact(["People/Sam.md", "People/Lee.md"], "2026-10-28", "dinner");
    check("one request per person", () =>
      assert.deepStrictEqual(writes.map((w) => w.name).sort(), ["Lee", "Sam"]));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
