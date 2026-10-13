/**
 * Editing a tier from its settings page: renaming its stored id rewrites the
 * notes on it, removing it works from the page (Obsidian draws no delete
 * button on a row that opens a page), and edits reach the list's rows.
 */
const Module = require("module");
const assert = require("assert");
const { makeStub, makeVault } = require("./stub-obsidian.cjs");
const harness = require("./build.cjs");

const notices = [];
const stub = makeStub(notices);
Module._load = ((o) => (r, p, m) => (r === "obsidian" ? stub : o(r, p, m)))(Module._load);
global.window = { setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout };

const PluginClass = harness.loadPlugin();

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; } catch (e) { console.error(`  ✗ ${n}\n     ${e.message}`); failed++; } };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A Setting that keeps the callbacks a render() hands it. */
function fakeSetting(backButton) {
  const got = { text: null, buttons: [] };
  const chain = (target, store) => new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (fn) => { if (k === "onChange" || k === "onClick") store[k] = fn; return chain(t, store); }),
  });
  return {
    got,
    addText(cb) { got.text = {}; cb(chain({}, got.text)); return this; },
    addButton(cb) {
      const b = {};
      b.buttonEl = { closest: (sel) => (sel === ".setting-page" ? { querySelector: (q) => (q === ".setting-page-back-button" ? backButton : null) } : null) };
      got.buttons.push(b);
      cb(chain({ buttonEl: b.buttonEl }, b));
      return this;
    },
  };
}

const tierPage = (tab, label) =>
  tab.getSettingDefinitions().flatMap((d) => (d.type === "list" && d.heading === "Tiers" ? d.items : []))
    .find((p) => p.name === label);
const row = (page, name) => page.items.find((i) => i.name === name);

(async () => {
  const v = makeVault();
  v.addFile("People/Sam.md", "---\ntags:\n  - people\nprm-tier: close\n---\n");
  v.addFile("People/Ann.md", "---\ntags:\n  - people\nprm-tier: close\n---\n");
  v.addFile("People/Bo.md", "---\ntags:\n  - people\nprm-tier: casual\n---\n");

  const plugin = new PluginClass(v.app, { id: "personal-crm" });
  plugin.__data = { configured: true, notifyOnStartup: false, showStatusBar: false,
    personFolders: ["People"], journalSources: [], defaultTierId: "close", newPersonTier: "close" };
  await plugin.onload();
  plugin.engine.rebuild();
  const tab = plugin.__tab;
  // Obsidian detaches the tab while one of its pages is open.
  tab.containerEl.isShown = () => false;

  // ---- label edits reach the list without re-rendering the open page
  const updatesBefore = tab.__updates;
  tab.setControlValue("tiers.1.label", "Near");
  check("a label edit refreshes the list's rows", () =>
    assert.ok(tab.settingItems.some((d) => d.type === "list" && d.items.some((p) => p.name === "Near"))));
  check("…without update(), which would blank the page being edited", () =>
    assert.strictEqual(tab.__updates, updatesBefore));

  // ---- rename the stored id
  const page = tierPage(tab, "Near");
  check("a tier page has Stored as and Remove rows", () => {
    assert.ok(row(page, "Stored as")?.render);
    assert.ok(row(page, "Remove this tier")?.render);
  });

  const renameWith = (value) => {
    const s = fakeSetting(null);
    row(tierPage(tab, plugin.settings.tiers[1].label), "Stored as").render(s);
    s.got.text.onChange(value);
    s.got.buttons[0].onClick();
  };

  renameWith("Not valid!");
  check("an invalid id is refused", () => assert.strictEqual(plugin.settings.tiers[1].id, "close"));
  renameWith("casual");
  check("an id another tier uses is refused", () => assert.strictEqual(plugin.settings.tiers[1].id, "close"));

  // Two people are on it, so it asks first; the stub's ConfirmModal opens, so confirm it.
  const opened = [];
  const origOpen = stub.Modal.prototype.open;
  stub.Modal.prototype.open = function () { opened.push(this); };
  renameWith("Near Friends");
  stub.Modal.prototype.open = origOpen;
  check("renaming a tier people are on asks first", () => assert.strictEqual(opened.length, 1));
  opened[0].onConfirm();
  await tick(); await tick();
  for (let i = 0; i < 10 && plugin.settings.tiers[1].id !== "near-friends"; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));

  check("the id is slugged and saved", () => assert.strictEqual(plugin.settings.tiers[1].id, "near-friends"));
  check("both notes on the tier are rewritten", () => {
    assert.ok(/prm-tier: near-friends/.test(v.store.get("People/Sam.md")), v.store.get("People/Sam.md"));
    assert.ok(/prm-tier: near-friends/.test(v.store.get("People/Ann.md")), v.store.get("People/Ann.md"));
  });
  check("a note on another tier is left alone", () =>
    assert.ok(/prm-tier: casual/.test(v.store.get("People/Bo.md"))));
  check("default and new-person tier follow the rename", () => {
    assert.strictEqual(plugin.settings.defaultTierId, "near-friends");
    assert.strictEqual(plugin.settings.newPersonTier, "near-friends");
  });

  // ---- remove from the page
  const s = plugin.settings;
  s.tiers.push({ id: "spare", label: "Spare", cadenceDays: 30, color: "#888888" });
  let wentBack = false;
  const remover = fakeSetting({ click: () => { wentBack = true; } });
  row(tierPage(tab, "Spare"), "Remove this tier").render(remover);
  remover.got.buttons[0].onClick();
  check("Remove tier deletes an empty tier at once", () => assert.ok(!s.tiers.some((t) => t.id === "spare")));
  check("…and leaves its page", () => assert.ok(wentBack));
  check("…and the list no longer shows it", () =>
    assert.ok(!tab.settingItems.some((d) => d.type === "list" && d.items.some((p) => p.name === "Spare"))));

  // ---- adding twice never repeats a page name (Obsidian finds pages by name)
  const list = tab.getSettingDefinitions().find((d) => d.type === "list" && d.heading === "Tiers");
  list.addItem.action();
  tab.getSettingDefinitions().find((d) => d.type === "list" && d.heading === "Tiers").addItem.action();
  const labels = s.tiers.map((t) => t.label);
  check("two added tiers get distinct labels", () => assert.strictEqual(new Set(labels).size, labels.length, labels.join(", ")));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("SUITE ERROR:", e.stack); process.exit(1); });
