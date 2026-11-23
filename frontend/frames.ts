// Cover frames: a launcher's icon in a corner of a game's covers, or a SteamGridDB template with a
// transparent window laid over them (the idea comes from Steam Commander, MIT, see THIRD_PARTY_NOTICES).
// Only the vertical (0) and horizontal (3) covers get one. The cover under the frame is kept by the
// backend (backend/frames.lua), so the frame can be changed or taken away at any time.
import { callable } from '@steambrew/client';
import { importedKeyFor, loadState, unquote } from 'backend';
import { FrameChoice, UgiState } from 'types';

const coverLoad = callable<[{ a_appid: number; b_type: number }], string>('ugi_frame_cover_load');
const originalPut = callable<[{ a_appid: number; b_type: number; c_ext: string; d_index: number; e_chunk: string }], boolean>('ugi_frame_original_put');
const originalDrop = callable<[{ a_appid: number; b_type: number }], boolean>('ugi_frame_original_drop');
const downloadChunk = callable<[{ a_url: string; b_index: number }], string>('ugi_download_chunk');
const downloadRelease = callable<[{ a_url: string }], boolean>('ugi_download_release');
const download = callable<[{ a_url: string }], number>('ugi_download');
const sgdbGet = callable<[{ a_key: string; b_endpoint: string }], string>('ugi_sgdb_get');

// SteamGridDB's API and the image downloads, as in sgdb.ts (which uses this module)
async function api(state: UgiState, endpoint: string): Promise<any> {
	if (!state.settings.sgdb_key) throw new Error('missing SteamGridDB API key');
	const body = JSON.parse(await sgdbGet({ a_key: state.settings.sgdb_key, b_endpoint: endpoint }));
	if (body?.http_status === 401) throw new Error('SteamGridDB API key not valid');
	return body;
}

async function fetchBase64(url: string): Promise<string | null> {
	const size = Number(unquote(await download({ a_url: url })));
	if (!size) return null;
	const parts: string[] = [];
	for (let i = 0; i <= Math.ceil(size / CHUNK); i++) {
		const chunk = unquote(await downloadChunk({ a_url: url, b_index: i }));
		if (!chunk) break;
		parts.push(chunk);
	}
	return parts.join('') || null;
}

export type CoverType = 0 | 3;
export const COVER_TYPES: CoverType[] = [0, 3];

// Where the templates and the badge come from: the SteamGridDB "games" of each launcher's program,
// where the community puts its frame templates (ids from Steam Commander's template list).
// Riot's client isn't there: it is looked up by name.
export const FRAME_SOURCES: Record<string, { ids: number[]; search?: string }> = {
	amazon: { ids: [5255884] },
	battlenet: { ids: [5248250] },
	ea: { ids: [5306742, 5266345] },
	epic: { ids: [5255885] },
	gog: { ids: [34605] },
	itch: { ids: [5259585] },
	riot: { ids: [], search: 'Riot Client' },
	ubisoft: { ids: [5270094, 35345] },
	xbox: { ids: [5297303, 5304587] },
	// Templates only (games added by hand have no launcher): Steam's own style of frames
	steam: { ids: [5279790] },
};

/** Where a game's templates are looked for at first: its launcher, else Steam's */
export const templateSource = (launcher?: string) => (launcher && FRAME_SOURCES[launcher] ? launcher : 'steam');
/** The badge needs a launcher with an icon */
export const hasBadge = (launcher?: string) => !!launcher && launcher !== 'steam' && !!FRAME_SOURCES[launcher];

// ---------- Which frame a game has ----------

export const NO_FRAME: FrameChoice = { kind: 'none' };

/** The frame of a game: its own, else its launcher's (none for games UGI didn't import) */
export function frameFor(state: UgiState, appid: number): { choice: FrameChoice; launcher?: string } {
	const key = importedKeyFor(state, appid);
	const entry = key ? state.imported[key] : undefined;
	if (!entry) return { choice: NO_FRAME };
	return { choice: entry.frame ?? state.settings.launchers?.[entry.launcher]?.frame ?? NO_FRAME, launcher: entry.launcher };
}

const hasFrame = (choice: FrameChoice, type: CoverType) =>
	choice.kind === 'badge' || (choice.kind === 'template' && !!(type === 0 ? choice.v : choice.h));

