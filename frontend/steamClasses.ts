import { classMapList } from '@steambrew/client';

// Steam's page elements: until the 2026-11-18 client each one carried its readable class ("RightColumn") next
// to the generated one; the current client keeps only the generated one ("jsz9DAW75D8-"), different in every
// build. The generated names are read from Steam's own class lists, so both clients are matched.
const selectors = new Map<string, string>();

// The current client's names (_? + 11 characters + -) or the older ones (long, mixed case with digits)
const isHash = (token: string) =>
	/^_?[A-Za-z0-9_-]{11}-$/.test(token) || (/^[A-Za-z0-9_-]{18,}$/.test(token) && /\d/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token));

export function steamSelector(name: string): string {
	const known = selectors.get(name);
	if (known) return known;
	const hashes = new Set<string>();
	for (const module of classMapList ?? []) {
		const value = (module as any)?.[name];
		if (typeof value !== 'string') continue;
		// Only generated names: among Steam's lists there are also texts (translations) under the same keys
		for (const hash of value.split(/\s+/)) if (hash !== name && isHash(hash)) hashes.add(hash);
	}
	const selector = [name, ...hashes].map((c) => '.' + CSS.escape(c)).join(', ');
	// Kept only once Steam's lists are read: before that, asked again
	if (hashes.size) selectors.set(name, selector);
	return selector;
}

export function hasSteamClass(el: Element, name: string): boolean {
	return el.matches(steamSelector(name));
}
