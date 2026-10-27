// Helpers around Steam's app store for the UI (shortcuts, image URLs, launching, links)

type Overview = { appid: number; display_name?: string; app_type?: number };
declare const appStore: {
	GetAppOverviewByAppID(appid: number): Overview | undefined;
	GetCustomVerticalCapsuleURLs(o: Overview): string[];
	GetCachedVerticalCapsuleURL(o: Overview): string[];
	GetCustomLandcapeImageURLs(o: Overview): string[];
	GetCustomHeroImageURLs(o: Overview): string[];
	GetCustomLogoImageURLs(o: Overview): string[];
	GetIconURLForApp(o: Overview): string | null;
};

const SHORTCUT_APP_TYPE = 1073741824;

// A non-Steam shortcut (every imported game is one)
export const isShortcut = (appid: number) => appStore.GetAppOverviewByAppID(appid)?.app_type === SHORTCUT_APP_TYPE;

// A Steam app that is in the library
export function isSteamApp(appid: number): boolean {
	const overview = appStore.GetAppOverviewByAppID(appid);
	return !!overview && overview.app_type !== SHORTCUT_APP_TYPE;
}

// Same words, ignoring case, punctuation and ™ ® © ("DungeonKeeper" is not "Dungeon Keeper")
export const simplifyName = (name: string) => name.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Steam store pages open in Steam's own store; other sites in the web browser
export function openUrl(url: string) {
	if (url.startsWith('https://store.steampowered.com/')) (SteamClient as any).URL.ExecuteSteamURL(`steam://openurl/${url}`);
	else (SteamClient as any).System?.OpenInSystemBrowser?.(url);
}

export const LAUNCHER_NAMES: Record<string, string> = {
	xbox: 'Xbox',
	epic: 'Epic Games',
	gog: 'GOG',
	ea: 'EA',
	battlenet: 'Battle.net',
	amazon: 'Amazon Games',
	ubisoft: 'Ubisoft Connect',
};

export type ImageKind = 'grid' | 'wide' | 'hero' | 'logo' | 'icon';

// Candidate URLs for an image, best first (custom image, then Steam's cached official one)
export function imageUrls(appid: number, kind: ImageKind): string[] {
	const o = appStore.GetAppOverviewByAppID(appid);
	if (!o) return [];
	const safe = (fn: () => string[] | string | null | undefined) => {
		try {
			const v = fn();
			return Array.isArray(v) ? v : v ? [v] : [];
		} catch {
			return [];
		}
	};
	switch (kind) {
		case 'grid':
			return [...safe(() => appStore.GetCustomVerticalCapsuleURLs(o)), ...safe(() => appStore.GetCachedVerticalCapsuleURL(o))];
		case 'wide':
			return safe(() => appStore.GetCustomLandcapeImageURLs(o));
		case 'hero':
			return safe(() => appStore.GetCustomHeroImageURLs(o));
		case 'logo':
			return safe(() => appStore.GetCustomLogoImageURLs(o));
		case 'icon':
			return safe(() => appStore.GetIconURLForApp(o));
	}
}

// Starts a non-Steam shortcut (its game id is the appid shifted left by 32 bits, plus the shortcut flag)
export function launchShortcut(appid: number) {
	const gameId = (BigInt(appid) << 32n) | 0x02000000n;
	// typed as the DOM URL in the type definitions, but it is Steam's URL interface
	(SteamClient as any).URL.ExecuteSteamURL(`steam://rungameid/${gameId}`);
}