// ---------- Images ----------

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// The real format of an image, from its first bytes (the file name may say otherwise)
function formatOf(base64: string): string {
	const head = atob(base64.slice(0, 64));
	// Bytes compared by their codes: control characters in the bundle's strings break Steam's loader
	const at = (i: number) => head.charCodeAt(i);
	if (at(0) === 0x89 && head.slice(1, 4) === 'PNG') return 'png';
	if (at(0) === 0xff && at(1) === 0xd8) return 'jpg';
	if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
	if (head.startsWith('GIF8')) return 'gif';
	if (head.slice(4, 8) === 'ftyp' || (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3)) return 'video';
	return 'png';
}

// Animated covers keep no frame: drawing one would leave only their first picture
function isAnimated(base64: string, format: string): boolean {
	if (format === 'gif' || format === 'video') return true;
	// APNG and animated WebP say so near the start of the file
	const head = atob(base64.slice(0, 8192 - (8192 % 4)));
	if (format === 'png') return head.indexOf('acTL') >= 0 && head.indexOf('acTL') < (head.indexOf('IDAT') >>> 0);
	if (format === 'webp') return head.indexOf('ANIM') >= 0;
	return false;
}

function loadImage(base64: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image not readable'));
		img.src = `data:${MIME[formatOf(base64)] ?? 'image/png'};base64,${base64}`;
	});
}

// Downloaded images (templates and icons) stay in memory while Steam runs
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function imageAt(url: string): Promise<HTMLImageElement | null> {
	let found = imageCache.get(url);
	if (!found) {
		found = fetchBase64(url)
			.then((data) => (data ? loadImage(data) : null))
			.catch(() => null)
			.finally(() => downloadRelease({ a_url: url }).catch(() => {}));
		imageCache.set(url, found);
		// A failed download is tried again next time
		found.then((img) => !img && imageCache.delete(url));
	}
	return found;
}

/** The transparent window of a template: the transparent area around its centre, or null when it has none (or a small one) */
export function windowOf(img: HTMLImageElement): { x: number; y: number; w: number; h: number } | null {
	const w = img.naturalWidth, h = img.naturalHeight;
	if (w < 16 || h < 16) return null;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, w, h).data;
	const clear = (x: number, y: number) => data[(y * w + x) * 4 + 3]! <= 24;
	const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
	if (!clear(cx, cy)) return null;
	let l = cx, r = cx, t = cy, b = cy;
	while (l > 0 && clear(l - 1, cy)) l--;
	while (r < w - 1 && clear(r + 1, cy)) r++;
	while (t > 0 && clear(cx, t - 1)) t--;
	while (b < h - 1 && clear(cx, b + 1)) b++;
	const ww = r - l + 1, hh = b - t + 1;
	return ww * hh < (w * h) / 4 ? null : { x: l, y: t, w: ww, h: hh };
}

const iconCache = new Map<string, Promise<Template[]>>();
async function launcherGameIds(state: UgiState, launcher: string): Promise<number[]> {
	const source = FRAME_SOURCES[launcher];
	if (!source) return [];
	if (source.ids.length || !source.search) return source.ids;
	const res = await api(state, `search/autocomplete/${encodeURIComponent(source.search)}`);
	const id = res?.success && Array.isArray(res.data) ? res.data[0]?.id : undefined;
	return id ? [id] : [];
}

/** The icons of a launcher's program on SteamGridDB (square PNGs, official ones first): the badge is chosen among them */
export function iconsFor(state: UgiState, launcher: string): Promise<Template[]> {
	let found = iconCache.get(launcher);
	if (!found) {
		found = (async () => {
			const out: Template[] = [];
			for (const id of await launcherGameIds(state, launcher)) {
				const res = await api(state, `icons/game/${id}?styles=official,custom&mimes=image/png&types=static&nsfw=false&humor=false`);
				const list: { url: string; thumb: string; style?: string; width?: number; height?: number }[] = res?.success && Array.isArray(res.data) ? res.data : [];
				const square = list.filter((i) => !i.width || i.width === i.height);
				for (const i of [...square.filter((x) => x.style === 'official'), ...square.filter((x) => x.style !== 'official')]) out.push({ url: i.url, thumb: i.thumb });
			}
			return out;
		})();
		iconCache.set(launcher, found);
		found.catch(() => iconCache.delete(launcher));
	}
	return found;
}

