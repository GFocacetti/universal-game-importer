import { callable } from '@steambrew/client';
import { UgiState } from 'types';

// Steam image types used by SetCustomArtworkForApp
export const IMAGE_TYPES = [0, 1, 2, 3, 4] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const IMAGE_TYPE_NAMES: Record<ImageType, string> = { 0: 'grid', 1: 'hero', 2: 'logo', 3: 'wide grid', 4: 'icon' };

const sgdbGet = callable<[{ a_key: string; b_endpoint: string }], string>('ugi_sgdb_get');
const download = callable<[{ a_url: string }], number>('ugi_download');
const downloadChunk = callable<[{ a_url: string; b_index: number }], string>('ugi_download_chunk');
const downloadRelease = callable<[{ a_url: string }], boolean>('ugi_download_release');
const downloadSave = callable<[{ a_url: string; b_name: string }], string>('ugi_download_save');
const missingImages = callable<[{ a_appids: string }], string>('ugi_missing_images');
const iconApply = callable<[{ a_url: string; b_appid: number }], boolean>('ugi_icon_apply');
const iconReset = callable<[{ a_appid: number }], boolean>('ugi_icon_reset');

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string; app_type?: number } | undefined };
const SHORTCUT_APP_TYPE = 1073741824;

type Filter = { endpoint: string; dimensions?: string; styles: string; mimes: string; nsfw: string; humor: string };

// Default SteamGridDB filters per image type (from Easy SteamGrid's defaults; epilepsy is always "any")
const FILTERS: Record<ImageType, Filter> = {
	0: { endpoint: 'grids', dimensions: '600x900,342x482,660x930', styles: 'alternate,blurred,white_logo,material,no_logo', mimes: 'image/png,image/jpeg', nsfw: 'false', humor: 'any' },
	1: { endpoint: 'heroes', styles: 'alternate,blurred,material', mimes: 'image/png,image/jpeg', nsfw: 'false', humor: 'any' },
	2: { endpoint: 'logos', styles: 'official,white,black,custom', mimes: 'image/png', nsfw: 'false', humor: 'any' },
	3: { endpoint: 'grids', dimensions: '460x215,920x430', styles: 'alternate,blurred,white_logo,material,no_logo', mimes: 'image/png,image/jpeg', nsfw: 'false', humor: 'any' },
	4: { endpoint: 'icons', styles: 'official,custom', mimes: 'image/png,image/vnd.microsoft.icon', nsfw: 'false', humor: 'any' },
};

// Choices offered by the gallery filters, per image type
export const FILTER_OPTIONS: Record<ImageType, { styles: string[]; dimensions: string[] }> = {
	0: { styles: ['alternate', 'blurred', 'white_logo', 'material', 'no_logo'], dimensions: ['600x900', '342x482', '660x930', '512x512', '1024x1024'] },
	1: { styles: ['alternate', 'blurred', 'material'], dimensions: ['1920x620', '3840x1240', '1600x650'] },
	2: { styles: ['official', 'white', 'black', 'custom'], dimensions: [] },
	3: { styles: ['alternate', 'blurred', 'white_logo', 'material', 'no_logo'], dimensions: ['460x215', '920x430'] },
	4: { styles: ['official', 'custom'], dimensions: [] },
};

// What the user picked in the gallery for one image type ("" = all)
export type UserFilter = { style?: string; dimension?: string; webp?: boolean; nsfw?: string; humor?: string };

function effectiveFilter(state: UgiState, type: ImageType): Filter {
	const base = FILTERS[type];
	const user: UserFilter = state.settings.filters?.[String(type)] ?? {};
	// WebP can be turned off: it crashed Steam on some systems with Easy SteamGrid
	const webp = user.webp ?? state.settings.webp;
	return {
		endpoint: base.endpoint,
		styles: user.style || base.styles,
		dimensions: user.dimension === undefined ? base.dimensions : user.dimension || undefined,
		mimes: webp && type !== 4 ? `${base.mimes},image/webp` : base.mimes,
		nsfw: user.nsfw || base.nsfw,
		humor: user.humor || base.humor,
	};
}

export type SgdbImage = { id: number; url: string; thumb: string; mime?: string };

// Optional step-by-step reporting (shown by the test panel while debugging)
let trace: (msg: string) => void = () => {};
export function setTrace(fn: (msg: string) => void) {
	trace = fn;
}

async function api(state: UgiState, endpoint: string): Promise<any> {
	if (!state.settings.sgdb_key) throw new Error('missing SteamGridDB API key');
	const raw = await sgdbGet({ a_key: state.settings.sgdb_key, b_endpoint: endpoint });
	let body: any;
	try {
		body = JSON.parse(raw);
	} catch {
		throw new Error('invalid SteamGridDB response');
	}
	if (body?.http_status === 401) throw new Error('SteamGridDB API key not valid');
	return body;
}

// UGI key of an imported shortcut ("gog:1207658754"), if the app is one
const importedKey = (state: UgiState, appid: number) => Object.entries(state.imported).find(([, e]) => e.appid === appid)?.[0];

