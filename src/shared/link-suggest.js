// [[ in a plugin's text box suggests notes, as the editor does: what's typed after an unclosed [[
// narrows a list floating under the box, and a tap (or ↑/↓ then Enter or Tab) writes the [[link]].
// Works on an <input> or a <textarea>, React-controlled ones too; Obsidian's own input suggest
// takes neither a textarea nor a box React owns.
//
// Source: plugin-tools/shared/link-suggest.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.
// globals: document

// The note name typed after an unclosed [[ just before `caret`; null when there's none.
export function linkQuery(text, caret) {
    const match = /\[\[([^[\]|#\n]*)$/.exec(text.slice(0, caret));
    return match ? match[1] : null;
}

// `text` with the [[name being typed before `caret` written out as [[link]] (a ]] right after the
// caret is reused), and where the caret goes: after the link.
export function insertLink(text, caret, link) {
    const before = text.slice(0, caret).replace(/\[\[[^[\]|#\n]*$/, "");
    const after = text.slice(caret).replace(/^\]\]/, "");
    return { text: `${before}[[${link}]]${after}`, caret: before.length + link.length + 4 };
}

// A suggestion is a file or an entry that wraps one ({ file, basename, aliases }), so a bare
// [{ basename }] still works for anything calling these helpers directly.
const noteFile = note => note.file ?? note;
const noteName = note => note.basename ?? note.file?.basename ?? "";

// Aliases as a list: a list, or one comma-separated string (frontmatter allows both).
function normalizeAliases(value) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return list.map(alias => String(alias).trim()).filter(Boolean);
}

// The aliases a note's frontmatter gives it (`aliases`, or the old `alias` when `aliases` is
// empty, as a converted note may leave it).
function aliasesOf(app, file) {
    const frontmatter = app.metadataCache?.getFileCache?.(file)?.frontmatter;
    const aliases = normalizeAliases(frontmatter?.aliases);
    return aliases.length ? aliases : normalizeAliases(frontmatter?.alias);
}

// How well `name` answers what was typed: names starting with it first, then ones with a word
// starting with it, then the rest; -1 for no match.
function matchRank(name, typed) {
    return name.startsWith(typed) ? 0 : name.split(/[\s\-_.(]+/).some(word => word.startsWith(typed)) ? 1 : name.includes(typed) ? 2 : -1;
}

// The best way `note` answers `typed`: its own name first, else the closest alias. The text that
// matched is kept so equal ranks compare by it, not by the note's name.
function bestMatch(note, typed) {
    const name = noteName(note);
    const own = matchRank(name.toLowerCase(), typed);
    if (own !== -1) return { rank: own, text: name, alias: null };
    let best = null;
    for (const alias of normalizeAliases(note.aliases)) {
        const rank = matchRank(alias.toLowerCase(), typed);
        if (rank === -1 || (best && (rank > best.rank || (rank === best.rank && alias.length >= best.text.length)))) continue;
        best = { rank, text: alias, alias };
    }
    return best;
}

// The alias of `note` that `query` matched when the note's own name didn't: the picked link then
// shows the alias, as the editor's own suggestions do. Null when the name matched, or none did.
export function linkAlias(note, query) {
    const typed = query.trim().toLowerCase();
    return typed ? bestMatch(note, typed)?.alias ?? null : null;
}

// The notes whose name or an alias has `query` in it, ranked the same way either way; a name
// match wins a tie, then the shorter match, then the shorter note name.
export function linkMatches(notes, query, limit = 8) {
    const typed = query.trim().toLowerCase();
    if (!typed) return [];
    return notes
        .map(note => ({ note, match: bestMatch(note, typed) }))
        .filter(({ match }) => match)
        .sort((a, b) => a.match.rank - b.match.rank
            || (a.match.alias === null ? 0 : 1) - (b.match.alias === null ? 0 : 1)
            || a.match.text.length - b.match.text.length
            || noteName(a.note).length - noteName(b.note).length
            || noteName(a.note).localeCompare(noteName(b.note)))
        .slice(0, limit)
        .map(({ note }) => note);
}

const LINK_SUGGEST_STYLE = `
.link-suggest { position: fixed; z-index: var(--layer-menu, 65); max-height: 15em; overflow-y: auto; padding: 4px;
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px);
  background: var(--background-primary); box-shadow: var(--shadow-s); }
.link-suggest-item { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-s, 4px);
  cursor: pointer; color: var(--text-normal); font-size: var(--font-ui-medium, 15px); }
.link-suggest-item.is-selected, .link-suggest-item:hover { background: var(--background-modifier-hover); }
.link-suggest-alias { color: var(--text-muted); font-size: var(--font-ui-smaller, 12px); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.link-suggest-folder { margin-left: auto; color: var(--text-faint); font-size: var(--font-ui-smaller, 12px);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

// The boxes that already have it.
const linkSuggestBoxes = new WeakSet();

// The vault's markdown notes with their aliases, filtered once per app and kept until the vault or
// its metadata changes: rebuilding the list on every keystroke is an O(vault) pass on the editor's
// thread (2026-10-21). It lives on the app, not in a WeakMap: a plugin reload loads a new copy of
// this module, and the old copy's listeners would otherwise stay on the app for good. The key is
// versioned: an older copy sharing the plain key would read a shape it doesn't understand and
// leave its own list stale.
const ELIGIBLE = "__linkSuggestEligibleNotes";
function eligibleNotes(app) {
    let entry = app[ELIGIBLE];
    if (!entry) {
        entry = { notes: null };
        app[ELIGIBLE] = entry;
    }
    if (!entry.wired) {
        entry.wired = true;
        const invalidate = () => {
            entry.notes = null;
        };
        app.vault.on?.("create", invalidate);
        app.vault.on?.("delete", invalidate);
        app.vault.on?.("rename", invalidate);
        // Changing "Excluded files" in Settings re-resolves the cache, with no vault event.
        app.metadataCache?.on?.("resolved", invalidate);
        // An edited alias only shows up as changed metadata: refresh that note alone, so an
        // ordinary note edit doesn't put an O(vault) rebuild on the next keystroke.
        app.metadataCache?.on?.("changed", file => {
            if (!entry.notes || !file?.path) return;
            const note = entry.notes.find(note => noteFile(note).path === file.path);
            if (note) note.aliases = aliasesOf(app, file);
        });
    }
    return (entry.notes ??= app.vault
        .getMarkdownFiles()
        .filter(file => !app.metadataCache.isUserIgnored?.(file.path))
        .map(file => ({ file, basename: file.basename, aliases: aliasesOf(app, file) })));
}

// Gives `inputEl` the [[ suggestions; a second call on the same box does nothing (a React ref may
// call it again), and so does one without a real document around (a plugin's tests). The list is
// fixed to the screen under the box (over it when there's no room below), so no scrolling
// container clips it, and it only exists while it shows.
export function attachLinkSuggest(app, inputEl) {
    const doc = inputEl?.ownerDocument;
    const win = doc?.defaultView;
    if (!win || !doc.head || linkSuggestBoxes.has(inputEl)) return;
    linkSuggestBoxes.add(inputEl);
    if (!doc.getElementById("link-suggest-style")) {
        const style = doc.createElement("style");
        style.id = "link-suggest-style";
        style.textContent = LINK_SUGGEST_STYLE;
        doc.head.appendChild(style);
    }
    let list = null;
    let shown = [];
    let active = 0;
    let typedQuery = "";

    const place = () => {
        if (!list) return;
        const box = inputEl.getBoundingClientRect();
        const height = win.visualViewport?.height ?? win.innerHeight;
        list.style.left = `${box.left}px`;
        list.style.width = `${box.width}px`;
        if (height - box.bottom < 200 && box.top > height - box.bottom) {
            list.style.top = "";
            list.style.bottom = `${win.innerHeight - box.top + 4}px`;
        } else {
            list.style.bottom = "";
            list.style.top = `${box.bottom + 4}px`;
        }
    };
    // While the list shows, Escape closes it rather than the dialog around the box: a key scope
    // on top of the current one, as Obsidian's own suggestion lists do (keys it doesn't take fall
    // through). Its key map isn't public API, so without one Escape stays the dialog's.
    let scope = null;
    const keymap = app.keymap;
    const holdEscape = () => {
        const Scope = keymap?.rootScope?.constructor;
        const current = keymap?.getWindowStack?.(win)?.scope;
        if (scope || typeof Scope !== "function" || !current || typeof keymap.pushScope !== "function") return;
        scope = new Scope(current);
        scope.register([], "Escape", () => {
            close();
            return false;
        });
        keymap.pushScope(scope);
    };
    // A box removed with its dialog doesn't always get a blur, so the list checks it's still there.
    let watch = null;
    const close = () => {
        shown = [];
        if (scope) keymap.popScope(scope);
        scope = null;
        win.clearInterval(watch);
        if (!list) return;
        list.remove();
        list = null;
        doc.removeEventListener("scroll", place, true);
        win.removeEventListener("resize", place);
    };
    // The value goes in through the element's own setter, so React sees the change too.
    const setValue = value => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inputEl), "value")?.set;
        if (setter) setter.call(inputEl, value);
        else inputEl.value = value;
    };
    const pick = note => {
        const linktext = app.metadataCache.fileToLinktext(noteFile(note), "", true);
        // Picked by alias: the link shows the alias, as the editor's own suggestion does. An alias
        // that would break the [[...]] syntax or the note's day line is dropped, not escaped.
        const alias = linkAlias(note, typedQuery);
        const display = alias && !/[\r\n]|\]\]|\|/.test(alias) ? alias : null;
        const next = insertLink(inputEl.value, inputEl.selectionStart ?? inputEl.value.length, display ? `${linktext}|${display}` : linktext);
        setValue(next.text);
        inputEl.focus();
        inputEl.setSelectionRange(next.caret, next.caret);
        inputEl.dispatchEvent(new win.Event("input", { bubbles: true }));
        close();
    };
    const render = () => {
        if (!shown.length) return close();
        if (!list) {
            list = doc.createElement("div");
            list.className = "link-suggest";
            doc.body.appendChild(list);
            doc.addEventListener("scroll", place, true);
            win.addEventListener("resize", place);
            watch = win.setInterval(() => {
                if (!inputEl.isConnected) close();
            }, 500);
            holdEscape();
        }
        list.replaceChildren();
        shown.forEach((note, i) => {
            const item = doc.createElement("div");
            item.className = i === active ? "link-suggest-item is-selected" : "link-suggest-item";
            const name = doc.createElement("span");
            name.textContent = noteName(note);
            item.appendChild(name);
            const alias = linkAlias(note, typedQuery);
            if (alias) {
                const also = doc.createElement("span");
                also.className = "link-suggest-alias";
                also.textContent = alias;
                item.appendChild(also);
            }
            const file = noteFile(note);
            const folder = file.parent?.path && file.parent.path !== "/" ? file.parent.path : "";
            if (folder) {
                const where = doc.createElement("span");
                where.className = "link-suggest-folder";
                where.textContent = folder;
                item.appendChild(where);
            }
            item.addEventListener("mousedown", event => event.preventDefault());   // the box keeps the cursor
            item.addEventListener("click", () => pick(note));
            list.appendChild(item);
        });
        place();
    };
    const update = () => {
        typedQuery = linkQuery(inputEl.value, inputEl.selectionStart ?? inputEl.value.length);
        if (typedQuery === null) return close();
        shown = linkMatches(eligibleNotes(app), typedQuery);
        active = 0;
        render();
    };
    inputEl.addEventListener("input", update);
    inputEl.addEventListener("click", update);
    inputEl.addEventListener("blur", () => win.setTimeout(close, 150));
    // Registered before the box's own keys where it can be (a headline's Enter, a form's submit),
    // so a pick doesn't also do what Enter does there.
    inputEl.addEventListener("keydown", event => {
        if (!shown.length || event.isComposing) return;
        const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
        if (move) active = (active + move + shown.length) % shown.length;
        else if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && !event.shiftKey) pick(shown[active]);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (shown.length) render();
    });
}