// The badge's icon: the one chosen, else the launcher's first
async function badgeUrl(state: UgiState, launcher: string, chosen?: string): Promise<string | null> {
	return chosen ?? (await iconsFor(state, launcher).catch(() => []))[0]?.url ?? null;
}

// ---------- Drawing ----------

const toBase64 = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

/** The cover with its frame, as a PNG in base64 (null: nothing to draw) */
async function drawFramed(state: UgiState, cover: HTMLImageElement, choice: FrameChoice, type: CoverType, launcher?: string): Promise<string | null> {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.imageSmoothingQuality = 'high';
	const cw = cover.naturalWidth, ch = cover.naturalHeight;

	if (choice.kind === 'badge') {
		if (!launcher) return null;
		const url = await badgeUrl(state, launcher, choice.icon);
		const icon = url ? await imageAt(url) : null;
		if (!icon) return null;
		canvas.width = cw;
		canvas.height = ch;
		ctx.drawImage(cover, 0, 0);
		// As on Steam Commander: about a seventh of the short side, in the top corner (right on the
		// vertical cover, left on the horizontal one)
		const base = Math.min(cw, ch);
		const size = Math.max(24, Math.round(base * 0.147));
		const margin = Math.max(6, Math.round(base * 0.04));
		const x = type === 0 ? cw - size - margin : margin;
		ctx.shadowColor = 'rgba(0,0,0,0.6)';
		ctx.shadowBlur = Math.round(size / 8);
		ctx.drawImage(icon, x, margin, size, size);
		return toBase64(canvas);
	}

	if (choice.kind !== 'template') return null;
	const url = type === 0 ? choice.v : choice.h;
	const frame = url ? await imageAt(url) : null;
	if (!frame) return null;
	const fw = frame.naturalWidth, fh = frame.naturalHeight;
	canvas.width = fw;
	canvas.height = fh;
	// The cover fills the template's window (2 pixels more on each side, under the frame's edge), or
	// the whole template when the window isn't found; cropped from its centre to the window's shape
	const hole = windowOf(frame);
	const pad = 2;
	const dx = hole ? Math.max(0, hole.x - pad) : 0;
	const dy = hole ? Math.max(0, hole.y - pad) : 0;
	const dw = hole ? Math.min(fw, hole.x + hole.w + pad) - dx : fw;
	const dh = hole ? Math.min(fh, hole.y + hole.h + pad) - dy : fh;
	const scale = Math.max(dw / cw, dh / ch);
	const sw = dw / scale, sh = dh / scale;
	ctx.drawImage(cover, (cw - sw) / 2, (ch - sh) / 2, sw, sh, dx, dy, dw, dh);
	ctx.drawImage(frame, 0, 0, fw, fh);
	return toBase64(canvas);
}

// ---------- Applying ----------

const CHUNK = 3 * 1024 * 1024; // bytes of data per call (4 MiB of base64), as the downloads

async function keepOriginal(appid: number, type: CoverType, base64: string, format: string) {
	const step = (CHUNK / 3) * 4;
	for (let i = 0, index = 0; i < base64.length || index === 0; i += step, index++) {
		await originalPut({ a_appid: appid, b_type: type, c_ext: format, d_index: index, e_chunk: base64.slice(i, i + step) });
	}
}

function setArtwork(appid: number, type: CoverType, base64: string, ext: string) {
	// Not awaited: Steam may never settle these promises (see sgdb.ts applyImage)
	SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
	SteamClient.Apps.SetCustomArtworkForApp(appid, base64, ext === 'jpg' ? 'jpg' : 'png', type);
}

/**
 * Puts a cover on a game, with the game's frame over it when it has one. base64: the cover without
 * frame. state: read again when not given. Returns true once Steam was given an image.
 */
