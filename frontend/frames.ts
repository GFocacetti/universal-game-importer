// Cover frames: a launcher's icon in a corner of a game's covers, or a SteamGridDB template with a
// transparent window laid over them (the idea comes from Steam Commander, MIT, see THIRD_PARTY_NOTICES).
// Only the vertical (0) and horizontal (3) covers get one. The cover under the frame is kept by the
// backend (backend/frames.lua), so the frame can be changed or taken away at any time.
import { callable } from '@steambrew/client';
import { importedKeyFor, loadState, saveState, unquote } from 'backend';
import { FrameChoice, UgiState } from 'types';
import { isShortcut } from 'steamApps';

const coverLoad = callable<[{ a_appid: number; b_type: number }], string>('ugi_frame_cover_load');
const originalPut = callable<[{ a_appid: number; b_type: number; c_ext: string; d_index: number; e_chunk: string; f_official: boolean }], boolean>('ugi_frame_original_put');
const customMark = callable<[{ a_appid: number }], boolean>('ugi_custom_mark');
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
export type FrameGroup = 'launcher' | 'nintendo' | 'playstation' | 'xbox' | 'sega' | 'atari' | 'other';

// Launchers first (their badge and templates), then consoles and other platforms: templates only, for
// games of any launcher or added by hand (emulated ones). name: shown in the list (launchers use LAUNCHER_NAMES).
export const FRAME_SOURCES: Record<string, { ids: number[]; search?: string; name?: string; group: FrameGroup }> = {
	amazon: { ids: [5255884], group: 'launcher' },
	battlenet: { ids: [5248250], group: 'launcher' },
	ea: { ids: [5306742, 5266345], group: 'launcher' },
	epic: { ids: [5255885], group: 'launcher' },
	gog: { ids: [34605], group: 'launcher' },
	itch: { ids: [5259585], group: 'launcher' },
	riot: { ids: [], search: 'Riot Client', group: 'launcher' },
	ubisoft: { ids: [5270094, 35345], group: 'launcher' },
	xbox: { ids: [5297303, 5304587], group: 'launcher' },
	steam: { ids: [5279790], name: 'Steam', group: 'launcher' },
	"switch2": { ids: [5476349], name: "Nintendo Switch 2", group: 'nintendo' },
	"switch": { ids: [5271314], name: "Nintendo Switch", group: 'nintendo' },
	"wiiu": { ids: [5283561], name: "Wii U", group: 'nintendo' },
	"wii": { ids: [5299128], name: "Wii", group: 'nintendo' },
	"gamecube": { ids: [5327259], name: "GameCube", group: 'nintendo' },
	"n64": { ids: [5321187], name: "Nintendo 64", group: 'nintendo' },
	"snes": { ids: [5321369], name: "Super Nintendo", group: 'nintendo' },
	"sfc": { ids: [5454229], name: "Super Famicom", group: 'nintendo' },
	"nes": { ids: [5321195], name: "NES", group: 'nintendo' },
	"famicom": { ids: [5454226], name: "Famicom", group: 'nintendo' },
	"fds": { ids: [5454227], name: "Famicom Disk System", group: 'nintendo' },
	"3ds": { ids: [5283557], name: "Nintendo 3DS", group: 'nintendo' },
	"ds": { ids: [5327260], name: "Nintendo DS", group: 'nintendo' },
	"gba": { ids: [5321240], name: "Game Boy Advance", group: 'nintendo' },
	"gbc": { ids: [5331036], name: "Game Boy Color", group: 'nintendo' },
	"gb": { ids: [5330114], name: "Game Boy", group: 'nintendo' },
	"virtualboy": { ids: [5498433], name: "Virtual Boy", group: 'nintendo' },
	"satellaview": { ids: [5461962], name: "Satellaview", group: 'nintendo' },
	"eshop": { ids: [5256600], name: "Nintendo eShop", group: 'nintendo' },
	"ps5": { ids: [5327255], name: "PlayStation 5", group: 'playstation' },
	"ps4": { ids: [5327254], name: "PlayStation 4", group: 'playstation' },
	"ps3": { ids: [5327253], name: "PlayStation 3", group: 'playstation' },
	"ps2": { ids: [5327252], name: "PlayStation 2", group: 'playstation' },
	"ps1": { ids: [5327251], name: "PlayStation", group: 'playstation' },
	"psp": { ids: [5327257], name: "PSP", group: 'playstation' },
	"psvita": { ids: [5327258], name: "PS Vita", group: 'playstation' },
	"ps4remote": { ids: [5247907], name: "PS4 Remote Play", group: 'playstation' },
	"xboxseries": { ids: [5459777], name: "Xbox Series X|S", group: 'xbox' },
	"xboxone": { ids: [5459764], name: "Xbox One", group: 'xbox' },
	"xbox360": { ids: [5338852], name: "Xbox 360", group: 'xbox' },
	"xboxog": { ids: [5255377], name: "Xbox", group: 'xbox' },
	"xcloud": { ids: [5302079], name: "Xbox Cloud Gaming", group: 'xbox' },
	"xboxstreaming": { ids: [5258643], name: "Xbox Game Streaming", group: 'xbox' },
	"dreamcast": { ids: [5327256], name: "Dreamcast", group: 'sega' },
	"saturn": { ids: [5414839], name: "Saturn", group: 'sega' },
	"megadrive": { ids: [5353218], name: "Mega Drive", group: 'sega' },
	"genesis": { ids: [5355019], name: "Genesis", group: 'sega' },
	"megacd": { ids: [5415874], name: "Mega-CD", group: 'sega' },
	"segacd": { ids: [5461937], name: "Sega CD", group: 'sega' },
	"32x": { ids: [5495151], name: "32X", group: 'sega' },
	"mastersystem": { ids: [5450226], name: "Master System", group: 'sega' },
	"gamegear": { ids: [5432252], name: "Game Gear", group: 'sega' },
	"pico": { ids: [5461939], name: "Sega Pico", group: 'sega' },
	"segavideo": { ids: [5459781], name: "Sega Video Driver", group: 'sega' },
	"2600": { ids: [5459692], name: "Atari 2600", group: 'atari' },
	"5200": { ids: [5459724], name: "Atari 5200", group: 'atari' },
	"7800": { ids: [5459760], name: "Atari 7800", group: 'atari' },
	"jaguar": { ids: [5501337], name: "Atari Jaguar", group: 'atari' },
	"lynx": { ids: [5501402], name: "Atari Lynx", group: 'atari' },
	"xegs": { ids: [5459763], name: "Atari XEGS", group: 'atari' },
	"steamdeck": { ids: [5321601], name: "Steam Deck", group: 'other' },
	"neogeo": { ids: [5459988], name: "Neo Geo", group: 'other' },
	"neogeocd": { ids: [5461961], name: "Neo Geo CD", group: 'other' },
	"ngpc": { ids: [5432303], name: "Neo Geo Pocket Color", group: 'other' },
	"tgcd": { ids: [5454241], name: "TurboGrafx-CD", group: 'other' },
	"pcfx": { ids: [5452359], name: "PC-FX", group: 'other' },
	"3do": { ids: [5496257], name: "3DO", group: 'other' },
	"intellivision": { ids: [5459714], name: "Intellivision", group: 'other' },
	"zxspectrum": { ids: [5511447], name: "ZX Spectrum", group: 'other' },
	"windows": { ids: [5269176], name: "Windows", group: 'other' },
	"dos": { ids: [5248424], name: "DOS", group: 'other' },
	"scummvm": { ids: [5248828], name: "ScummVM", group: 'other' },
	"ody": { ids: [5459689], name: "Magnavox Odyssey", group: 'other' },
	"ody2": { ids: [5459701], name: "Magnavox Odyssey²", group: 'other' },
	"channelf": { ids: [5459690], name: "Fairchild Channel F", group: 'other' },
	"arcadia": { ids: [5459719], name: "Emerson Arcadia 2001", group: 'other' },
	"vc4000": { ids: [5459695], name: "Interton VC 4000", group: 'other' },
	"win11": { ids: [5288620], name: "Windows 11", group: 'other' },
	"win8": { ids: [5269187], name: "Windows 8", group: 'other' },
	"linux": { ids: [5268711], name: "Linux", group: 'other' },
	"ios": { ids: [5285505], name: "iOS", group: 'other' },
	"waydroid": { ids: [5441196], name: "Waydroid", group: 'other' },
	"flatpak": { ids: [5496814], name: "Flatpak", group: 'other' },
	"retroarch": { ids: [5245768], name: "RetroArch", group: 'other' },
	"dolphin": { ids: [34346], name: "Dolphin", group: 'other' },
	"cemu": { ids: [36024], name: "Cemu", group: 'other' },
	"yuzu": { ids: [5245878], name: "yuzu", group: 'other' },
	"melonds": { ids: [5246939], name: "melonDS", group: 'other' },
	"project64": { ids: [35778], name: "Project64", group: 'other' },
	"duckstation": { ids: [5267970], name: "DuckStation", group: 'other' },
	"pcsx2": { ids: [35439], name: "PCSX2", group: 'other' },
	"rpcs3": { ids: [5245879], name: "RPCS3", group: 'other' },
	"ppsspp": { ids: [36515], name: "PPSSPP", group: 'other' },
	"eduke32": { ids: [5304424], name: "EDuke32", group: 'other' },
	"rockstar": { ids: [5248353], name: "Rockstar Games Launcher", group: 'other' },
	"bethesda": { ids: [5248259], name: "Bethesda Launcher", group: 'other' },
	"msstore": { ids: [5304587], name: "Microsoft Store", group: 'other' },
	"gamepass": { ids: [5297303], name: "Xbox Game Pass", group: 'other' },
	"eaplay": { ids: [5266345], name: "EA Play", group: 'other' },
	"uplay": { ids: [35345], name: "uPlay", group: 'other' },
	"humble": { ids: [5333415], name: "Humble Bundle", group: 'other' },
	"indiegala": { ids: [5317258], name: "IndieGala", group: 'other' },
	"hydra": { ids: [5464105], name: "Hydra Launcher", group: 'other' },
	"luna": { ids: [5272872], name: "Amazon Luna", group: 'other' },
	"flashpoint": { ids: [5506492], name: "Flashpoint Archive", group: 'other' },
	"flash": { ids: [5290525], name: "Adobe Flash Player", group: 'other' },
	"sgdb": { ids: [5253321], name: "SteamGridDB", group: 'other' },
	"jackbox": { ids: [5458430], name: "Jackbox Megapicker", group: 'other' },
	"osrs": { ids: [35657], name: "Old School RuneScape", group: 'other' },
	"vhs": { ids: [5456407], name: "VHS", group: 'other' },
};

