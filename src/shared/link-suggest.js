// [[ in a plugin's text box suggests notes, as the editor does: what's typed after an unclosed [[
// narrows a list floating under the box, and a tap (or ↑/↓ then Enter or Tab) writes the [[link]].
// Works on an <input> or a <textarea>, React-controlled ones too; Obsidian's own input suggest
// takes neither a textarea nor a box React owns.
//
// Source: plugin-tools/shared/link-suggest.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.

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

// The notes ([{ basename }]) whose name has `query` in it: names starting with it first, then ones
// with a word starting with it, then the rest; shorter names first within each.
export function linkMatches(files, query, limit = 8) {
    const typed = query.trim().toLowerCase();
    if (!typed) return [];
    const rank = name => name.startsWith(typed) ? 0 : name.split(/[\s\-_.(]+/).some(word => word.startsWith(typed)) ? 1 : name.includes(typed) ? 2 : -1;
    return files
        .map(file => ({ file, rank: rank(file.basename.toLowerCase()) }))
        .filter(({ rank }) => rank !== -1)
        .sort((a, b) => a.rank - b.rank || a.file.basename.length - b.file.basename.length || a.file.basename.localeCompare(b.file.basename))
        .slice(0, limit)
        .map(({ file }) => file);
}

const LINK_SUGGEST_STYLE = `
.link-suggest { position: fixed; z-index: var(--layer-menu, 65); max-height: 15em; overflow-y: auto; padding: 4px;
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px);
  background: var(--background-primary); box-shadow: var(--shadow-s); }
.link-suggest-item { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-s, 4px);
  cursor: pointer; color: var(--text-normal); font-size: var(--font-ui-medium, 15px); }
.link-suggest-item.is-selected, .link-suggest-item:hover { background: var(--background-modifier-hover); }
.link-suggest-folder { margin-left: auto; color: var(--text-faint); font-size: var(--font-ui-smaller, 12px);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

// The boxes that already have it.
const linkSuggestBoxes = new WeakSet();

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
    const close = () => {
        shown = [];
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
    const pick = file => {
        const next = insertLink(inputEl.value, inputEl.selectionStart ?? inputEl.value.length, app.metadataCache.fileToLinktext(file, "", true));
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
        }
        list.replaceChildren();
        shown.forEach((file, i) => {
            const item = doc.createElement("div");
            item.className = i === active ? "link-suggest-item is-selected" : "link-suggest-item";
            const name = doc.createElement("span");
            name.textContent = file.basename;
            item.appendChild(name);
            const folder = file.parent?.path && file.parent.path !== "/" ? file.parent.path : "";
            if (folder) {
                const where = doc.createElement("span");
                where.className = "link-suggest-folder";
                where.textContent = folder;
                item.appendChild(where);
            }
            item.addEventListener("mousedown", event => event.preventDefault());   // the box keeps the cursor
            item.addEventListener("click", () => pick(file));
            list.appendChild(item);
        });
        place();
    };
    const update = () => {
        const query = linkQuery(inputEl.value, inputEl.selectionStart ?? inputEl.value.length);
        if (query === null) return close();
        const files = app.vault.getMarkdownFiles().filter(file => !app.metadataCache.isUserIgnored?.(file.path));
        shown = linkMatches(files, query);
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
