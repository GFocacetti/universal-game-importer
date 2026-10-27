import { callable } from '@steambrew/client';
import { Game, ImportedEntry, LauncherStatus, ShortcutFields, UgiState } from 'types';
import { loadState, saveState, unquote } from 'backend';
import { syncCollections } from 'collections';
import { fillMissing } from 'sgdb';
import { finishImages, startImages } from 'imagesProgress';

// Steam client store of all library apps (global in Steam's UI context)
declare const appStore: { GetAppOverviewByAppID(appid: number): unknown };

const listShortcuts = callable<[], string>('ugi_shortcuts');

const quote = (path: string) => (path.startsWith('"') ? path : `"${path}"`);
export const unquotePath = (path: string | undefined) => String(path ?? '').replace(/^"|"$/g, '');

export type SteamShortcut = ShortcutFields & { appid: number };

// The non-Steam shortcuts in Steam now, as saved in its shortcuts file
export async function steamShortcuts(): Promise<SteamShortcut[]> {
	try {
		const list = JSON.parse(unquote(await listShortcuts()));
		return (Array.isArray(list) ? list : []).filter((s: SteamShortcut) => shortcutExists(s.appid));
	} catch {
		return [];
	}
}

// A shortcut still exists in Steam (the user may have deleted it by hand)
export function shortcutExists(appid: number): boolean {
	return !!appStore.GetAppOverviewByAppID(appid);
}

function applyShortcutSettings(appid: number, game: Game) {
	SteamClient.Apps.SetShortcutName(appid, game.name);
	SteamClient.Apps.SetShortcutExe(appid, quote(game.exe));
	SteamClient.Apps.SetShortcutStartDir(appid, quote(game.start_dir));
	SteamClient.Apps.SetShortcutLaunchOptions(appid, game.launch_options);
	if (game.icon) SteamClient.Apps.SetShortcutIcon(appid, game.icon);
}

// Puts back a shortcut the user had made, as it was before UGI took it over
export function restoreManual(appid: number, manual: ShortcutFields) {
	SteamClient.Apps.SetShortcutName(appid, manual.name);
	SteamClient.Apps.SetShortcutExe(appid, manual.exe);
	SteamClient.Apps.SetShortcutStartDir(appid, manual.start_dir);
	SteamClient.Apps.SetShortcutLaunchOptions(appid, manual.launch_options);
}

// Adds the game to Steam live, without restarting; returns the new appid
async function addShortcut(game: Game): Promise<number> {
	const appid = await SteamClient.Apps.AddShortcut(game.name, game.exe, game.start_dir, game.launch_options);
	applyShortcutSettings(appid, game);
	return appid;
}

const entryFor = (game: Game, appid: number, manual?: ShortcutFields): ImportedEntry => ({
	appid, name: game.name, launcher: game.launcher, exe: game.exe, start_dir: game.start_dir, launch_options: game.launch_options,
	...(manual ? { manual } : {}),
});

const changed = (entry: ImportedEntry, game: Game) =>
	entry.name !== game.name || entry.exe !== game.exe || entry.start_dir !== game.start_dir || entry.launch_options !== game.launch_options;

export type SyncPlan = {
	newGames: Game[];
	previouslyExcluded: Game[];
	gone: string[];
	// Already imported, but the launch settings changed (e.g. after a UGI update)
	outdated: Game[];
	// New games the user had already added to Steam by hand: UGI takes over that shortcut, by game id
	adopt: Record<string, SteamShortcut>;
};

const simplify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// A shortcut added by hand for the same game: its program is in the game's folder, or it has the same name
function findManual(game: Game, shortcuts: SteamShortcut[]): SteamShortcut | undefined {
	const folder = unquotePath(game.start_dir).replace(/\\+$/, '').toLowerCase();
	const inFolder = (s: SteamShortcut) => folder.length > 3 && unquotePath(s.exe).toLowerCase().startsWith(folder + '\\');
	return shortcuts.find(inFolder) ?? shortcuts.find((s) => simplify(s.name) === simplify(game.name));
}

// Compares what the launchers report with what UGI already manages.
// Only launchers scanned successfully (or disabled) can mark games as gone: a failed scan removes nothing.
// shortcuts: the non-Steam shortcuts in Steam, to recognise games the user had added by hand.
export function planSync(games: Game[], launchers: LauncherStatus[], state: UgiState, shortcuts: SteamShortcut[] = []): SyncPlan {
	const found = new Set(games.map((g) => g.id));
	const reliable = new Set(launchers.filter((l) => !l.error).map((l) => l.id));
	const managed = (g: Game) => {
		const entry = state.imported[g.id];
		return !!entry && shortcutExists(entry.appid);
	};
	// Shortcuts not made by UGI, each taken over by one game at most
	const used = new Set(Object.values(state.imported).map((e) => e.appid));
	const adopt: Record<string, SteamShortcut> = {};
	for (const game of games.filter((g) => !managed(g))) {
		const manual = findManual(game, shortcuts.filter((s) => !used.has(s.appid)));
		if (manual) {
			adopt[game.id] = manual;
			used.add(manual.appid);
		}
	}
	return {
		adopt,
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
				const manual = plan.adopt[game.id];
				const appid = manual ? manual.appid : await addShortcut(game);
				state.imported[game.id] = entryFor(game, appid);
				if (manual) {
					const { appid: _, ...fields } = manual;
					state.imported[game.id]!.manual = fields;
					applyShortcutSettings(appid, game);
				}
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
		state.imported[game.id] = entryFor(game, entry.appid, entry.manual);
		updated++;
	}

	for (const id of plan.gone) {
		const entry = state.imported[id];
		// A shortcut the user had made stays, as it was
		if (entry?.manual && shortcutExists(entry.appid)) restoreManual(entry.appid, entry.manual);
		else if (entry && shortcutExists(entry.appid)) SteamClient.Apps.RemoveShortcut(entry.appid);
		delete state.imported[id];
		removed++;
	}

	await syncCollections(state);
	await saveState(state);

	// New games get their images when a SteamGridDB key is set, in the background:
	// downloads can take a while and the import shouldn't wait for them
	const newAppids = [...plan.newGames, ...plan.previouslyExcluded].filter((g) => chosen.has(g.id) && state.imported[g.id]).map((g) => state.imported[g.id]!.appid);
	if (newAppids.length && state.settings.sgdb_key) fillInBackground(state, newAppids);
	return { added, removed, updated };
}

async function fillInBackground(state: UgiState, appids: number[]) {
	startImages(appids);
	try {
		// fillMissing reports how many games are done before starting the next one
		await fillMissing(state, appids, (done) => done > 0 && finishImages(appids[done - 1]!), { stop: false });
		// The state may have changed meanwhile: keep it and add only what the images step learned
		const current = await loadState();
		Object.assign(current.sgdb_ids, state.sgdb_ids);
		Object.assign(current.custom_icons, state.custom_icons);
		await saveState(current);
	} catch (err) {
		console.error('[UGI] automatic images failed', err);
	} finally {
		appids.forEach(finishImages);
	}
}

// A game from a backup, added to Steam again; returns its appid
export function recreateShortcut(id: string, entry: ImportedEntry): Promise<number> {
	return addShortcut({
		id,
		launcher: entry.launcher,
		name: entry.name,
		exe: entry.exe ?? '',
		start_dir: entry.start_dir ?? '',
		launch_options: entry.launch_options ?? '',
	});
}