/** Where a game's templates are looked for at first: its launcher, else Steam's */
export const templateSource = (launcher?: string) => (launcher && FRAME_SOURCES[launcher]?.group === 'launcher' ? launcher : 'steam');
/** The badge needs a launcher with an icon */
export const hasBadge = (launcher?: string) => !!launcher && launcher !== 'steam' && FRAME_SOURCES[launcher]?.group === 'launcher';

// ---------- Which frame a game has ----------

export const NO_FRAME: FrameChoice = { kind: 'none' };

declare const collectionStore: { GetCollection(id: string): { apps?: { has(appid: number): boolean }; allApps?: { appid: number; app_type?: number }[]; displayName?: string } | undefined };

/** The Steam collection with a frame a game is in (the one applied last, when it is in several) */
export function collectionFrameInfo(state: UgiState, appid: number): { id: string; name: string; frame: FrameChoice } | undefined {
	const list = Object.entries(state.collection_frames ?? {}).sort((a, b) => b[1].applied - a[1].applied);
	for (const [id, set] of list) {
		try {
			const collection = collectionStore.GetCollection(id);
			if (collection?.apps?.has(appid)) return { id, name: collection.displayName ?? id, frame: set.frame };
		} catch {}
	}
	return undefined;
}

export const collectionFrameFor = (state: UgiState, appid: number) => collectionFrameInfo(state, appid)?.frame;

