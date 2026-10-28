/** Logging a contact writes it into that day's journal note: a plain line or a Met highlight. */
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
  "- [x] read",
  "",
  "h: Shipped the CRM fix",
  "e: finally",
  "With [[Ana]] (lunch)",
  "- private note",
  "",
  "*10-29* ^d1029",
  "",
].join("\n");

async function boot(files, settings = {}) {
  const v = makeVault();
  for (const [path, content] of Object.entries(files)) v.addFile(path, content);
  const plugin = new PluginClass(v.app, { id: "personal-crm" });
  plugin.__data = Object.assign({ configured: true, notifyOnStartup: false, showStatusBar: false,
    logToBody: false, personFolders: ["People"], journalSources: WEEKS }, settings);
  await plugin.onload();
  plugin.engine.rebuild();
  await plugin.engine.whenDayLinesRead();
  plugin.engine.rebuild();
  return { plugin, ...v };
}

/** The lines of the day "MM-DD" in a week note, heading included, up to the next day. */
function dayOf(text, mmdd) {
  const all = text.split("\n");
  const start = all.findIndex((l) => l.startsWith(`*${mmdd}*`));
  if (start === -1) return null;
  const end = all.findIndex((l, i) => i > start && /^\*\d{2}-\d{2}\*/.test(l));
  return all.slice(start, end === -1 ? all.length : end);
}

