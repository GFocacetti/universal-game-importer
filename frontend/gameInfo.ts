import { callable } from '@steambrew/client';
import { unquote } from 'backend';
import { uiLocale } from 'i18n';
import { UgiState } from 'types';

// Description, developer, genres... of an imported game, for its library page.
// Sources, first that knows the game: Steam store (same name), GOG (GOG id), Epic (store page
// of the installed game), RAWG (needs the user's key).
const httpGet = callable<[{ a_url: string }], string>('ugi_http_get');
const epicNamespace = callable<[{ a_app_name: string; b_dir: string }], string>('ugi_epic_namespace');
const cacheLoad = callable<[{ a_key: string }], string>('ugi_info_load');
const cacheSave = callable<[{ a_key: string; b_json: string }], boolean>('ugi_info_save');

export type GameInfo = {
	source: 'steam' | 'gog' | 'epic' | 'rawg';
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
	// Store pages for developers, publishers and genres, by name (Steam only)
	links?: Record<string, string>;
};

export type Screenshot = { thumb: string; full: string };

// Bumped when the stored text changes shape: older entries are read again
const CACHE_VERSION = 8;

type CacheEntry = { version?: number; fetched: number; locale: string; rawg: boolean; info: GameInfo | null };

const DAY = 24 * 60 * 60 * 1000;
// Found: refreshed after a month; not found: tried again after a week (or when a RAWG key is added)
const KEEP_FOUND = 30 * DAY;
const KEEP_MISSING = 7 * DAY;

async function getJson(url: string): Promise<any | null> {
	try {
		const value = JSON.parse(await httpGet({ a_url: url }));
		return value && typeof value === 'object' && !('http_status' in value) ? value : null;
	} catch {
		return null;
	}
}

// Same words, ignoring case, punctuation and ™ ® ©
const simplify = (name: string) => name.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

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

const firstParagraph = (text: string) => text.split('\n\n').find((p) => p.length > 40 && !p.startsWith('# ')) ?? '';

const names = (list: any): string[] => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.name ?? x?.description)).filter(Boolean) : []);

// ---------- Sources ----------

// Steam's genre ids and their store pages (the page names are in English)
const STEAM_GENRES: Record<string, string> = {
	1: 'Action', 2: 'Strategy', 3: 'RPG', 4: 'Casual', 9: 'Racing', 18: 'Sports', 23: 'Indie', 25: 'Adventure',
	28: 'Simulation', 29: 'Massively Multiplayer', 37: 'Free to Play', 70: 'Early Access',
};

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

async function fromSteam(name: string, locale: string): Promise<GameInfo | null> {
	const lang = locale === 'it' ? 'italian' : 'english';
	const cc = locale === 'it' ? 'IT' : 'US';
	const search = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=${lang}&cc=${cc}`);
	const match = (search?.items ?? []).find((item: any) => simplify(String(item.name ?? '')) === simplify(name));
	if (!match) return null;
	const details = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${match.id}&l=${lang}`))?.[match.id];
	const d = details?.success ? details.data : null;
	if (!d || d.type !== 'game') return null;
	const description = htmlToText(d.about_the_game || d.detailed_description || '');
	return {
		source: 'steam',
		url: `https://store.steampowered.com/app/${match.id}/`,
		summary: decode(d.short_description || '') || firstParagraph(description),
		description,
		developers: names(d.developers),
		publishers: names(d.publishers),
		genres: names(d.genres),
		released: d.release_date?.date || undefined,
		screenshots: (d.screenshots ?? []).filter((s: any) => s.path_full).map((s: any) => ({ thumb: s.path_thumbnail || s.path_full, full: s.path_full })),
		links: steamLinks(d),
	};
}

async function fromGog(id: string, locale: string): Promise<GameInfo | null> {
	const d = await getJson(`https://api.gog.com/v2/games/${encodeURIComponent(id)}?locale=${locale === 'it' ? 'it-IT' : 'en-US'}`);
	if (!d?._embedded) return null;
	const e = d._embedded;
	const description = htmlToText(d.description || '');
	if (!description) return null;
	return {
		source: 'gog',
		url: d._links?.store?.href || `https://www.gog.com/game/${encodeURIComponent(id)}`,
		summary: firstParagraph(description),
		description,
		developers: names(e.developers),
		publishers: names(e.publishers?.length ? e.publishers : e.publisher ? [e.publisher] : []),
		genres: names(e.tags).slice(0, 5),
		released: e.product?.globalReleaseDate ? new Date(e.product.globalReleaseDate).toLocaleDateString(locale) : undefined,
		screenshots: (e.screenshots ?? [])
			.map((s: any) => String(s?._links?.self?.href ?? ''))
			.filter(Boolean)
			.map((href: string) => ({ thumb: href.replace('{formatter}', 'product_card_v2_mobile_slider_639'), full: href.replace('{formatter}', '1600') })),
	};
}