export async function applyCover(appid: number, type: CoverType, base64: string, ext: string, state?: UgiState): Promise<boolean> {
	const s = state ?? (await loadState());
	const { choice, launcher } = frameFor(s, appid);
	const format = formatOf(base64);
	if (hasFrame(choice, type) && !isAnimated(base64, format)) {
		try {
			const framed = await drawFramed(s, await loadImage(base64), choice, type, launcher);
			if (framed) {
				await keepOriginal(appid, type, base64, format);
				setArtwork(appid, type, framed, 'png');
				return true;
			}
		} catch (err) {
			console.error('[UGI] frame failed', appid, type, err);
		}
	}
	await originalDrop({ a_appid: appid, b_type: type });
	setArtwork(appid, type, base64, ext);
	return true;
}

// The cover without frame from the backend: the kept original, else the one Steam shows now
async function coverOf(appid: number, type: CoverType): Promise<{ base64: string; ext: string; kept: boolean } | null> {
	let info: { key?: string; size: number; ext?: string; kept?: boolean } = { size: 0 };
	try {
		info = JSON.parse(unquote(await coverLoad({ a_appid: appid, b_type: type })));
	} catch {}
	if (!info.size || !info.key) return null;
	const parts: string[] = [];
	try {
		for (let i = 0; i <= Math.ceil(info.size / CHUNK); i++) {
			const chunk = unquote(await downloadChunk({ a_url: info.key, b_index: i }));
			if (!chunk) break;
			parts.push(chunk);
		}
	} finally {
		await downloadRelease({ a_url: info.key });
	}
	const base64 = parts.join('');
	return base64 ? { base64, ext: info.ext === 'jpeg' ? 'jpg' : info.ext ?? 'png', kept: !!info.kept } : null;
}

/** Draws again the frames of a game's covers, after its frame or its launcher's changed */
export async function reframe(state: UgiState, appid: number): Promise<void> {
	const { choice } = frameFor(state, appid);
	for (const type of COVER_TYPES) {
		const cover = await coverOf(appid, type);
		// No cover to put a frame on, or a cover without frame that stays without one
		if (!cover || (!cover.kept && !hasFrame(choice, type))) continue;
		await applyCover(appid, type, cover.base64, cover.ext, state);
	}
}

/** The same for many games (a launcher's): progress(done, total) */
export async function reframeAll(state: UgiState, appids: number[], progress: (done: number, total: number) => void): Promise<void> {
	for (let i = 0; i < appids.length; i++) {
		progress(i, appids.length);
		try {
			await reframe(state, appids[i]!);
		} catch (err) {
			console.error('[UGI] reframe failed', appids[i], err);
		}
	}
	progress(appids.length, appids.length);
}

/** A cover put back to Steam's own: nothing kept under a frame any more */
export const forgetOriginal = (appid: number, type: number) => originalDrop({ a_appid: appid, b_type: type }).catch(() => {});

// ---------- Templates ----------

export type Template = { url: string; thumb: string };

const DIMENSIONS: Record<CoverType, string> = { 0: '600x900,342x482,660x930', 3: '920x430,460x215' };
const templateCache = new Map<string, Promise<Template[]>>();

/**
 * The templates of a launcher for one cover: its program's PNG images on SteamGridDB that have a
 * transparent window in the middle (the others are covers of the program itself, not frames).
 */
export function templatesFor(state: UgiState, launcher: string, type: CoverType): Promise<Template[]> {
	const key = `${launcher}:${type}`;
	let found = templateCache.get(key);
	if (!found) {
		found = (async () => {
			const out: Template[] = [];
			for (const id of await launcherGameIds(state, launcher)) {
				const res = await api(state, `grids/game/${id}?dimensions=${DIMENSIONS[type]}&mimes=image/png&types=static&nsfw=false&humor=any&epilepsy=any`);
				const list: { url: string; thumb: string }[] = res?.success && Array.isArray(res.data) ? res.data : [];
				// The thumbnails keep the transparency and are quick to download: four at a time
				const ok = new Array<boolean>(list.length).fill(false);
				let next = 0;
				const worker = async () => {
					while (next < list.length) {
						const i = next++;
						const thumb = await imageAt(list[i]!.thumb);
						ok[i] = !!thumb && !!windowOf(thumb);
					}
				};
				await Promise.all([worker(), worker(), worker(), worker()]);
				list.forEach((image, i) => ok[i] && out.push({ url: image.url, thumb: image.thumb }));
			}
			return out;
		})();
		templateCache.set(key, found);
		found.catch(() => templateCache.delete(key));
	}
	return found;
}