(async () => {
  console.log("A plain day-log line");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    const week = store.get("Weeks/2026-W44.md");
    const day = dayOf(week, "10-28");

    check("the day gets a Met line", () =>
      assert.ok(day.includes("- Met [[Sam]] — coffee"), JSON.stringify(day)));
    check("at the end of the day, above the next day", () => {
      assert.strictEqual(day[day.indexOf("- private note") + 1], "- Met [[Sam]] — coffee");
      assert.ok(day[day.length - 1] === "", JSON.stringify(day));
    });
    check("and nothing leaks into the next day", () => {
      const next = dayOf(week, "10-29");
      assert.deepStrictEqual(next, ["*10-29* ^d1029", ""]);
    });
    check("the person's own note still records the contact", () =>
      assert.match(store.get("People/Sam.md"), /prm-last-contacted: ['"]?2026-10-28/));
  }

  console.log("\nA highlight, with the note as details");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee\nthe new job", { journalStyle: "highlight" });
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-28");

    check("the highlight goes after the day's own highlights", () => {
      assert.strictEqual(day[day.indexOf("e: finally") + 1], "h: Met [[Sam]]");
    });
    check("one e: line per note line", () =>
      assert.deepStrictEqual(day.slice(day.indexOf("h: Met [[Sam]]"), day.indexOf("h: Met [[Sam]]") + 3),
        ["h: Met [[Sam]]", "e: coffee", "e: the new job"]));
    check("the With line and private log stay below", () =>
      assert.ok(day.includes("With [[Ana]] (lunch)") && day.includes("- private note")));
  }

  console.log("\nA highlight with no note has no details");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": "*10-27* ^d1027\n- [ ] walk\n\nh:\ne:\n\n*10-28* ^d1028\n",
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-27", undefined, { journalStyle: "highlight" });
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-27");
    check("the empty h: placeholder is filled", () =>
      assert.deepStrictEqual(day.slice(1), ["- [ ] walk", "", "h: Met [[Sam]]", ""]));
    check("and its unused empty e: is gone", () =>
      assert.ok(!day.some((l) => l.trim() === "e:"), JSON.stringify(day)));
  }

  console.log("\nLogging twice on one day doesn't stack");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    await plugin.logContact(file, "2026-10-28", "lunch");
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-28");
    const met = day.filter((l) => l.startsWith("- Met [[Sam]]"));
    check("still one line", () => assert.strictEqual(met.length, 1, JSON.stringify(day)));
    check("the second note joins it", () =>
      assert.strictEqual(met[0], "- Met [[Sam]] — coffee; lunch"));

    await plugin.logContact(file, "2026-10-28", "a walk", { journalStyle: "highlight" });
    const after = dayOf(store.get("Weeks/2026-W44.md"), "10-28");
    check("a highlight isn't added next to an existing mention", () =>
      assert.ok(!after.some((l) => l.startsWith("h: Met [[Sam]]")), JSON.stringify(after)));
  }
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee", { journalStyle: "highlight" });
    await plugin.logContact(file, "2026-10-28", "lunch", { journalStyle: "highlight" });
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-28");
    check("a second highlight log adds its detail, not a second highlight", () => {
      assert.strictEqual(day.filter((l) => l.startsWith("h: Met [[Sam]]")).length, 1);
      assert.deepStrictEqual(day.slice(day.indexOf("h: Met [[Sam]]"), day.indexOf("h: Met [[Sam]]") + 3),
        ["h: Met [[Sam]]", "e: coffee", "e: lunch"]);
    });
  }

  console.log("\nSomeone already in the day isn't written again");
  {
    const { plugin, store } = await boot({
      "People/Ana.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Ana.md");
    await plugin.logContact(file, "2026-10-28", "again");
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-28");
    check("the With link is enough", () =>
      assert.ok(!day.some((l) => l.includes("[[Ana]]") && !l.startsWith("With ")), JSON.stringify(day)));
  }

  console.log("\nprm-ignore-journal gets no line");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\nprm-ignore-journal: true\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("the day is left alone", () => assert.strictEqual(store.get("Weeks/2026-W44.md"), WEEK));
    check("but the contact is still logged", () =>
      assert.match(store.get("People/Sam.md"), /prm-last-contacted: ['"]?2026-10-28/));
  }

  console.log("\nThe journal's own Day entry never writes back");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const before = store.get("Weeks/2026-W44.md");
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "from the day entry", { merge: true });
    check("merge: true leaves the week note alone", () =>
      assert.strictEqual(store.get("Weeks/2026-W44.md"), before));
  }

  console.log("\nTurning it off, or a day with no note");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    }, { journalLogStyle: "none" });
    const before = store.get("Weeks/2026-W44.md");
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    check("off writes nothing", () => assert.strictEqual(store.get("Weeks/2026-W44.md"), before));
    check("but the contact is still logged", () =>
      assert.match(store.get("People/Sam.md"), /prm-last-contacted: ['"]?2026-10-28/));
  }
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-05-05", "old");
    check("a day no note holds is skipped without failing", () =>
      assert.strictEqual(store.get("Weeks/2026-W44.md"), WEEK));
  }

  console.log("\nA past day of the same week takes its own line");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-26", "called");
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-26");
    check("under 10-26", () => assert.deepStrictEqual(day, ["*10-26* ^d1026", "quiet", "- Met [[Sam]] — called", ""]));
  }

  console.log("\nUndo takes the journal line back too");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": WEEK,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    const beforeWeek = store.get("Weeks/2026-W44.md");
    const beforePerson = store.get("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    await plugin.performUndo();
    check("one undo restores the week note", () =>
      assert.strictEqual(store.get("Weeks/2026-W44.md"), beforeWeek));
    check("and the person's note", () =>
      assert.strictEqual(store.get("People/Sam.md"), beforePerson));
  }

  console.log("\nBulk logging");
  {
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "People/Lee.md": "---\ntags:\n  - people\nprm-tier: close\n---\n",
      "Weeks/2026-W44.md": "*10-28* ^d1028\nquiet\n",
    });
    await plugin.bulkLogContact(["People/Sam.md", "People/Lee.md"], "2026-10-28", "dinner");
    const day = dayOf(store.get("Weeks/2026-W44.md"), "10-28");
    check("one line per person, in one step", () =>
      assert.deepStrictEqual(day, ["*10-28* ^d1028", "quiet",
        "- Met [[Sam]] — dinner", "- Met [[Lee]] — dinner", ""]));
    await plugin.performUndo();
    check("undo takes the whole block back", () =>
      assert.deepStrictEqual(dayOf(store.get("Weeks/2026-W44.md"), "10-28"),
        ["*10-28* ^d1028", "quiet", ""]));
  }

  console.log("\nCRLF notes keep their line endings");
  {
    const crlf = WEEK.replace(/\n/g, "\r\n");
    const { plugin, store } = await boot({
      "People/Sam.md": "---\ntags:\n  - people\r\nprm-tier: close\r\n---\r\n",
      "Weeks/2026-W44.md": crlf,
    });
    const file = plugin.app.vault.getAbstractFileByPath("People/Sam.md");
    await plugin.logContact(file, "2026-10-28", "coffee");
    const week = store.get("Weeks/2026-W44.md");
    check("the new line ends CRLF like the rest", () =>
      assert.ok(week.includes("- Met [[Sam]] — coffee\r\n"), JSON.stringify(week)));
    check("and no lone LF is introduced", () =>
      assert.ok(!/[^\r]\n/.test(week), JSON.stringify(week)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
