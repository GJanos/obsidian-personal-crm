/** Week notes with one `*MM-DD*` line per day: a link takes the day it's written under. */
const Module = require("module");
const assert = require("assert");
const { makeStub, makeVault } = require("./stub-obsidian.cjs");
const harness = require("./build.cjs");
const notices = [];
const stub = makeStub(notices);
Module._load = ((o) => (r, p, m) => (r === "obsidian" ? stub : o(r, p, m)))(Module._load);
global.window = { setTimeout, clearTimeout,
  requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout };
const PluginClass = harness.loadPlugin();

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n     ${e.message}`); failed++; } };

const DAY_LINE = "^\\*(\\d{2}-\\d{2})\\*\\s*$";
const PERSON = "---\ntags:\n  - people\nprm-tier: casual\n---\n";

async function boot(build, source = {}) {
  const v = makeVault();
  build(v);
  const p = new PluginClass(v.app, { id: "personal-crm" });
  p.__data = { configured: true, notifyOnStartup: false, showStatusBar: false,
    personFolders: ["People"],
    journalSources: [{ folder: "Weeks", format: "GGGG-[W]WW", dayLine: DAY_LINE, ...source }] };
  await p.onload();
  p.engine.rebuild();
  await p.engine.whenDayLinesRead();
  return { plugin: p, ...v };
}

(async () => {
  console.log("A link takes the date of the day line above it");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("People/Ana.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "---\ntags:\n  - journal\n---\n" +
        "| date | gen |\n| --- | --- |\n| 10-05 | 8 |\n\n" +
        "*10-05*\nquiet day\n\n" +
        "*10-07*\nlunch with [[Sam]]\n\n" +
        "*10-10*\nh: hike with [[Ana]] and [[Sam]]\n");
    });
    const sam = plugin.engine.get("People/Sam.md");
    const ana = plugin.engine.get("People/Ana.md");
    check("Sam is dated Wednesday and Saturday, not Monday", () =>
      assert.deepStrictEqual(sam.contactDates, ["2026-10-10", "2026-10-07"]));
    check("Ana gets Saturday", () => assert.deepStrictEqual(ana.contactDates, ["2026-10-10"]));
    check("the date still jumps to the week note", () =>
      assert.strictEqual(sam.sources.get("2026-10-07"), "Weeks/2026-W41.md"));
  }

  console.log("\nLinks above the first day line keep the week's Monday");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "## Q4 goals\n1. see [[Sam]] more\n\n*10-08*\nnothing\n");
    });
    check("Monday", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-05"]));
  }

  console.log("\nThe year rolls over inside a week that spans New Year");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      // ISO week 53 of 2026 runs Mon 2026-12-28 to Sun 2027-01-03.
      v.addFile("Weeks/2026-W53.md", "*12-31*\nparty with [[Sam]]\n*01-02*\nbrunch with [[Sam]]\n");
    });
    check("December stays in 2026, January moves to 2027", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates,
        ["2027-01-02", "2026-12-31"]));
  }

  console.log("\nA day line outside the week is ignored, not trusted");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*11-20*\ntypo'd day with [[Sam]]\n");
    });
    check("falls back to Monday", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-05"]));
  }

  console.log("\nThe intent rules still apply inside a day");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*10-06*\n- [ ] call [[Sam]]\n*10-07*\n- [x] called [[Sam]]\n");
    });
    check("the open task doesn't count, the ticked one does on its day", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-07"]));
  }

  console.log("\nWindows line endings");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*10-05*\r\nnothing\r\n*10-09*\r\nbeers with [[Sam]]\r\n");
    });
    check("offsets still line up", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-09"]));
  }

  console.log("\nWithout a day-line pattern the source behaves as upstream");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*10-09*\nbeers with [[Sam]]\n");
    }, { dayLine: "" });
    check("Monday", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-05"]));
  }

  console.log("\nAn edited week note is read again");
  {
    const { plugin, store, files } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*10-06*\ncoffee with [[Sam]]\n");
    });
    const week = files.find((f) => f.path === "Weeks/2026-W41.md");
    store.set(week.path, "*10-06*\ncoffee\n*10-08*\ndinner with [[Sam]]\n");
    week.stat.mtime += 1000;
    plugin.engine.rebuild();
    await plugin.engine.whenDayLinesRead();
    check("the new day is picked up", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-08"]));
  }

  console.log("\nA file that can't be read doesn't loop");
  {
    const { plugin, app } = await boot((v) => {
      v.addFile("People/Sam.md", PERSON);
      v.addFile("Weeks/2026-W41.md", "*10-09*\nbeers with [[Sam]]\n");
    });
    let reads = 0;
    app.vault.cachedRead = async () => { reads++; throw new Error("gone"); };
    const week = app.vault.getFileByPath("Weeks/2026-W41.md");
    week.stat.mtime += 1000;
    plugin.engine.rebuild();
    await plugin.engine.whenDayLinesRead();
    plugin.engine.rebuild();
    await plugin.engine.whenDayLinesRead();
    check("one attempt per change", () => assert.strictEqual(reads, 1));
    check("and the link falls back to Monday", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Sam.md").contactDates, ["2026-10-05"]));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