/**
 * The frame of a game: its own, else its collection's, else its launcher's. Steam games and games
 * added by hand only get one of their own or from a collection.
 */
export function frameFor(state: UgiState, appid: number): { choice: FrameChoice; launcher?: string } {
	const key = importedKeyFor(state, appid);
	const entry = key ? state.imported[key] : undefined;
	const launcher = entry?.launcher;
	if (entry?.frame) return { choice: entry.frame, launcher };
	const fromCollection = collectionFrameFor(state, appid);
	if (fromCollection) return { choice: fromCollection, launcher };
	return { choice: (launcher && state.settings.launchers?.[launcher]?.frame) || NO_FRAME, launcher };
}

// What is drawn on a game's covers, to see whether they need drawing again ('' = no frame)
export const frameSig = (choice: FrameChoice) => (choice.kind === 'none' ? '' : JSON.stringify(choice));

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

async function keepOriginal(appid: number, type: CoverType, base64: string, format: string, official: boolean) {
	const step = (CHUNK / 3) * 4;
	for (let i = 0, index = 0; i < base64.length || index === 0; i += step, index++) {
		await originalPut({ a_appid: appid, b_type: type, c_ext: format, d_index: index, e_chunk: base64.slice(i, i + step), f_official: official });
	}
}

function setArtwork(appid: number, type: CoverType, base64: string, ext: string) {
	// Not awaited: Steam may never settle these promises (see sgdb.ts applyImage)
	SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
	SteamClient.Apps.SetCustomArtworkForApp(appid, base64, ext === 'jpg' ? 'jpg' : 'png', type);
}

/**
 * Puts a cover on a game, with the game's frame over it when it has one. base64: the cover without
 * frame. state: read again when not given. official: the cover is Steam's own (a Steam game without
 * custom artwork): without frame it is given back by clearing the custom artwork. Returns true once
 * Steam was given an image.
 */
