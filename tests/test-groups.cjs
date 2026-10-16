/** Frontmatter links as contact (`with:` on events), and groups whose contact counts for members. */
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

const person = (extra = "") => `---\ntags:\n  - people/friend\nprm-tier: casual\n${extra}---\n`;
const group = "---\ntags:\n  - people/group\nprm-tier: close\n---\n";

async function boot(build, settings = {}) {
  const v = makeVault();
  build(v);
  const p = new PluginClass(v.app, { id: "personal-crm" });
  p.__data = Object.assign({ configured: true, notifyOnStartup: false, showStatusBar: false,
    personFolders: ["People"], personTags: ["people"], journalDateKey: "start_date",
    journalSources: [
      { folder: "Daily", format: "YYYY-MM-DD" },
      { folder: "Events", format: "YYYY-MM-DD" },
    ] }, settings);
  await p.onload();
  p.engine.rebuild();
  return { plugin: p, ...v };
}

(async () => {
  console.log("`with:` links on a dated note count as contact");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Alex.md", person());
      v.addFile("People/Ervin.md", person());
      v.addFile("People/Dana.md", person());
      v.addFile("Events/Boys hike.md",
        "---\nstart_date: 2026-01-03\nwith:\n  - \"[[Alex]]\"\n  - \"[[Ervin|Ervi]]\"\n  - Dana\n---\nhiked\n");
    });
    check("a linked name counts on the event's date", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Alex.md").contactDates, ["2026-01-03"]));
    check("a link with a display name counts too", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Ervin.md").contactDates, ["2026-01-03"]));
    check("plain text does not", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Dana.md").contactDates, []));
    check("the date jumps to the event", () =>
      assert.strictEqual(plugin.engine.get("People/Alex.md").sources.get("2026-01-03"),
        "Events/Boys hike.md"));
  }

  console.log("\nOnly the configured keys, only in dated notes");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Alex.md", person());
      v.addFile("People/Ervin.md", person());
      v.addFile("Events/Dinner.md",
        "---\nstart_date: 2026-02-01\nhost: \"[[Ervin]]\"\nwith:\n  - \"[[Alex]]\"\n---\n");
      v.addFile("Notes/Plan.md", "---\nwith:\n  - \"[[Ervin]]\"\n---\n");
    });
    check("`host` isn't a contact key, and an undated note doesn't count", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Ervin.md").contactDates, []));
  }
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Alex.md", person());
      v.addFile("Events/Dinner.md", "---\nstart_date: 2026-02-01\nwith:\n  - \"[[Alex]]\"\n---\n");
    }, { contactFrontmatterKeys: [] });
    check("an empty key list turns it off", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Alex.md").contactDates, []));
  }

  console.log("\nSeeing a group counts as seeing its members");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Groups/High School friends.md", group);
      v.addFile("People/Alex.md", person("groups:\n  - \"[[High School friends]]\"\n"));
      v.addFile("People/Ervin.md", person("groups:\n  - \"[[High School friends]]\"\nprm-ignore-group: true\n"));
      v.addFile("People/Dana.md", person());
      v.addFile("Daily/2026-03-01.md", "reunion with [[High School friends]]\n");
      v.addFile("Daily/2026-03-05.md", "coffee with [[Alex]]\n");
    });
    const hs = plugin.engine.get("People/Groups/High School friends.md");
    const alex = plugin.engine.get("People/Alex.md");
    check("the group is tracked like a person", () => {
      assert.strictEqual(hs.cadenceDays, 30);
      assert.deepStrictEqual(hs.contactDates, ["2026-03-01"]);
    });
    check("a member gets the group's date, alongside their own", () =>
      assert.deepStrictEqual(alex.contactDates, ["2026-03-05", "2026-03-01"]));
    check("and it jumps to the note that mentioned the group", () =>
      assert.strictEqual(alex.sources.get("2026-03-01"), "Daily/2026-03-01.md"));
    check("a member who opted out doesn't", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Ervin.md").contactDates, []));
    check("a non-member doesn't", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Dana.md").contactDates, []));
    check("seeing one member doesn't count for the group", () =>
      assert.ok(!hs.contactDates.includes("2026-03-05"), JSON.stringify(hs.contactDates)));
  }

  console.log("\nGroup contact from every source a group can have");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Groups/Climbers.md",
        "---\ntags:\n  - people/group\nprm-tier: close\nprm-last-contacted: 2026-04-20\n---\n");
      v.addFile("People/Alex.md", person("groups:\n  - \"[[Climbers]]\"\n"));
      v.addFile("Events/Bouldering.md",
        "---\nstart_date: 2026-04-02\nwith:\n  - \"[[Climbers]]\"\n---\n");
    });
    check("an event with the group and a logged contact both reach the member", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Alex.md").contactDates,
        ["2026-04-20", "2026-04-02"]));
  }

  console.log("\nA group link that resolves to nobody is harmless");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Alex.md", person("groups:\n  - \"[[Nonexistent]]\"\n  - Plain text\n"));
    });
    check("no dates, no crash", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Alex.md").contactDates, []));
  }

  console.log("\nGroups only propagate one level");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Groups/Uni.md", group);
      v.addFile("People/Groups/Uni climbers.md",
        "---\ntags:\n  - people/group\ngroups:\n  - \"[[Uni]]\"\n---\n");
      v.addFile("People/Alex.md", person("groups:\n  - \"[[Uni climbers]]\"\n"));
      v.addFile("Daily/2026-05-01.md", "met [[Uni]]\n");
    });
    check("the subgroup inherits from its group", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Groups/Uni climbers.md").contactDates, ["2026-05-01"]));
    check("but the member of the subgroup doesn't, so order can't matter", () =>
      assert.deepStrictEqual(plugin.engine.get("People/Alex.md").contactDates, []));
  }

  console.log("\nprm-ignore-journal holds against group mentions");
  {
    const { plugin } = await boot((v) => {
      v.addFile("People/Groups/Climbers.md", "---\ntags:\n  - people/group\nprm-tier: close\nprm-last-contacted: 2026-04-02\n---\n");
      v.addFile("People/Alex.md", person("groups:\n  - \"[[Climbers]]\"\nprm-ignore-journal: true\n"));
      v.addFile("Daily/2026-04-01.md", "bouldering with [[Climbers]]\n");
    });
    const alex = plugin.engine.get("People/Alex.md");
    check("a journal mention of the group doesn't reach a member who ignores the journal", () =>
      assert.ok(!alex.contactDates.includes("2026-04-01"), JSON.stringify(alex.contactDates)));
    check("a date logged in the group note itself still does", () =>
      assert.deepStrictEqual(alex.contactDates, ["2026-04-02"]));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
