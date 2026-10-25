import { callable } from '@steambrew/client';
import { ScanResult, UgiSettings, UgiState } from 'types';

const ugiScan = callable<[], string>('ugi_scan');
const ugiGetState = callable<[], string>('ugi_get_state');
const ugiSaveState = callable<[{ json: string }], boolean>('ugi_save_state');

function parse<T>(raw: string, fallback: T): T {
	try {
		const value = JSON.parse(raw);
		return value && typeof value === 'object' ? value : fallback;
	} catch {
		return fallback;
	}
}

// Lua encodes empty tables as [] instead of {}
function asRecord<T>(value: unknown): Record<string, T> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

export async function scan(): Promise<ScanResult> {
	const result = parse<ScanResult>(await ugiScan(), { launchers: [], games: [] });
	return { launchers: result.launchers ?? [], games: Array.isArray(result.games) ? result.games : [] };
}

export async function loadState(): Promise<UgiState> {
	const state = parse<Partial<UgiState>>(await ugiGetState(), {});
	const settings: Partial<UgiSettings> = asRecord(state.settings);
	return {
		imported: asRecord(state.imported),
		excluded: asRecord(state.excluded),
		store_kinds: asRecord(state.store_kinds),
		settings: {
			collections: settings.collections === true,
			shelves: settings.shelves === true,
			sgdb_key: typeof settings.sgdb_key === 'string' ? settings.sgdb_key : '',
			animated: settings.animated === true,
			// WebP included unless the user turned it off
			webp: settings.webp !== false,
		},
		collections: asRecord(state.collections),
		sgdb_ids: asRecord(state.sgdb_ids),
		custom_icons: asRecord(state.custom_icons),
	};
}

export async function saveState(state: UgiState): Promise<boolean> {
	return ugiSaveState({ json: JSON.stringify(state) });
}
