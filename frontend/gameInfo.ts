import { callable } from '@steambrew/client';
import { unquote } from 'backend';
import { simplifyName } from 'steamApps';
import { uiLocale } from 'i18n';
import { UgiState } from 'types';

// Description, developer, genres... of an imported game, for its library page.
// Sources, first that knows the game: Steam store (same name), GOG (GOG id), Epic (store page
// of the installed game), Microsoft Store (package of the installed Xbox game), RAWG (needs the user's key).
const httpGet = callable<[{ a_url: string }], string>('ugi_http_get');
const epicNamespace = callable<[{ a_app_name: string; b_dir: string }], string>('ugi_epic_namespace');
const cacheLoad = callable<[{ a_key: string }], string>('ugi_info_load');
const cacheSave = callable<[{ a_key: string; b_json: string }], boolean>('ugi_info_save');

export type GameInfo = {
	source: 'steam' | 'gog' | 'epic' | 'microsoft' | 'rawg';
	// Page of the game on the source site
	url: string;
	summary: string;
	// Plain text, paragraphs separated by an empty line; headings start with "# "
	description: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	released?: string;
	screenshots: Screenshot[];
	// Store pages for developers, publishers and genres, by name
	links?: Record<string, string>;
	// Where the game is sold: its launcher's store (when the page is known exactly) and Steam
	stores?: StoreLink[];
	// Trailers: played here when the stream format is supported, otherwise opened on their page
	videos?: Video[];
	// Wide picture at the top of the summary, like the store's header capsule
	header?: string;
	reviews?: Reviews;
	metacritic?: { score: number; url?: string };
	// With the store search for games that have the same feature (as on Steam)
	features?: { name: string; icon?: string; url?: string }[];
	languages?: Language[];
	age?: { label: string; descriptors?: string };
	requirements?: { minimum: Requirement[]; recommended: Requirement[] };
};

type StoreLink = { name: string; url: string };
export type Video = { thumb: string; hls?: string; page?: string; name?: string };
export type Reviews = { percent: number; total: number };
export type Language = { name: string; interface: boolean; audio: boolean };
export type Requirement = { label: string; value: string };

type Screenshot = { thumb: string; full: string };

// Bumped when the stored text changes shape: older entries are read again
const CACHE_VERSION = 15;

type CacheEntry = { version?: number; fetched: number; locale: string; rawg: boolean; info: GameInfo | null };

const DAY = 24 * 60 * 60 * 1000;
// Found: shown at once and read again behind it, at most every 10 minutes; not found: tried again
// after a week (or when a RAWG key is added)
const RECHECK = 10 * 60 * 1000;
const KEEP_MISSING = 7 * DAY;

async function getJson(url: string): Promise<any | null> {
	try {
		const value = JSON.parse(await httpGet({ a_url: url }));
		return value && typeof value === 'object' && !('http_status' in value) ? value : null;
	} catch {
		return null;
	}
}

const decode = (text: string) => new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? '';

