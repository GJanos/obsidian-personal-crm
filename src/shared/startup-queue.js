// Startup pop-ups from several plugins, one at a time: each plugin adds its pop-up with a priority
// (lower first) and a `show` that resolves when the pop-up closes. The queue waits SETTLE_MS after
// the last add, so plugins that load later can join, then shows them in order; one added while the
// queue is showing takes its turn after the current one. It lives on the window, so separately
// bundled plugins share one queue. Priorities: Personal CRM's reach-out panel 10, Vault Health's
// card 20.
//
// Source: plugin-tools/shared/startup-queue.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.

const KEY = "__pluginStartupQueue";
const SETTLE_MS = 4000;

export function startupQueue(win = window) {
    const queue = (win[KEY] ??= { items: [], running: false, timer: null });
    const drain = async () => {
        queue.running = true;
        while (queue.items.length) {
            queue.items.sort((a, b) => a.priority - b.priority);
            const { show } = queue.items.shift();
            try {
                await show();
            } catch (error) {
                console.error("startup queue:", error);
            }
        }
        queue.running = false;
    };
    return {
        /** Adds (or replaces, by id) a pop-up. `show` opens it and resolves once it is closed. */
        add(id, priority, show) {
            queue.items = queue.items.filter(item => item.id !== id);
            queue.items.push({ id, priority, show });
            if (queue.running) return;
            win.clearTimeout(queue.timer);
            queue.timer = win.setTimeout(() => void drain(), SETTLE_MS);
        }
    };
}