let epicSlugs: Record<string, string> | null = null;

async function fromEpic(appName: string, dir: string, locale: string): Promise<GameInfo | null> {
	const namespace = unquote(await epicNamespace({ a_app_name: appName, b_dir: dir }));
	if (!namespace) return null;
	// Epic's own map from store namespace to store page
	epicSlugs ??= await getJson('https://store-content.ak.epicgames.com/api/content/productmapping');
	const slug = epicSlugs?.[namespace];
	if (!slug) return null;
	const page = await getJson(`https://store-content-ipv4.ak.epicgames.com/api/${locale === 'it' ? 'it' : 'en-US'}/content/products/${encodeURIComponent(slug)}`);
	// The product's home page (Fortnite lists its game modes first)
	const pages: any[] = page?.pages ?? [];
	const d = (pages.find((p) => p?.type === 'productHome') ?? pages[0])?.data;
	const description = markdownToText(d?.about?.description || '');
	if (!description) return null;
	return {
		source: 'epic',
		url: `https://store.epicgames.com/p/${slug}`,
		summary: markdownToText(d.about.shortDescription || '') || firstParagraph(description),
		description,
		developers: d.about.developerAttribution ? [d.about.developerAttribution] : [],
		publishers: d.about.publisherAttribution ? [d.about.publisherAttribution] : [],
		genres: [],
		screenshots: (d.carousel?.items ?? []).map((item: any) => item?.image?.src).filter(Boolean).map((src: string) => ({ thumb: src, full: src })),
	};
}

async function fromRawg(name: string, key: string): Promise<GameInfo | null> {
	const search = await getJson(`https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(name)}&page_size=10`);
	// Several entries can share the name (fan-made pages too): the one most users added
	const match = (search?.results ?? [])
		.filter((r: any) => simplify(String(r.name ?? '')) === simplify(name))
		.sort((a: any, b: any) => (b.added ?? 0) - (a.added ?? 0))[0];
	if (!match) return null;
	const d = await getJson(`https://api.rawg.io/api/games/${match.id}?key=${encodeURIComponent(key)}`);
	const description = tidy(d?.description_raw || '');
	if (!d || !description) return null;
	return {
		source: 'rawg',
		url: `https://rawg.io/games/${d.slug ?? match.slug}`,
		summary: firstParagraph(description),
		description,
		developers: names(d.developers),
		publishers: names(d.publishers),
		genres: names(d.genres),
		released: d.released || undefined,
		screenshots: (match.short_screenshots ?? []).map((s: any) => s.image).filter(Boolean).slice(1).map((src: string) => ({ thumb: src, full: src })),
	};
}

async function lookup(state: UgiState, key: string, name: string, locale: string): Promise<GameInfo | null> {
	const [launcher, ...rest] = key.split(':');
	const id = rest.join(':');
	return (
		(await fromSteam(name, locale)) ??
		(launcher === 'gog' ? await fromGog(id, locale) : null) ??
		(launcher === 'epic' ? await fromEpic(id, state.settings.launchers?.epic?.path ?? '', locale) : null) ??
		(state.settings.rawg_key ? await fromRawg(name, state.settings.rawg_key) : null)
	);
}

// ---------- Cache ----------

const running = new Map<string, Promise<GameInfo | null>>();

export function importedKeyFor(state: UgiState, appid: number): string | undefined {
	return Object.entries(state.imported).find(([, e]) => e.appid === appid)?.[0];
}

export async function gameInfo(state: UgiState, key: string): Promise<GameInfo | null> {
	const locale = uiLocale();
	const rawg = !!state.settings.rawg_key;
	let cached: CacheEntry | null = null;
	try {
		cached = JSON.parse((await cacheLoad({ a_key: key })) || 'null');
	} catch {}
	if (cached && cached.version !== CACHE_VERSION) cached = null;
	if (cached && cached.locale === locale) {
		const age = Date.now() - cached.fetched;
		if (cached.info ? age < KEEP_FOUND : age < KEEP_MISSING && cached.rawg === rawg) return cached.info;
	}

	const id = `${key}|${locale}`;
	if (!running.has(id)) {
		const name = state.imported[key]?.name ?? '';
		running.set(
			id,
			lookup(state, key, name, locale)
				.catch(() => null)
				.then(async (info) => {
					// Nothing found this time but something before: keep the old one
					const kept = info ?? cached?.info ?? null;
					const entry: CacheEntry = { version: CACHE_VERSION, fetched: Date.now(), locale, rawg, info: kept };
					await cacheSave({ a_key: key, b_json: JSON.stringify(entry) }).catch(() => false);
					return kept;
				})
				.finally(() => running.delete(id)),
		);
	}
	return running.get(id)!;
}
