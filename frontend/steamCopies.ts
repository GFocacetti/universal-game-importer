// Imported games the user also has in Steam's library (bought there or shared by the family): both
// copies stay, each in its own collection, and the imported one is told apart by its launcher in its
// name in Steam ("Rocket League · Epic Games"). UGI keeps the plain name for everything else.
import { launcherName, simplifyName } from 'steamApps';
import { ImportedEntry, UgiState } from 'types';

type Overview = { appid: number; display_name?: string; app_type?: number };
declare const appStore: { allApps?: Overview[]; GetAppOverviewByAppID(appid: number): Overview | undefined };

// Steam's games and demos (not tools, applications or shortcuts)
const STEAM_GAME_TYPES = [1, 8];

// The library's Steam games by simplified name; read again at most every few seconds
let byName: Map<string, number> | null = null;
let readAt = 0;
function steamGames(): Map<string, number> {
	if (byName && Date.now() - readAt < 5000) return byName;
	byName = new Map();
	for (const app of appStore.allApps ?? []) {
		if (app.display_name && STEAM_GAME_TYPES.includes(app.app_type ?? 0)) byName.set(simplifyName(app.display_name), app.appid);
	}
	readAt = Date.now();
	return byName;
}

// The Steam copy of an imported game: the Steam game chosen as its information source in the Game
// profile tab, else the Steam game with the same name. Games added by hand are left out.
export function steamCopy(entry: Pick<ImportedEntry, 'name' | 'launcher' | 'profile'>): number | undefined {
	if (entry.launcher === 'manual') return undefined;
	const picked = entry.profile?.info?.source === 'steam' ? entry.profile.info.id : undefined;
	const type = picked ? appStore.GetAppOverviewByAppID(picked)?.app_type : undefined;
	if (picked && STEAM_GAME_TYPES.includes(type ?? 0)) return picked;
	return steamGames().get(simplifyName(entry.name));
}

// The name the game's shortcut has in Steam
export function shortcutName(entry: Pick<ImportedEntry, 'name' | 'launcher' | 'profile'>): string {
	return steamCopy(entry) ? `${entry.name} · ${launcherName(entry.launcher)}` : entry.name;
}

// Every imported game's shortcut named again where that changed (a Steam copy bought, shared,
// removed); at startup and after each scan
export function nameSteamCopies(state: UgiState) {
	for (const entry of Object.values(state.imported)) {
		if (entry.launcher === 'manual') continue;
		const wanted = shortcutName(entry);
		const now = appStore.GetAppOverviewByAppID(entry.appid)?.display_name;
		if (now !== undefined && now !== wanted) SteamClient.Apps.SetShortcutName(entry.appid, wanted);
	}
}