export async function applyCover(appid: number, type: CoverType, base64: string, ext: string, state?: UgiState, official = false): Promise<boolean> {
	const s = state ?? (await loadState());
	// Steam games whose artwork UGI changes are remembered, so that removing UGI puts theirs back
	if (!isShortcut(appid)) customMark({ a_appid: appid }).catch(() => {});
	const { choice, launcher } = frameFor(s, appid);
	const format = formatOf(base64);
	if (hasFrame(choice, type) && !isAnimated(base64, format)) {
		try {
			const framed = await drawFramed(s, await loadImage(base64), choice, type, launcher);
			if (framed) {
				await keepOriginal(appid, type, base64, format, official);
				setArtwork(appid, type, framed, 'png');
				return true;
			}
		} catch (err) {
			console.error('[UGI] frame failed', appid, type, err);
		}
	}
	await originalDrop({ a_appid: appid, b_type: type });
	if (official) SteamClient.Apps.ClearCustomArtworkForApp(appid, type);
	else setArtwork(appid, type, base64, ext);
	return true;
}

// The cover without frame from the backend: the kept original, else the one Steam shows now
async function coverOf(appid: number, type: CoverType): Promise<{ base64: string; ext: string; kept: boolean; official: boolean } | null> {
	let info: { key?: string; size: number; ext?: string; kept?: boolean; official?: boolean } = { size: 0 };
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
	return base64 ? { base64, ext: info.ext === 'jpeg' ? 'jpg' : info.ext ?? 'png', kept: !!info.kept, official: !!info.official } : null;
}

/**
 * Draws again the frames of a game's covers, after its frame, its collection's or its launcher's
 * changed. What was drawn is noted in state.framed (the caller saves the state).
 */
export async function reframe(state: UgiState, appid: number): Promise<void> {
	const { choice } = frameFor(state, appid);
	const sig = frameSig(choice);
	if (sig) (state.framed ??= {})[String(appid)] = sig;
	else if (state.framed) delete state.framed[String(appid)];
	for (const type of COVER_TYPES) {
		const cover = await coverOf(appid, type);
		// No cover to put a frame on, or a cover without frame that stays without one
		if (!cover || (!cover.kept && !hasFrame(choice, type))) continue;
		await applyCover(appid, type, cover.base64, cover.ext, state, cover.official);
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

// ---------- Collections ----------

// Games and non-Steam shortcuts of a Steam collection (soundtracks, tools and videos have no covers to frame)
const GAME = 1, SHORTCUT = 1073741824;
export function collectionGames(id: string): number[] {
	try {
		return (collectionStore.GetCollection(id)?.allApps ?? []).filter((a) => a.app_type === GAME || a.app_type === SHORTCUT).map((a) => a.appid);
	} catch {
		return [];
	}
}

/**
 * A collection's frame goes on all its games at once, over the frames chosen for single games (they
 * follow the collection from then on); the collection applied last wins over the others. choice none:
 * the collection has no frame any more, its games go back to their launcher's.
 */
export async function saveCollectionFrame(id: string, choice: FrameChoice | undefined, progress: (done: number, total: number) => void): Promise<void> {
	const s = await loadState();
	s.collection_frames ??= {};
	if (choice && choice.kind !== 'none') s.collection_frames[id] = { frame: choice, applied: Date.now() };
	else delete s.collection_frames[id];
	const games = collectionGames(id);
	for (const appid of games) {
		const key = importedKeyFor(s, appid);
		if (key) delete s.imported[key]!.frame;
	}
	await saveState(s);
	await reframeAll(s, games, progress);
	await saveState(s);
}

/**
 * Games that entered a collection with a frame since it was applied (Steam's dynamic collections
 * change by themselves): their frame is drawn. Those that left keep theirs. Returns how many changed.
 */
export async function checkCollectionFrames(): Promise<number> {
	const s = await loadState();
	const ids = Object.keys(s.collection_frames ?? {});
	if (!ids.length) return 0;
	const wanted = new Set<number>();
	for (const id of ids) collectionGames(id).forEach((appid) => wanted.add(appid));
	let changed = 0;
	for (const appid of wanted) {
		if (frameSig(frameFor(s, appid).choice) === (s.framed?.[String(appid)] ?? '')) continue;
		try {
			await reframe(s, appid);
			changed++;
		} catch (err) {
			console.error('[UGI] collection frame failed', appid, err);
		}
	}
	if (changed) await saveState(s);
	return changed;
}

/** A cover put back to Steam's own: nothing kept under a frame any more */
export const forgetOriginal = (appid: number, type: number) => originalDrop({ a_appid: appid, b_type: type }).catch(() => {});

/**
 * The same, from the gallery's reset: the game's frame counts as not drawn any more, so a collection's
 * frame goes back on Steam's cover at the next check
 */
export async function forgetFrame(appid: number, type: number) {
	await forgetOriginal(appid, type);
	const s = await loadState();
	if (s.framed?.[String(appid)] === undefined) return;
	delete s.framed[String(appid)];
	await saveState(s);
}

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
