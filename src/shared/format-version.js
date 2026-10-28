// The vault contract: folder layout, frontmatter keys, list lines, week-note shape, tags — every
// name in vault-format.js and week-note.js. Bump when a shared change alters the shape of notes,
// then redeploy every plugin. A plugin left behind is reported by Vault Health.
//
// Source: plugin-tools/shared/format-version.js. `node ../plugin-tools/sync-shared.js` copies it into
// each plugin (see the README); edit it here, never in a copy.
// globals: none

export const CONTRACT_VERSION = 1;
