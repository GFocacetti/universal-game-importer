import { Game, ImportedEntry, LauncherStatus, UgiState } from 'types';
import { loadState, saveState } from 'backend';

// Steam client store of all library apps (global in Steam's UI context)
declare const appStore: { GetAppOverviewByAppID(appid: number): unknown };

const quote = (path: string) => (path.startsWith('"') ? path : `"${path}"`);

// A shortcut still exists in Steam (the user may have deleted it by hand)
function shortcutExists(appid: number): boolean {
	return !!appStore.GetAppOverviewByAppID(appid);
}

function applyShortcutSettings(appid: number, game: Game) {
	SteamClient.Apps.SetShortcutName(appid, game.name);
	SteamClient.Apps.SetShortcutExe(appid, quote(game.exe));
	SteamClient.Apps.SetShortcutStartDir(appid, quote(game.start_dir));
	SteamClient.Apps.SetShortcutLaunchOptions(appid, game.launch_options);
	if (game.icon) SteamClient.Apps.SetShortcutIcon(appid, game.icon);
}

// Adds the game to Steam live, without restarting; returns the new appid
async function addShortcut(game: Game): Promise<number> {
	const appid = await SteamClient.Apps.AddShortcut(game.name, game.exe, game.start_dir, game.launch_options);
	applyShortcutSettings(appid, game);
	return appid;
}

const entryFor = (game: Game, appid: number): ImportedEntry => ({
	appid, name: game.name, launcher: game.launcher, exe: game.exe, start_dir: game.start_dir, launch_options: game.launch_options,
});

const changed = (entry: ImportedEntry, game: Game) =>
	entry.name !== game.name || entry.exe !== game.exe || entry.start_dir !== game.start_dir || entry.launch_options !== game.launch_options;

export type SyncPlan = {
	newGames: Game[];
	previouslyExcluded: Game[];
	gone: string[];
	// Already imported, but the launch settings changed (e.g. after a UGI update)
	outdated: Game[];
};

// Compares what the launchers report with what UGI already manages.
// Only launchers scanned successfully (or disabled) can mark games as gone: a failed scan removes nothing.
export function planSync(games: Game[], launchers: LauncherStatus[], state: UgiState): SyncPlan {
	const found = new Set(games.map((g) => g.id));
	const reliable = new Set(launchers.filter((l) => !l.error).map((l) => l.id));
	const managed = (g: Game) => {
		const entry = state.imported[g.id];
		return !!entry && shortcutExists(entry.appid);
	};
	return {
		newGames: games.filter((g) => !managed(g) && !state.excluded[g.id]),
		previouslyExcluded: games.filter((g) => !managed(g) && state.excluded[g.id]),
		outdated: games.filter((g) => {
			const entry = state.imported[g.id];
			return !!entry && managed(g) && changed(entry, g);
		}),
		gone: Object.entries(state.imported).filter(([id, e]) => !found.has(id) && reliable.has(e.launcher)).map(([id]) => id),
	};
}

// Imports the chosen games, remembers the unticked ones as excluded, removes uninstalled ones
export async function applySync(plan: SyncPlan, chosen: Set<string>): Promise<{ added: number; removed: number; updated: number }> {
	const state = await loadState();
	let added = 0;
	let removed = 0;

	for (const game of [...plan.newGames, ...plan.previouslyExcluded]) {
		if (chosen.has(game.id)) {
			try {
				const appid = await addShortcut(game);
				state.imported[game.id] = entryFor(game, appid);
				delete state.excluded[game.id];
				added++;
			} catch (err) {
				console.error('[UGI] failed to add', game.name, err);
			}
		} else {
			state.excluded[game.id] = true;
		}
	}

	let updated = 0;
	for (const game of plan.outdated) {
		const entry = state.imported[game.id];
		if (!entry) continue;
		applyShortcutSettings(entry.appid, game);
		state.imported[game.id] = entryFor(game, entry.appid);
		updated++;
	}

	for (const id of plan.gone) {
		const entry = state.imported[id];
		if (entry && shortcutExists(entry.appid)) SteamClient.Apps.RemoveShortcut(entry.appid);
		delete state.imported[id];
		removed++;
	}

	await saveState(state);
	return { added, removed, updated };
}

// Removes every shortcut UGI created (used by the test panel)
export async function removeAll(): Promise<number> {
	const state = await loadState();
	let removed = 0;
	for (const entry of Object.values(state.imported)) {
		if (shortcutExists(entry.appid)) {
			SteamClient.Apps.RemoveShortcut(entry.appid);
			removed++;
		}
	}
	state.imported = {};
	await saveState(state);
	return removed;
}
