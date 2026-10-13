import type { CachedMetadata } from "obsidian";

/**
 * Obsidian types frontmatter values as `any`, which spreads untyped values
 * through every read site. Narrowing once here — from `unknown`, so the
 * assertion genuinely changes the type — keeps the rest of the codebase honest
 * about the fact that frontmatter is user-controlled data of unknown shape.
 */
export function frontmatterOf(
	cache: CachedMetadata | null | undefined,
): Record<string, unknown> {
	const raw: unknown = cache?.frontmatter;
	if (typeof raw !== "object" || raw === null) return {};
	return raw as Record<string, unknown>;
}

/**
 * The shape `fileManager.processFrontMatter` hands to its callback. Declaring it
 * as a record rather than accepting `any` means writes are checked too.
 */
export type MutableFrontmatter = Record<string, unknown>;

/**
 * Coerce a frontmatter value to text, or `null` if it has no sensible single-string
 * form.
 *
 * Plain `String(value)` turns a mapping like `prm-birthday: {a: b}` into the
 * literal `"[object Object]"`, which would then be written back into the user's
 * note. Frontmatter is arbitrary user data, so refuse rather than guess.
 */
export function asText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	return null;
}

/**
 * Read a frontmatter `tags` value, which Obsidian accepts as either a single
 * string, a comma-separated string, or a list.
 */
export function readTagList(value: unknown): string[] {
	const out: string[] = [];
	const push = (raw: unknown) => {
		const text = asText(raw);
		if (text === null) return;
		for (const part of text.split(",")) {
			const tag = part.trim().replace(/^#/, "");
			if (tag.length > 0) out.push(tag);
		}
	};
	if (Array.isArray(value)) for (const v of value) push(v);
	else push(value);
	return out;
}

/** Case-insensitive de-duplication that keeps the first spelling seen. */
export function dedupeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tag of tags) {
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
	}
	return out;
}

/**
 * Link targets written as wikilink values under a frontmatter key, for
 * `with: ["[[Alex]]", "[[Ervin|Ervi]]"]` or a single `host: "[[Alex]]"`.
 *
 * Plain text is not a link and is skipped: "Alex" could be anyone. An unquoted
 * `- [[Alex]]` is legal YAML for a list holding a list holding "Alex", so that
 * shape is read as a link too. The display part after `|` is dropped.
 */
export function frontmatterLinkTargets(fm: Record<string, unknown>, key: string): string[] {
	const raw = fm[key];
	const values: unknown[] = Array.isArray(raw) ? raw : [raw];
	const out: string[] = [];
	for (const value of values) {
		let inner: string | null = null;
		if (typeof value === "string") {
			inner = /^\s*\[\[([^\]]+)\]\]\s*$/.exec(value)?.[1] ?? null;
		} else if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) {
			const nested: unknown = (value[0] as unknown[])[0];
			if (typeof nested === "string") inner = nested;
		}
		const target = inner?.split("|")[0].trim();
		if (target) out.push(target);
	}
	return out;
}
