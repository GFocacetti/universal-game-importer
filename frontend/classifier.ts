import { Game, UgiState } from 'types';

// Microsoft Store catalog: tells whether a Store package is a game or an app.
// Queried from the frontend because HTTP calls inside a backend call crash Millennium's Lua host.
const STORE_LOOKUP =
	'https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?market=US&languages=en-US&alternateId=PackageFamilyName&fieldsTemplate=browse&value=';
const PARALLEL = 6;

async function storeKind(family: string): Promise<'game' | 'app' | null> {
	try {
		const res = await fetch(STORE_LOOKUP + encodeURIComponent(family));
		if (!res.ok) return null;
		const kind = (await res.json())?.Products?.[0]?.ProductKind;
		return kind ? (kind === 'Game' ? 'game' : 'app') : null;
	} catch {
		return null;
	}
}

// Fills in game.kind for entries the launcher couldn't classify; returns true if the cache changed
export async function classify(games: Game[], state: UgiState): Promise<boolean> {
	const pending = games.filter((g) => !g.kind && g.store_family);
	const families = [...new Set(pending.map((g) => g.store_family as string))].filter((f) => !state.store_kinds[f]);
	let changed = false;

	for (let i = 0; i < families.length; i += PARALLEL) {
		const batch = families.slice(i, i + PARALLEL);
		const kinds = await Promise.all(batch.map(storeKind));
		batch.forEach((family, j) => {
			const kind = kinds[j];
			if (kind) {
				state.store_kinds[family] = kind;
				changed = true;
			}
		});
	}

	for (const game of games) {
		if (!game.kind) game.kind = (game.store_family && state.store_kinds[game.store_family]) || 'uncertain';
	}
	return changed;
}
