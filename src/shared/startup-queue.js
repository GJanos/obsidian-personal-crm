// Startup pop-ups from several plugins, one at a time: each plugin adds its pop-up with a priority
// (lower first) and a `show` that resolves when the pop-up closes. The queue waits SETTLE_MS after
// the last add, so plugins that load later can join, then shows them in order; one added while the
// queue is showing takes its turn after the current one. It lives on the window, so separately
// bundled plugins share one queue. Priorities: Personal CRM's reach-out panel 10, Vault Health's
// card 20.
//
// A plugin takes its pop-up out with remove(id) when it unloads: one still waiting never shows, one
// already up stops holding the queue, so a reload or a dead panel can't wedge it. After the first
// drain a new pop-up shows at once rather than waiting another settle window.
//
// Source: plugin-tools/shared/startup-queue.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.
// globals: window

const KEY = "__pluginStartupQueue";
const SETTLE_MS = 4000;

export function startupQueue(win = window) {
    const queue = (win[KEY] ??= { items: [], running: false, timer: null, drained: false, current: null });
    const drain = async () => {
        queue.timer = null;
        queue.running = true;
        try {
            while (queue.items.length) {
                queue.items.sort((a, b) => a.priority - b.priority);
                const item = queue.items.shift();
                let cancel;
                const cancelled = new Promise(resolve => { cancel = resolve; });
                item.cancel = cancel;
                queue.current = item;
                try {
                    // A remove() of the pop-up that is up lets the queue move on even when its show
                    // never resolves (a panel torn down with the plugin).
                    await Promise.race([item.show(), cancelled]);
                } catch (error) {
                    console.error("startup queue:", error);
                } finally {
                    item.cancel = null;
                    if (queue.current === item) queue.current = null;
                }
            }
        } finally {
            queue.running = false;
            queue.drained = true;
        }
    };
    return {
        /** Adds (or replaces, by id) a pop-up. `show` opens it and resolves once it is closed. */
        add(id, priority, show) {
            const waiting = queue.items.findIndex(item => item.id === id);
            const isNew = waiting < 0;
            if (waiting >= 0) queue.items.splice(waiting, 1);
            // The same pop-up is already up: take it down; its replacement runs after it.
            if (queue.current?.id === id) queue.current.cancel?.();
            queue.items.push({ id, priority, show, cancel: null });
            if (queue.running) return;
            // Replacing one that is still waiting must not stretch the settle window again.
            if (!isNew && queue.timer != null) return;
            win.clearTimeout(queue.timer);
            queue.timer = win.setTimeout(() => void drain(), queue.drained ? 0 : SETTLE_MS);
        },
        /** Drops a pop-up: one still waiting never shows; one showing stops holding the queue. */
        remove(id) {
            const waiting = queue.items.findIndex(item => item.id === id);
            if (waiting >= 0) queue.items.splice(waiting, 1);
            if (queue.current?.id === id) queue.current.cancel?.();
        }
    };
}
