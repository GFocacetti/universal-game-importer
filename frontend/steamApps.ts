// Helpers around Steam's app store for the UI (image URLs, launching)

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

export const LAUNCHER_NAMES: Record<string, string> = {
	xbox: 'Xbox',
	epic: 'Epic Games',
	gog: 'GOG',
	ea: 'EA',
	battlenet: 'Battle.net',
	amazon: 'Amazon Games',
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