// Key of the cached SteamGridDB id: the UGI key for imported games (it survives a re-import), else the appid
export const sgdbCacheKey = (state: UgiState, appid: number) => importedKey(state, appid) ?? String(appid);

// Same words, ignoring case and punctuation ("DungeonKeeper" is not "Dungeon Keeper")
const simplify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// SteamGridDB game id for a Steam app or shortcut (cached in the state)
export async function gameIdFor(state: UgiState, appid: number): Promise<number | null> {
	const key = sgdbCacheKey(state, appid);
	if (state.sgdb_ids[key]) return state.sgdb_ids[key];
	const overview = appStore.GetAppOverviewByAppID(appid);
	let id: number | null = null;
	if (overview?.app_type !== SHORTCUT_APP_TYPE) {
		const res = await api(state, `games/steam/${appid}`);
		id = res?.success ? res.data?.id ?? null : null;
	} else {
		// Epic and GOG games: SteamGridDB knows them by their store id (more precise than the title).
		// Battle.net codes aren't used: SteamGridDB maps some to an older edition (S1 -> the original StarCraft).
		const imported = importedKey(state, appid);
		const platform = imported?.startsWith('epic:') ? 'egs' : imported?.startsWith('gog:') ? 'gog' : null;
		if (platform && imported) {
			const res = await api(state, `games/${platform}/${encodeURIComponent(imported.slice(imported.indexOf(':') + 1))}`);
			id = res?.success ? res.data?.id ?? null : null;
		}
	}
	const name = overview?.display_name;
	if (!id && name) {
		// Prefer a result with the same name, else SteamGridDB's best match
		const res = await api(state, `search/autocomplete/${encodeURIComponent(name)}`);
		const results: { id: number; name: string }[] = res?.success && Array.isArray(res.data) ? res.data : [];
		id = (results.find((r) => simplify(r.name) === simplify(name)) ?? results[0])?.id ?? null;
	}
	if (id) state.sgdb_ids[key] = id;
	return id;
}

// Images for one type, in SteamGridDB's order. "auto" puts animated first when preferred;
// the gallery asks for only static or only animated images.
export async function imagesFor(state: UgiState, gameId: number, type: ImageType, mode: 'auto' | 'static' | 'animated' = 'auto'): Promise<SgdbImage[]> {
	const f = effectiveFilter(state, type);
	const query = (types: string) =>
		`${f.endpoint}/game/${gameId}?styles=${f.styles}&mimes=${f.mimes}&nsfw=${f.nsfw}&humor=${f.humor}&epilepsy=any&types=${types}` +
		(f.dimensions ? `&dimensions=${f.dimensions}` : '');
	const get = async (types: string): Promise<SgdbImage[]> => {
		const res = await api(state, query(types));
		return res?.success && Array.isArray(res.data) ? res.data : [];
	};
	if (mode !== 'auto') return get(mode);
	if (state.settings.animated) return [...(await get('animated')), ...(await get('static'))];
	return get('static');
}

const extOf = (url: string) => (/\.(jpe?g|jfif)(\?|$)/i.test(url) ? 'jpg' : 'png');

// Millennium may hand string results back still wrapped in JSON quotes
const unquote = (value: unknown) => String(value ?? '').replace(/^"|"$/g, '');

async function fetchBase64(url: string): Promise<string | null> {
	const size = Number(unquote(await download({ a_url: url })));
	if (!size) return null;
	const parts: string[] = [];
	// 3 MiB per chunk; the cap guards against an endless loop
	const maxChunks = Math.ceil(size / (3 * 1024 * 1024)) + 1;
	for (let i = 0; i < maxChunks; i++) {
		const chunk = unquote(await downloadChunk({ a_url: url, b_index: i }));
		if (!chunk) break;
		parts.push(chunk);
	}
	return parts.join('') || null;
}

// Applies one SteamGridDB image to an app; returns false if it couldn't be downloaded
export async function applyImage(appid: number, type: ImageType, url: string): Promise<boolean> {
	const isShortcut = appStore.GetAppOverviewByAppID(appid)?.app_type === SHORTCUT_APP_TYPE;
	try {
		if (type === 4) {
			if (!Number(unquote(await download({ a_url: url })))) return false;
			// Steam games: icon files written where Steam reads them; shortcuts: icon path through the client API
			if (!isShortcut) return String(unquote(await iconApply({ a_url: url, b_appid: appid }))) === 'true';
			const path = unquote(await downloadSave({ a_url: url, b_name: `${appid}_icon.${extOf(url)}` }));
			if (!path) return false;
			SteamClient.Apps.SetShortcutIcon(appid, path);
			return true;
		}
		trace(`${appid} ${IMAGE_TYPE_NAMES[type]}: downloading`);
		const data = await fetchBase64(url);
		if (!data) return false;
		trace(`${appid} ${IMAGE_TYPE_NAMES[type]}: applying`);
		// Not awaited: Steam may never settle these promises (Easy SteamGrid doesn't await them either)
		SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
		SteamClient.Apps.SetCustomArtworkForApp(appid, data, extOf(url), type);
		return true;
	} finally {
		await downloadRelease({ a_url: url });
	}
}