// Store pages are HTML: kept as plain text, one paragraph per block
function htmlToText(html: string): string {
	const marked = html
		// Line breaks in the HTML source are just spaces
		.replace(/\s*\n\s*/g, ' ')
		// Headings, and paragraphs that are all bold, become "# " lines
		.replace(/<h\d[^>]*>/gi, '\n\n# ')
		.replace(/<p[^>]*>\s*<(strong|b)>([^<]*)<\/\1>\s*<\/p>/gi, '\n\n# $2\n\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h\d|li|ul|ol)>/gi, '\n\n')
		.replace(/<li[^>]*>/gi, '• ');
	return tidy(decode(marked));
}

// Epic pages are Markdown
function markdownToText(md: string): string {
	return tidy(
		md
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			// Titles underlined with === or --- are headings
			.replace(/^([^\n]*\S[^\n]*)\n\s*[=-]{3,}\s*$/gm, '\n# $1\n')
			// Other rules (---, ___, ***) separate sections: dropped
			.replace(/^\s*([-_=*])\1{2,}\s*$/gm, '')
			.replace(/^#+\s*(.*)$/gm, '\n# $1\n')
			// Escaped punctuation: \! \( \)
			.replace(/\\([\\`*_{}\[\]()#+\-.!|<>])/g, '$1')
			.replace(/^\s*[-*]\s+/gm, '• ')
			.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1'),
	);
}

function tidy(text: string): string {
	return text
		.replace(/ /g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.replace(/^# \s*$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.replace(CONTINUES, '$1 ');
}

// Some texts are wrapped by hand, even one paragraph per line: a line that doesn't end a sentence,
// followed by one starting in lowercase, belongs to the same paragraph
const CONTINUES = /([^.!?:;…"»)\n])\n\n?(?=\p{Ll})/gu;

// The summary beside the media, about as long as Steam's (300 characters at most): the first
// paragraph, cut after the last full sentence that fits
function brief(text: string): string {
	const first = text.split(/\n+/).map((p) => p.trim()).find((p) => p.length > 40 && !p.startsWith('# ')) ?? '';
	if (first.length <= 300) return first;
	const cut = first.slice(0, 300);
	const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
	return end > 100 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const names = (list: any): string[] => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.name ?? x?.description)).filter(Boolean) : []);

// ---------- Sources ----------

// Steam's genre ids and their store pages (the page names are in English)
const STEAM_GENRES: Record<string, string> = {
	1: 'Action', 2: 'Strategy', 3: 'RPG', 4: 'Casual', 9: 'Racing', 18: 'Sports', 23: 'Indie', 25: 'Adventure',
	28: 'Simulation', 29: 'Massively Multiplayer', 37: 'Free to Play', 70: 'Early Access', 51: 'Animation & Modeling',
	52: 'Audio Production', 53: 'Design & Illustration', 54: 'Education', 55: 'Photo Editing', 56: 'Software Training',
	57: 'Utilities', 58: 'Video Production', 59: 'Web Publishing', 60: 'Game Development', 73: 'Violent', 74: 'Gore',
	81: 'Documentary', 84: 'Tutorial',
};

// Tags from GOG, Epic and RAWG are English names, like the Steam store's tag pages
// (a tag Steam doesn't know leads to the store's home page)
function steamTagLinks(tags: string[]): Record<string, string> {
	return Object.fromEntries(tags.map((tag) => [tag, `https://store.steampowered.com/tags/en/${encodeURIComponent(tag)}/`]));
}

// Steam's feature ids and the store's own icons for them
const STEAM_FEATURE_ICONS: Record<string, string> = {
	2: 'singlePlayer', 1: 'multiPlayer', 20: 'multiPlayer', 27: 'multiPlayer', 36: 'multiPlayer', 37: 'multiPlayer', 47: 'multiPlayer', 49: 'multiPlayer',
	9: 'coop', 24: 'coop', 38: 'coop', 39: 'coop', 48: 'coop', 22: 'achievements', 23: 'cloud', 28: 'controller', 18: 'partial_controller',
	29: 'cards', 30: 'workshop', 35: 'cart', 13: 'cc', 8: 'vac', 17: 'editor', 15: 'stats', 14: 'commentary',
	41: 'remote_play', 42: 'remote_play', 43: 'remote_play', 44: 'remote_play_together', 61: 'hdr',
};
const STEAM_ICONS = 'https://store.akamai.steamstatic.com/public/images/v6/ico/ico_';

// Steam's feature: its icon and the store search for games that have it
function steamFeature(id: string | number, name: string) {
	const icon = STEAM_FEATURE_ICONS[String(id)];
	return { name, icon: icon ? `${STEAM_ICONS}${icon}.png` : undefined, url: `https://store.steampowered.com/search/?category2=${id}` };
}

// GOG's feature names and the matching Steam features (same icons and store search)
const GOG_FEATURES: Record<string, number> = {
	'single-player': 2, 'multi-player': 1, 'co-op': 9, achievements: 22, 'cloud saves': 23, 'controller support': 28, leaderboards: 15,
};

// Dates written like the Steam store's ("27 Aug 2020")
function storeDate(value: string | undefined, locale: string): string | undefined {
	const date = value ? new Date(value) : null;
	return date && !isNaN(date.getTime()) ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined;
}

function steamLinks(d: any): Record<string, string> {
	const links: Record<string, string> = {};
	const search = 'https://store.steampowered.com/search/?';
	for (const dev of names(d.developers)) links[dev] = `${search}developer=${encodeURIComponent(dev)}`;
	for (const pub of names(d.publishers)) links[pub] ??= `${search}publisher=${encodeURIComponent(pub)}`;
	for (const genre of d.genres ?? []) {
		const page = STEAM_GENRES[String(genre?.id)];
		if (page && genre.description) links[genre.description] = `https://store.steampowered.com/genre/${encodeURIComponent(page)}/`;
	}
	return links;
}

// Steam's requirement lists: "<li><strong>Memory:</strong> 8 GB RAM</li>"
function steamRequirements(html: string | undefined): Requirement[] {
	if (!html) return [];
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return Array.from(doc.querySelectorAll('li'))
		.map((li) => {
			const label = (li.querySelector('strong')?.textContent ?? '').replace(/[\s*]*:\s*$/, '').trim();
			const all = (li.textContent ?? '').trim();
			const value = label ? all.slice(all.indexOf(':') + 1).trim() : all;
			return { label, value };
		})
		.filter((r) => r.value);
}

// "English<strong>*</strong>, Italian<br><strong>*</strong>languages with full audio support"
function steamLanguages(html: string | undefined): Language[] {
	if (!html) return [];
	return html
		.split(/<br\s*\/?>/i)[0]!
		.split(',')
		.map((part) => ({ name: decode(part.replace(/<[^>]*>/g, '').replace(/\*/g, '')).trim(), interface: true, audio: part.includes('*') }))
		.filter((l) => l.name);
}

// Steam's verdict comes from the review histogram (Steam's reviews API redirects to the store)
async function steamReviews(appid: number): Promise<Reviews | undefined> {
	const results = (await getJson(`https://store.steampowered.com/appreviewhistogram/${appid}?review_score_preference=0`))?.results;
	let up = 0;
	let down = 0;
	for (const r of results?.rollups ?? []) {
		up += Number(r.recommendations_up) || 0;
		down += Number(r.recommendations_down) || 0;
	}
	return up + down ? { percent: Math.round((100 * up) / (up + down)), total: up + down } : undefined;
}

async function fromSteam(name: string, locale: string): Promise<GameInfo | null> {
	const lang = locale === 'it' ? 'italian' : 'english';
	const cc = locale === 'it' ? 'IT' : 'US';
	const search = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=${lang}&cc=${cc}`);
	const match = (search?.items ?? []).find((item: any) => simplifyName(String(item.name ?? '')) === simplifyName(name));
	if (!match) return null;
	const reviews = steamReviews(match.id).catch(() => undefined);
	// The details are the one Steam request the client may make itself: alongside the backend's
	const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${match.id}&l=${lang}`;
	const direct = await fetch(detailsUrl)
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null);
	const details = (direct ?? (await getJson(detailsUrl)))?.[match.id];
	const d = details?.success ? details.data : null;
	if (!d || d.type !== 'game') return null;
	const description = htmlToText(d.about_the_game || d.detailed_description || '');
	const pegi = d.ratings?.pegi;
	const age = Number(d.required_age) || 0;
	const url = `https://store.steampowered.com/app/${match.id}/`;
	return {
		source: 'steam',
		url,
		summary: brief(decode(d.short_description || '') || description),
		description,
		developers: names(d.developers),
		publishers: names(d.publishers),
		genres: names(d.genres),
		released: d.release_date?.date || undefined,
		screenshots: (d.screenshots ?? []).filter((s: any) => s.path_full).map((s: any) => ({ thumb: s.path_thumbnail || s.path_full, full: s.path_full })),
		videos: (d.movies ?? []).filter((m: any) => m.thumbnail).map((m: any) => ({ thumb: m.thumbnail, hls: m.hls_h264, page: url, name: m.name })),
		links: steamLinks(d),
		header: d.header_image || undefined,
		reviews: await reviews,
		metacritic: d.metacritic?.score ? { score: d.metacritic.score, url: d.metacritic.url } : undefined,
		features: (d.categories ?? []).filter((c: any) => c?.description).map((c: any) => steamFeature(c.id, c.description)),
		languages: steamLanguages(d.supported_languages),
		age: pegi?.rating
			? { label: `PEGI ${pegi.rating}`, descriptors: String(pegi.descriptors ?? '').split(/\r?\n/).filter(Boolean).join(', ') || undefined }
			: age
				? { label: `${age}+` }
				: undefined,
		requirements: { minimum: steamRequirements(d.pc_requirements?.minimum), recommended: steamRequirements(d.pc_requirements?.recommended) },
	};
}

async function fromGog(id: string, locale: string): Promise<GameInfo | null> {
	const d = await getJson(`https://api.gog.com/v2/games/${encodeURIComponent(id)}?locale=${locale === 'it' ? 'it-IT' : 'en-US'}`);
	if (!d?._embedded) return null;
	const e = d._embedded;
	const description = htmlToText(d.description || '');
	if (!description) return null;
	// One entry per language and scope (text / audio)
	const languages = new Map<string, Language>();
	for (const l of e.localizations ?? []) {
		const name = l?._embedded?.language?.name;
		if (!name) continue;
		const entry = languages.get(name) ?? { name, interface: false, audio: false };
		if (l._embedded.localizationScope?.type === 'audio') entry.audio = true;
		else entry.interface = true;
		languages.set(name, entry);
	}
	const windows = (e.supportedOperatingSystems ?? []).find((os: any) => os?.operatingSystem?.name === 'windows');
	const gogRequirements = (type: string): Requirement[] =>
		(windows?.systemRequirements ?? [])
			.find((r: any) => r?.type === type)
			?.requirements?.map((r: any) => ({ label: String(r.name ?? '').replace(/:\s*$/, ''), value: String(r.description ?? '') }))
			.filter((r: Requirement) => r.value) ?? [];
	return {
		source: 'gog',
		url: d._links?.store?.href || `https://www.gog.com/game/${encodeURIComponent(id)}`,
		summary: brief(description),
		description,
		developers: names(e.developers),
		publishers: names(e.publishers?.length ? e.publishers : e.publisher ? [e.publisher] : []),
		genres: names(e.tags).slice(0, 5),
		links: steamTagLinks(names(e.tags).slice(0, 5)),
		released: storeDate(e.product?.globalReleaseDate, locale),
		screenshots: (e.screenshots ?? [])
			.map((s: any) => String(s?._links?.self?.href ?? ''))
			.filter(Boolean)
			.map((href: string) => ({ thumb: href.replace('{formatter}', 'product_card_v2_mobile_slider_639'), full: href.replace('{formatter}', '1600') })),
		videos: (e.videos ?? [])
			.filter((v: any) => v?.provider === 'youtube' && v.videoId)
			.map((v: any) => ({ thumb: v._links?.thumbnail?.href ?? `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`, page: `https://www.youtube.com/watch?v=${v.videoId}` })),
		features: names(e.features).map((name) => {
			const steam = GOG_FEATURES[name.toLowerCase()];
			return steam ? steamFeature(steam, name) : { name };
		}),
		languages: [...languages.values()],
		age: e.pegiRating?.ageRating
			? { label: `PEGI ${e.pegiRating.ageRating}`, descriptors: (e.pegiRating.contentDescriptors ?? []).map((c: any) => c.descriptor).join(', ') || undefined }
			: undefined,
		requirements: { minimum: gogRequirements('minimum'), recommended: gogRequirements('recommended') },
	};
}

// Microsoft Store catalog entry of an installed Xbox game; the id is "<package family>!<app>"
// (read once per game and language: information, store link and achievements all use it)
const microsoftProducts = new Map<string, Promise<any | null>>();

function microsoftProduct(id: string, locale: string): Promise<any | null> {
	const family = id.split('!')[0] ?? '';
	const market = locale === 'it' ? 'market=IT&languages=it-IT,en-US' : 'market=US&languages=en-US';
	const key = `${family}|${market}`;
	if (!microsoftProducts.has(key)) {
		microsoftProducts.set(
			key,
			fetch(`https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?${market}&alternateId=PackageFamilyName&fieldsTemplate=details&value=${encodeURIComponent(family)}`)
				.then(async (res) => (res.ok ? ((await res.json())?.Products?.[0] ?? null) : null))
				.catch(() => null),
		);
	}
	return microsoftProducts.get(key)!;
}

// Xbox title id of an installed Xbox game (the key of its achievements)
export async function xboxTitleId(id: string): Promise<string> {
	const ids: any[] = (await microsoftProduct(id, uiLocale()))?.AlternateIds ?? [];
	return String(ids.find((a) => a?.IdType === 'XboxTitleId')?.Value ?? '');
}

// Epic namespace of an installed Epic game (the sandbox of its achievements)
export async function epicSandbox(appName: string, dir: string): Promise<string> {
	return unquote(await epicNamespace({ a_app_name: appName, b_dir: dir }));
}

async function fromMicrosoft(id: string, locale: string): Promise<GameInfo | null> {
	const p = await microsoftProduct(id, locale);
	const l = p?.LocalizedProperties?.[0];
	const description = tidy(String(l?.ProductDescription ?? '').replace(/\r/g, ''));
	if (!description) return null;
	// Image addresses come without the scheme; the "w" parameter asks for a smaller copy
	const image = (i: any, width?: number) => `https:${i.Uri}${width ? `?w=${width}` : ''}`;
	const images: any[] = l.Images ?? [];
	const hero = images.find((i) => i.ImagePurpose === 'TitledHeroArt') ?? images.find((i) => i.ImagePurpose === 'SuperHeroArt');
	const pegi = (p.MarketProperties?.[0]?.ContentRatings ?? []).find((r: any) => r?.RatingSystem === 'PEGI');
	return {
		source: 'microsoft',
		url: `https://apps.microsoft.com/detail/${p.ProductId}`,
		summary: brief(tidy(String(l.ShortDescription ?? '').replace(/\r/g, '')) || description),
		description,
		developers: l.DeveloperName ? [l.DeveloperName] : [],
		publishers: l.PublisherName ? [l.PublisherName] : [],
		genres: (p.Properties?.Categories ?? (p.Properties?.Category ? [p.Properties.Category] : [])).filter(Boolean),
		released: storeDate(p.MarketProperties?.[0]?.OriginalReleaseDate, locale),
		header: hero ? image(hero, 920) : undefined,
		screenshots: images.filter((i) => i.ImagePurpose === 'Screenshot').map((i) => ({ thumb: image(i, 640), full: image(i, 1920) })),
		age: pegi?.RatingId ? { label: String(pegi.RatingId).replace(':', ' ') } : undefined,
	};
}

let epicSlugs: Record<string, string> | null = null;

// Store page name of an installed Epic game, from its manifest and Epic's own namespace map
async function epicSlug(appName: string, dir: string): Promise<string | null> {
	const namespace = unquote(await epicNamespace({ a_app_name: appName, b_dir: dir }));
	if (!namespace) return null;
	epicSlugs ??= await getJson('https://store-content.ak.epicgames.com/api/content/productmapping');
	return epicSlugs?.[namespace] ?? null;
}

async function fromEpic(appName: string, dir: string, locale: string): Promise<GameInfo | null> {
	const slug = await epicSlug(appName, dir);
	if (!slug) return null;
	const page = await getJson(`https://store-content-ipv4.ak.epicgames.com/api/${locale === 'it' ? 'it' : 'en-US'}/content/products/${encodeURIComponent(slug)}`);
	// The product's home page (some products list other pages first)
	const pages: any[] = page?.pages ?? [];
	const d = (pages.find((p) => p?.type === 'productHome') ?? pages[0])?.data;
	const description = markdownToText(d?.about?.description || '');
	if (!description) return null;
	const windows = (d.requirements?.systems ?? []).find((s: any) => s?.systemType === 'Windows');
	const epicRequirements = (field: 'minimum' | 'recommended'): Requirement[] =>
		(windows?.details ?? []).map((r: any) => ({ label: String(r.title ?? ''), value: String(r[field] ?? '') })).filter((r: Requirement) => r.value);
	return {
		source: 'epic',
		url: `https://store.epicgames.com/p/${slug}`,
		summary: brief(markdownToText(d.about.shortDescription || '') || description),
		description,
		developers: d.about.developerAttribution ? [d.about.developerAttribution] : [],
		publishers: d.about.publisherAttribution ? [d.about.publisherAttribution] : [],
		genres: [],
		screenshots: (d.carousel?.items ?? []).map((item: any) => item?.image?.src).filter(Boolean).map((src: string) => ({ thumb: src, full: src })),
		requirements: { minimum: epicRequirements('minimum'), recommended: epicRequirements('recommended') },
	};
}

// RAWG's requirements are plain text: "Minimum:\nOS: Windows 7\nMemory: 4 GB RAM"
function rawgRequirements(text: string | undefined): Requirement[] {
	return String(text ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !/^(minimum|recommended):?$/i.test(line))
		.map((line) => {
			const at = line.indexOf(':');
			return at > 0 && at < 30 ? { label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() } : { label: '', value: line };
		})
		.filter((r) => r.value);
}

async function fromRawg(name: string, key: string, locale: string): Promise<GameInfo | null> {
	const search = await getJson(`https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(name)}&page_size=10`);
	// Several entries can share the name (fan-made pages too): the one most users added
	const match = (search?.results ?? [])
		.filter((r: any) => simplifyName(String(r.name ?? '')) === simplifyName(name))
		.sort((a: any, b: any) => (b.added ?? 0) - (a.added ?? 0))[0];
	if (!match) return null;
	const d = await getJson(`https://api.rawg.io/api/games/${match.id}?key=${encodeURIComponent(key)}`);
	const description = tidy(d?.description_raw || '');
	if (!d || !description) return null;
	const pc = (d.platforms ?? []).find((p: any) => p?.platform?.slug === 'pc')?.requirements;
	return {
		source: 'rawg',
		url: `https://rawg.io/games/${d.slug ?? match.slug}`,
		summary: brief(description),
		description,
		developers: names(d.developers),
		publishers: names(d.publishers),
		genres: names(d.genres),
		links: steamTagLinks(names(d.genres)),
		released: storeDate(d.released, locale),
		screenshots: (match.short_screenshots ?? []).map((s: any) => s.image).filter(Boolean).slice(1).map((src: string) => ({ thumb: src, full: src })),
		header: d.background_image || undefined,
		metacritic: d.metacritic ? { score: d.metacritic, url: d.metacritic_url || undefined } : undefined,
		age: d.esrb_rating?.name ? { label: `ESRB ${d.esrb_rating.name}` } : undefined,
		requirements: { minimum: rawgRequirements(pc?.minimum), recommended: rawgRequirements(pc?.recommended) },
	};
}

// ---------- Store pages ----------

// Battle.net products by launcher code (the shop sends each user to their own region)
const BATTLENET_PRODUCTS: Record<string, string> = {
	s1: 'starcraft-remastered', s2: 'starcraft-ii', w3: 'warcraft-iii-reforged', d3: 'diablo-iii', fenris: 'diablo-iv',
	osi: 'diablo-ii-resurrected', anbs: 'diablo-immortal', pro: 'overwatch', hsb: 'hearthstone', hero: 'heroes-of-the-storm',
	wow: 'world-of-warcraft', rtro: 'blizzard-arcade-collection', wlby: 'crash-bandicoot-4-its-about-time',
	viper: 'call-of-duty-black-ops-4', odin: 'call-of-duty-modern-warfare', zeus: 'call-of-duty-black-ops-cold-war',
	lazr: 'call-of-duty-modern-warfare-2-campaign-remastered', fore: 'call-of-duty-vanguard', dst2: 'destiny-2',
};

// Only launchers whose store page is known exactly: Epic, GOG, Microsoft Store, Battle.net
async function launcherStore(state: UgiState, launcher: string, id: string): Promise<StoreLink | null> {
	switch (launcher) {
		case 'epic': {
			const slug = await epicSlug(id, state.settings.launchers?.epic?.path ?? '');
			return slug ? { name: 'Epic Games Store', url: `https://store.epicgames.com/p/${slug}` } : null;
		}
		case 'gog': {
			const url = (await getJson(`https://api.gog.com/products/${encodeURIComponent(id)}`))?.links?.product_card;
			return url ? { name: 'GOG', url } : null;
		}
		case 'xbox': {
			const product = (await microsoftProduct(id, uiLocale()))?.ProductId;
			return product ? { name: 'Microsoft Store', url: `https://apps.microsoft.com/detail/${product}` } : null;
		}
		case 'battlenet': {
			const product = BATTLENET_PRODUCTS[id];
			return product ? { name: 'Battle.net', url: `https://shop.battle.net/product/${product}` } : null;
		}
	}
	return null;
}

async function lookup(state: UgiState, key: string, name: string, locale: string): Promise<GameInfo | null> {
	const [launcher, ...rest] = key.split(':');
	const id = rest.join(':');
	const store = launcherStore(state, launcher ?? '', id).catch(() => null);
	const info =
		(await fromSteam(name, locale)) ??
		(launcher === 'gog' ? await fromGog(id, locale) : null) ??
		(launcher === 'epic' ? await fromEpic(id, state.settings.launchers?.epic?.path ?? '', locale) : null) ??
		(launcher === 'xbox' ? await fromMicrosoft(id, locale) : null) ??
		(state.settings.rawg_key ? await fromRawg(name, state.settings.rawg_key, locale) : null);
	if (!info) return null;
	const own = await store;
	info.stores = [...(own ? [own] : []), ...(info.source === 'steam' ? [{ name: 'Steam', url: info.url }] : [])];
	return info;
}

// ---------- Cache ----------

const running = new Map<string, Promise<GameInfo | null>>();
// The saved information, also kept here once read: a page doesn't wait for the backend while it is busy
const memory = new Map<string, CacheEntry | null>();

async function readCache(key: string): Promise<CacheEntry | null> {
	if (memory.has(key)) return memory.get(key)!;
	let cached: CacheEntry | null = null;
	try {
		cached = JSON.parse((await cacheLoad({ a_key: key })) || 'null');
	} catch {}
	if (cached && cached.version !== CACHE_VERSION) cached = null;
	memory.set(key, cached);
	return cached;
}

function refresh(state: UgiState, key: string, name: string, locale: string, cached: CacheEntry | null): Promise<GameInfo | null> {
	const id = `${key}|${locale}`;
	if (!running.has(id)) {
		const rawg = !!state.settings.rawg_key;
		running.set(
			id,
			lookup(state, key, name, locale)
				.catch(() => null)
				.then(async (info) => {
					// Nothing found this time but something before: keep the old one
					const kept = info ?? cached?.info ?? null;
					const entry: CacheEntry = { version: CACHE_VERSION, fetched: Date.now(), locale, rawg, info: kept };
					memory.set(key, entry);
					await cacheSave({ a_key: key, b_json: JSON.stringify(entry) }).catch(() => false);
					return kept;
				})
				.finally(() => running.delete(id)),
		);
	}
	return running.get(id)!;
}

// key: the imported game's id, or "manual:<appid>" for a shortcut added by hand (looked up by name).
// What is saved comes back at once; it is then read again, and changed gets the new one.
export async function gameInfo(state: UgiState, key: string, name: string, changed?: (info: GameInfo | null) => void): Promise<GameInfo | null> {
	const locale = uiLocale();
	const cached = await readCache(key);
	if (cached && cached.locale === locale) {
		const age = Date.now() - cached.fetched;
		if (!cached.info) {
			if (age < KEEP_MISSING && cached.rawg === !!state.settings.rawg_key) return null;
		} else {
			if (age >= RECHECK) {
				const before = JSON.stringify(cached.info);
				refresh(state, key, name, locale, cached).then((info) => {
					if (info && JSON.stringify(info) !== before) changed?.(info);
				});
			}
			return cached.info;
		}
	}
	return refresh(state, key, name, locale, cached);
}

// What the page shows first, loaded into the client's cache: the header, the first picture (or
// trailer frame) and the strip below it
function preloadPictures(info: GameInfo): Promise<unknown> {
	const urls = [info.header, info.videos?.[0]?.thumb ?? info.screenshots[0]?.full, ...(info.videos ?? []).map((v) => v.thumb), ...info.screenshots.map((p) => p.thumb)];
	return Promise.all(
		[...new Set(urls.filter((u): u is string => !!u))].map(
			(url) =>
				new Promise<void>((done) => {
					const img = new Image();
					img.onload = img.onerror = () => done();
					img.src = url;
				}),
		),
	);
}

// Imported games get their information and pictures while waiting in the library, one at a time
// (the information only where nothing is saved yet): their page opens with all of it already there
let queue: Promise<void> = Promise.resolve();

export function prefetchInfo(state: UgiState, keys: string[]): Promise<void> {
	const locale = uiLocale();
	return (queue = queue.then(async () => {
		for (const key of keys) {
			const name = state.imported[key]?.name;
			if (!name) continue;
			const cached = await readCache(key);
			const info = cached && cached.locale === locale ? cached.info : await refresh(state, key, name, locale, cached).catch(() => null);
			if (info) await preloadPictures(info);
		}
	}));
}
