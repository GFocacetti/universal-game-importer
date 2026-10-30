import { callable } from '@steambrew/client';
import { Game, ImportedEntry, LauncherStatus, ShortcutFields, UgiState } from 'types';
import { loadState, saveState, unquote } from 'backend';
import { syncCollections } from 'collections';
import { fillMissing } from 'sgdb';
import { prefetchInfo } from 'gameInfo';
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

// Games started through UGI's launch helper have Steam's overlay unless it is turned off: then the
// launcher starts outside what Steam follows, and the game no longer stays "running" while it is open
export const usesLaunchHelper = (options: string | undefined) => !!options?.includes('ugi_launch.ps1') && options.includes('-WaitDir');
export const withOverlay = (options: string, overlay?: boolean) => (overlay === false && usesLaunchHelper(options) ? `${options} -Detached` : options);

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('\\'));

// The shortcut's fields once the user's launch settings and the overlay switch are applied
export function launchFields(game: Pick<Game, 'launcher' | 'exe' | 'start_dir' | 'launch_options' | 'overlay' | 'launch'>) {
	const l = game.launch ?? {};
	if (game.launcher === 'manual') {
		return { exe: l.exe || game.exe, start_dir: l.start_dir || (l.exe ? folderOf(l.exe) : game.start_dir), launch_options: l.args ?? '' };
	}
	const base = l.direct && l.fields ? l.fields : { exe: game.exe, start_dir: game.start_dir, launch_options: game.launch_options };
	const options = usesLaunchHelper(base.launch_options) && l.closed ? `${base.launch_options} -Closed ${l.closed}` : base.launch_options;
	return { ...base, launch_options: withOverlay(options, game.overlay) };
}

function applyShortcutSettings(appid: number, game: Game) {
	const fields = launchFields(game);
	SteamClient.Apps.SetShortcutName(appid, game.name);
	SteamClient.Apps.SetShortcutExe(appid, quote(fields.exe));
	SteamClient.Apps.SetShortcutStartDir(appid, quote(fields.start_dir));
	SteamClient.Apps.SetShortcutLaunchOptions(appid, fields.launch_options);
	if (game.icon) SteamClient.Apps.SetShortcutIcon(appid, game.icon);
}

// An imported game's shortcut set again from its entry (after changing its launch settings or overlay)
export function applyEntry(id: string, entry: ImportedEntry) {
	applyShortcutSettings(entry.appid, { id, launcher: entry.launcher, name: entry.name, exe: entry.exe ?? '', start_dir: entry.start_dir ?? '', launch_options: entry.launch_options ?? '', overlay: entry.overlay, launch: entry.launch });
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
	...(game.overlay === false ? { overlay: false } : {}),
	...(game.launch ? { launch: game.launch } : {}),
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
// missing: programs of games added by hand that are gone (lowercase); such a game, or one whose
// shortcut was deleted in Steam, goes too.
export function planSync(games: Game[], launchers: LauncherStatus[], state: UgiState, shortcuts: SteamShortcut[] = [], missing = new Set<string>()): SyncPlan {
	const found = new Set(games.map((g) => g.id));
	const reliable = new Set(launchers.filter((l) => !l.error).map((l) => l.id));
	const managed = (g: Game) => {
		const entry = state.imported[g.id];
		return !!entry && shortcutExists(entry.appid);
	};
	// A shortcut deleted in Steam: gone from its shortcuts file (Steam's app list may keep it until a
	// restart); nothing counts as deleted when the file couldn't be read
	const listed = new Set(shortcuts.map((x) => x.appid));
	const deleted = (appid: number) => shortcuts.length > 0 && !listed.has(appid);
	// Steam saves that file a moment after a shortcut is added: a game just added isn't judged by it yet
	const recent = (e: ImportedEntry) => !!e.added && Date.now() - e.added < 10 * 60 * 1000;
	// Shortcuts not made by UGI, each taken over by one game at most; a game added by hand in UGI's
	// page is taken over too when a launcher finds it
	const used = new Set(Object.values(state.imported).filter((e) => e.launcher !== 'manual').map((e) => e.appid));
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
		gone: Object.entries(state.imported)
			.filter(([id, e]) =>
				e.launcher === 'manual'
					? (deleted(e.appid) && !recent(e)) || missing.has(unquotePath(e.launch?.exe || e.exe).toLowerCase())
					: !found.has(id) && reliable.has(e.launcher),
			)
			.map(([id]) => id),
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
				// Added by hand in UGI's page: now the launcher's (UGI made it, nothing to put back)
				const byHand = Object.entries(state.imported).find(([, e]) => e.launcher === 'manual' && e.appid === appid);
				if (byHand) {
					delete state.imported[byHand[0]];
					applyShortcutSettings(appid, game);
				}
				state.imported[game.id] = entryFor(game, appid);
				if (manual && !byHand) {
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
		const kept = { ...game, overlay: entry.overlay, launch: entry.launch };
		applyShortcutSettings(entry.appid, kept);
		state.imported[game.id] = entryFor(kept, entry.appid, entry.manual);
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
	// And their information, for the page in the library
	const newIds = [...plan.newGames, ...plan.previouslyExcluded].filter((g) => chosen.has(g.id) && state.imported[g.id]).map((g) => g.id);
	if (newIds.length) prefetchInfo(state, newIds);
	return { added, removed, updated };
}

// A game added by hand from its program: a shortcut like the imported ones, with its pictures and
// information fetched the same way. Its id is "manual:<appid>", the key game information already
// uses for shortcuts added by hand.
export async function addManualGame(exe: string, name: string): Promise<number> {
	const game: Game = { id: '', launcher: 'manual', name, exe, start_dir: exe.slice(0, exe.lastIndexOf('\\')), launch_options: '' };
	const appid = await addShortcut(game);
	const state = await loadState();
	const id = `manual:${appid}`;
	state.imported[id] = { ...entryFor({ ...game, id }, appid), added: Date.now() };
	await syncCollections(state);
	await saveState(state);
	if (state.settings.sgdb_key) fillInBackground(state, [appid]);
	prefetchInfo(state, [id]);
	return appid;
}

async function fillInBackground(state: UgiState, appids: number[]) {
	startImages(appids);
	const before = { ids: { ...state.sgdb_ids }, icons: { ...state.custom_icons } };
	try {
		// fillMissing reports how many games are done before starting the next one
		await fillMissing(state, appids, (done) => done > 0 && finishImages(appids[done - 1]!), { stop: false });
		// The state may have changed meanwhile: keep it and add only what the images step learned
		const current = await loadState();
		for (const [key, id] of Object.entries(state.sgdb_ids)) if (before.ids[key] !== id) current.sgdb_ids[key] = id;
		for (const [key, on] of Object.entries(state.custom_icons)) if (before.icons[key] !== on) current.custom_icons[key] = on;
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
		overlay: entry.overlay,
		launch: entry.launch,
	});
}