// Applies the first image of the given type that downloads correctly
async function applyFirst(state: UgiState, appid: number, type: ImageType): Promise<boolean> {
	trace(`${appid} ${IMAGE_TYPE_NAMES[type]}: finding the game`);
	const gameId = await gameIdFor(state, appid);
	if (!gameId) return false;
	trace(`${appid} ${IMAGE_TYPE_NAMES[type]}: searching images`);
	for (const image of await imagesFor(state, gameId, type)) {
		if (await applyImage(appid, type, image.url)) return true;
	}
	return false;
}

// Shortcut icons leave no file Steam's detection sees, so one set by UGI is remembered
function wantedTypes(state: UgiState, appid: number, types: ImageType[]): ImageType[] {
	const isShortcut = appStore.GetAppOverviewByAppID(appid)?.app_type === SHORTCUT_APP_TYPE;
	return types.filter((t) => t !== 4 || !isShortcut || !state.custom_icons[String(appid)]);
}

async function applyTracked(state: UgiState, appid: number, type: ImageType): Promise<boolean> {
	const ok = await applyFirst(state, appid, type);
	if (ok && type === 4) state.custom_icons[String(appid)] = true;
	return ok;
}

// ---------- Bulk tools ----------

export type Progress = (done: number, total: number) => void;
export type StopFlag = { stop: boolean };

// Missing image types per app, read from Steam's local artwork (official + custom)
export async function missingFor(appids: number[]): Promise<Record<string, ImageType[]>> {
	const out: Record<string, ImageType[]> = {};
	for (let i = 0; i < appids.length; i += 100) {
		const raw = await missingImages({ a_appids: JSON.stringify(appids.slice(i, i + 100)) });
		let part: Record<string, string> = {};
		try {
			part = JSON.parse(raw);
		} catch {}
		for (const [id, list] of Object.entries(part)) {
			out[id] = list ? (list.split(',').map(Number) as ImageType[]) : [];
		}
	}
	return out;
}

export async function checkMissing(appids: number[]): Promise<Record<ImageType, number>> {
	const counts: Record<ImageType, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
	for (const list of Object.values(await missingFor(appids))) list.forEach((t) => counts[t]++);
	return counts;
}

export async function fillMissing(state: UgiState, appids: number[], progress: Progress, flag: StopFlag): Promise<number> {
	const missing = await missingFor(appids);
	let applied = 0;
	for (let i = 0; i < appids.length && !flag.stop; i++) {
		progress(i, appids.length);
		for (const type of wantedTypes(state, appids[i]!, missing[String(appids[i]!)] ?? [])) {
			try {
				if (await applyTracked(state, appids[i]!, type)) applied++;
			} catch (err) {
				console.error('[UGI] image failed', appids[i]!, type, err);
				if (String(err).includes('API key')) throw err;
			}
		}
	}
	progress(appids.length, appids.length);
	return applied;
}

export async function replaceAll(state: UgiState, appids: number[], types: ImageType[], progress: Progress, flag: StopFlag): Promise<number> {
	let applied = 0;
	for (let i = 0; i < appids.length && !flag.stop; i++) {
		progress(i, appids.length);
		for (const type of wantedTypes(state, appids[i]!, types)) {
			try {
				if (await applyTracked(state, appids[i]!, type)) applied++;
			} catch (err) {
				console.error('[UGI] image failed', appids[i]!, type, err);
				if (String(err).includes('API key')) throw err;
			}
		}
	}
	progress(appids.length, appids.length);
	return applied;
}

// Picks every image of one game again, the icon included (gallery and detail panel).
// The game is looked up again too, in case the saved match was wrong.
export async function replaceGame(state: UgiState, appid: number): Promise<number> {
	delete state.custom_icons[String(appid)];
	delete state.sgdb_ids[sgdbCacheKey(state, appid)];
	return replaceAll(state, [appid], [...IMAGE_TYPES], () => {}, { stop: false });
}

// One image type back to Steam's original
export async function resetImage(appid: number, type: ImageType): Promise<void> {
	if (type === 4) {
		if (appStore.GetAppOverviewByAppID(appid)?.app_type !== SHORTCUT_APP_TYPE) await iconReset({ a_appid: appid });
		return;
	}
	SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
}

// Back to Steam's original artwork (custom grid, hero, logo, wide grid and Steam game icons)
export async function resetImages(appids: number[], progress: Progress, flag: StopFlag): Promise<void> {
	for (let i = 0; i < appids.length && !flag.stop; i++) {
		progress(i, appids.length);
		for (const type of [0, 1, 2, 3] as ImageType[]) SteamClient.Apps.ClearCustomArtworkForApp(appids[i]!, type);
		if (appStore.GetAppOverviewByAppID(appids[i]!)?.app_type !== SHORTCUT_APP_TYPE) await iconReset({ a_appid: appids[i]! });
	}
	progress(appids.length, appids.length);
}
