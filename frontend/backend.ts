import { callable } from '@steambrew/client';
import { ScanResult, UgiSettings, UgiState } from 'types';

const ugiScan = callable<[{ a_options: string }], string>('ugi_scan');
const ugiGetState = callable<[], string>('ugi_get_state');
const ugiSaveState = callable<[{ json: string }], boolean>('ugi_save_state');

// Millennium may hand string results back still wrapped in JSON quotes ("fn" instead of fn):
// every string from a backend call goes through this
export const unquote = (value: unknown) => String(value ?? '').replace(/^"|"$/g, '');

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

export async function scan(options: { enabled?: Record<string, boolean>; paths?: Record<string, string> } = {}): Promise<ScanResult> {
	const result = parse<ScanResult>(await ugiScan({ a_options: JSON.stringify(options) }), { launchers: [], games: [] });
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
			rawg_key: typeof settings.rawg_key === 'string' ? settings.rawg_key : '',
			animated: settings.animated === true,
			// WebP included unless the user turned it off
			webp: settings.webp !== false,
			theme: settings.theme === 'modern' ? 'modern' : 'steam',
			language: settings.language === 'en' || settings.language === 'it' ? settings.language : 'auto',
			filters: asRecord(settings.filters),
			check_interval: (['off', 'daily', 'weekly', 'monthly'] as const).includes(settings.check_interval as any) ? settings.check_interval : 'weekly',
			launchers: asRecord(settings.launchers),
		},
		collections: asRecord(state.collections),
		sgdb_ids: asRecord(state.sgdb_ids),
		custom_icons: asRecord(state.custom_icons),
		last_check: typeof state.last_check === 'string' ? state.last_check : undefined,
		last_launchers: Array.isArray(state.last_launchers) ? state.last_launchers : [],
		onboarded: state.onboarded === true,
	};
}

export async function saveState(state: UgiState): Promise<boolean> {
	return ugiSaveState({ json: JSON.stringify(state) });
}
