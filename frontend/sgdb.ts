import { callable } from '@steambrew/client';
import { importedKeyFor, unquote } from 'backend';
import { isShortcut, simplifyName } from 'steamApps';
import { UgiState } from 'types';

// Steam image types used by SetCustomArtworkForApp
const IMAGE_TYPES = [0, 1, 2, 3, 4] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const sgdbGet = callable<[{ a_key: string; b_endpoint: string }], string>('ugi_sgdb_get');
const download = callable<[{ a_url: string }], number>('ugi_download');
const downloadChunk = callable<[{ a_url: string; b_index: number }], string>('ugi_download_chunk');
const downloadRelease = callable<[{ a_url: string }], boolean>('ugi_download_release');
const downloadSave = callable<[{ a_url: string; b_name: string }], string>('ugi_download_save');
const missingImages = callable<[{ a_appids: string }], string>('ugi_missing_images');
const iconApply = callable<[{ a_url: string; b_appid: number }], boolean>('ugi_icon_apply');
const iconReset = callable<[{ a_appid: number }], boolean>('ugi_icon_reset');
// Steam apps whose artwork UGI changed, so that removing UGI can put them back
const customMark = callable<[{ a_appid: number }], boolean>('ugi_custom_mark');

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string } | undefined };

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

// Key of the cached SteamGridDB id: the UGI key for imported games (it survives a re-import), else the appid
export const sgdbCacheKey = (state: UgiState, appid: number) => importedKeyFor(state, appid) ?? String(appid);

// SteamGridDB game id for a Steam app or shortcut (cached in the state)
export async function gameIdFor(state: UgiState, appid: number): Promise<number | null> {
	const key = sgdbCacheKey(state, appid);
	// The game chosen in the game's window comes first
	const chosen = state.imported[key]?.profile?.sgdb?.id;
	if (chosen) return chosen;
	if (state.sgdb_ids[key]) return state.sgdb_ids[key];
	let id: number | null = null;
	if (!isShortcut(appid)) {
		const res = await api(state, `games/steam/${appid}`);
		id = res?.success ? res.data?.id ?? null : null;
	} else {
		// Epic and GOG games: SteamGridDB knows them by their store id (more precise than the title).
		// Battle.net codes aren't used: SteamGridDB maps some to an older edition (S1 -> the original StarCraft).
		const imported = importedKeyFor(state, appid);
		const platform = imported?.startsWith('epic:') ? 'egs' : imported?.startsWith('gog:') ? 'gog' : null;
		if (platform && imported) {
			const res = await api(state, `games/${platform}/${encodeURIComponent(imported.slice(imported.indexOf(':') + 1))}`);
			id = res?.success ? res.data?.id ?? null : null;
		}
	}
	// An imported game by its own name (in Steam it may carry its launcher, when Steam has it too)
	const name = state.imported[importedKeyFor(state, appid) ?? '']?.name ?? appStore.GetAppOverviewByAppID(appid)?.display_name;
	if (!id && name) {
		// Prefer a result with the same name, else SteamGridDB's best match
		const res = await api(state, `search/autocomplete/${encodeURIComponent(name)}`);
		const results: { id: number; name: string }[] = res?.success && Array.isArray(res.data) ? res.data : [];
		id = (results.find((r) => simplifyName(r.name) === simplifyName(name)) ?? results[0])?.id ?? null;
	}
	if (id) state.sgdb_ids[key] = id;
	return id;
}

// SteamGridDB's games with a name like this one, with the year they came out (to choose from)
export async function searchGames(state: UgiState, name: string): Promise<{ id: number; name: string; year?: string }[]> {
	const res = await api(state, `search/autocomplete/${encodeURIComponent(name)}`);
	const results: { id: number; name: string; release_date?: number }[] = res?.success && Array.isArray(res.data) ? res.data : [];
	return results.map((r) => ({ id: r.id, name: r.name, year: r.release_date ? String(new Date(r.release_date * 1000).getFullYear()) : undefined }));
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
	const shortcut = isShortcut(appid);
	if (!shortcut) customMark({ a_appid: appid }).catch(() => {});
	try {
		if (type === 4) {
			if (!Number(unquote(await download({ a_url: url })))) return false;
			// Steam games: icon files written where Steam reads them; shortcuts: icon path through the client API
			if (!shortcut) return String(unquote(await iconApply({ a_url: url, b_appid: appid }))) === 'true';
			const path = unquote(await downloadSave({ a_url: url, b_name: `${appid}_icon.${extOf(url)}` }));
			if (!path) return false;
			SteamClient.Apps.SetShortcutIcon(appid, path);
			return true;
		}
		const data = await fetchBase64(url);
		if (!data) return false;
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
	const gameId = await gameIdFor(state, appid);
	if (!gameId) return false;
	for (const image of await imagesFor(state, gameId, type)) {
		if (await applyImage(appid, type, image.url)) return true;
	}
	return false;
}

// Shortcut icons leave no file Steam's detection sees, so one set by UGI is remembered
function wantedTypes(state: UgiState, appid: number, types: ImageType[]): ImageType[] {
	const shortcut = isShortcut(appid);
	return types.filter((t) => t !== 4 || !shortcut || !state.custom_icons[String(appid)]);
}

async function applyTracked(state: UgiState, appid: number, type: ImageType): Promise<boolean> {
	const ok = await applyFirst(state, appid, type);
	if (ok && type === 4) state.custom_icons[String(appid)] = true;
	return ok;
}

// ---------- Bulk tools ----------

// done / total games; applied images and changed games so far
type Progress = (done: number, total: number, applied?: number, games?: number) => void;
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
	return applyToAll(state, appids, (appid) => missing[String(appid)] ?? [], progress, flag);
}

export async function replaceAll(state: UgiState, appids: number[], types: ImageType[], progress: Progress, flag: StopFlag): Promise<number> {
	return applyToAll(state, appids, () => types, progress, flag);
}

// Applies the given image types to each app in turn; returns how many images were applied
async function applyToAll(state: UgiState, appids: number[], typesFor: (appid: number) => ImageType[], progress: Progress, flag: StopFlag): Promise<number> {
	let applied = 0;
	let games = 0;
	for (let i = 0; i < appids.length && !flag.stop; i++) {
		progress(i, appids.length, applied, games);
		const before = applied;
		for (const type of wantedTypes(state, appids[i]!, typesFor(appids[i]!))) {
			try {
				if (await applyTracked(state, appids[i]!, type)) applied++;
			} catch (err) {
				console.error('[UGI] image failed', appids[i]!, type, err);
				if (String(err).includes('API key')) throw err;
			}
		}
		if (applied > before) games++;
	}
	progress(appids.length, appids.length, applied, games);
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
		if (!isShortcut(appid)) await iconReset({ a_appid: appid });
		return;
	}
	SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
}

// Back to Steam's original artwork (custom grid, hero, logo, wide grid and Steam game icons)
export async function resetImages(appids: number[], progress: Progress, flag: StopFlag): Promise<void> {
	for (let i = 0; i < appids.length && !flag.stop; i++) {
		progress(i, appids.length);
		for (const type of [0, 1, 2, 3] as ImageType[]) SteamClient.Apps.ClearCustomArtworkForApp(appids[i]!, type);
		if (!isShortcut(appids[i]!)) await iconReset({ a_appid: appids[i]! });
	}
	progress(appids.length, appids.length);
}
