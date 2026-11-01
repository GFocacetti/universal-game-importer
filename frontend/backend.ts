import { callable } from '@steambrew/client';
import { ScanResult, UgiSettings, UgiState } from 'types';
import { LANGUAGES } from 'i18n';

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

// The state changes only through saveState: read once and kept here, so a page doesn't wait for the
// backend while it is busy (each caller gets its own copy)
let stateRead: Promise<string> | null = null;

export async function loadState(): Promise<UgiState> {
	if (!stateRead) {
		stateRead = ugiGetState();
		stateRead.catch(() => (stateRead = null));
	}
	const state = parse<Partial<UgiState>>(await stateRead, {});
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
			xbl_key: typeof settings.xbl_key === 'string' ? settings.xbl_key : '',
			animated: settings.animated === true,
			achievement_toasts: settings.achievement_toasts !== false,
			// WebP included unless the user turned it off
			webp: settings.webp !== false,
			theme: settings.theme === 'modern' ? 'modern' : 'steam',
			language: LANGUAGES.some((l) => l.code === settings.language) ? settings.language : 'auto',
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

// UGI key of an imported game ("gog:1207658754") from its appid
export function importedKeyFor(state: UgiState, appid: number): string | undefined {
	return Object.entries(state.imported).find(([, e]) => e.appid === appid)?.[0];
}

export async function saveState(state: UgiState): Promise<boolean> {
	const json = JSON.stringify(state);
	stateRead = Promise.resolve(json);
	return ugiSaveState({ json }).catch((err) => {
		stateRead = null;
		throw err;
	});
}

const dialogResult = callable<[{ a_name: string }], string>('ugi_dialog_result');

// Opens one of Windows' dialogs through the backend and waits for the answer, however long the user
// takes: start opens it, the answer is then asked for twice a second (10 minutes at most)
export async function windowsDialog(start: () => Promise<unknown>, name: 'backup' | 'game' | 'folder'): Promise<string> {
	await start();
	for (let i = 0; i < 1200; i++) {
		await new Promise((r) => setTimeout(r, 500));
		try {
			const answer = JSON.parse(unquote(await dialogResult({ a_name: name })));
			if (!answer.pending) return String(answer.value ?? '');
		} catch {}
	}
	return '';
}
