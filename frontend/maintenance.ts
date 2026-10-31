import { callable } from '@steambrew/client';
import { loadState, saveState, unquote, windowsDialog } from 'backend';
import { removeCollections, syncCollections } from 'collections';
import { setLanguage } from 'i18n';
import { recreateShortcut, shortcutExists, SteamShortcut, steamShortcuts, unquotePath, withOverlay } from 'importer';
import { resetImages } from 'sgdb';
import { isSteamApp } from 'steamApps';
import { UgiState } from 'types';

// Backup to a .zip in Documents\UGI backup, restore from it, and removal of everything UGI did
const backupExport = callable<[{ a_state: string; b_appids: string }], string>('ugi_backup_export');
const backupList = callable<[], string>('ugi_backup_list');
const backupOpen = callable<[{ a_zip: string }], string>('ugi_backup_open');
const backupPick = callable<[], string>('ugi_backup_pick');
const backupRestore = callable<[{ a_appids: string; b_steam: string }], string>('ugi_backup_restore');
const cleanup = callable<[], boolean>('ugi_cleanup');
const openFolder = callable<[{ a_path: string }], boolean>('ugi_open_folder');
const customList = callable<[], string>('ugi_custom_list');
const customScan = callable<[], string>('ugi_custom_scan');
const customMarkMany = callable<[{ a_appids: string }], boolean>('ugi_custom_mark_many');
const backupState = callable<[], string>('ugi_backup_state');
const backupDelete = callable<[{ a_zip: string }], boolean>('ugi_backup_delete');
const jobStatus = callable<[{ a_name: string }], string>('ugi_job_status');
const jobCancel = callable<[{ a_name: string }], boolean>('ugi_job_cancel');

// Zipping and copying hundreds of MB run as background jobs in the backend: wait for their end
export type CancelFlag = { cancel: boolean };
async function waitJob(name: string, flag?: CancelFlag): Promise<'ok' | 'cancelled'> {
	for (;;) {
		await new Promise((r) => setTimeout(r, 1500));
		if (flag?.cancel) {
			await jobCancel({ a_name: name });
			return 'cancelled';
		}
		const status = unquote(await jobStatus({ a_name: name }));
		if (status === 'ok') return 'ok';
		if (status === 'cancelled') return 'cancelled';
		if (status.startsWith('error')) throw new Error(status);
	}
}

const sameShortcut = (a: SteamShortcut, b: { name: string; exe?: string; launch_options?: string; overlay?: boolean }) =>
	a.name === b.name && unquotePath(a.exe) === unquotePath(b.exe) && a.launch_options === withOverlay(b.launch_options ?? '', b.overlay);


export type Step = (text: string) => void;
export type Backup = { name: string; path: string };

// A backup's state also lists the Steam apps whose artwork UGI changed
type BackupState = UgiState & { customized?: number[] };

// Backend answers are JSON; Millennium may hand them back once more wrapped as a JSON string
const json = <T>(raw: unknown, fallback: T): T => {
	try {
		let value = JSON.parse(String(raw ?? ''));
		if (typeof value === 'string') value = JSON.parse(value);
		return value ?? fallback;
	} catch {
		return fallback;
	}
};

export const openBackupFolder = (path: string) => openFolder({ a_path: path });

// Windows' file dialog: the path of the chosen backup, or "" if cancelled
export async function pickBackup(): Promise<Backup | null> {
	const path = (await windowsDialog(backupPick, 'backup')).replace(/\\\\/g, '\\');
	return path ? { name: path.split('\\').pop() ?? path, path } : null;
}

// Steam apps (not imported games) whose artwork UGI changed: the ones recorded when artwork is
// applied, plus the ones UGI looked up on SteamGridDB or gave an icon
async function customizedSteamApps(state: UgiState): Promise<number[]> {
	const imported = new Set(Object.values(state.imported).map((e) => e.appid));
	// An empty Lua list arrives as {}
	const listed = json<unknown>(unquote(await customList()), []);
	const ids = new Set<number>(Array.isArray(listed) ? listed : []);
	for (const key of [...Object.keys(state.sgdb_ids), ...Object.keys(state.custom_icons)]) if (/^\d+$/.test(key)) ids.add(Number(key));
	// Only Steam apps still in the library (old shortcut ids from earlier imports are left out)
	return [...ids].filter((id) => id && !imported.has(id) && isSteamApp(id));
}

// What "Remove everything" will remove, for the confirmation
export async function removalSummary(state: UgiState): Promise<{ games: number; apps: number }> {
	return {
		games: Object.values(state.imported).filter((e) => shortcutExists(e.appid)).length,
		apps: (await customizedSteamApps(state)).length,
	};
}

// UGI takes over the custom artwork Steam games already have (from Steam's dialog, Easy SteamGrid…):
// from now on it goes in the backups and is reset by "Remove everything"
async function adoptExistingArtwork() {
	const found = json<unknown>(unquote(await customScan()), []);
	// An empty Lua list arrives as {}
	const listed = json<unknown>(unquote(await customList()), []);
	const known = new Set(Array.isArray(listed) ? listed : []);
	const adopted = (Array.isArray(found) ? found : []).filter((appid) => !known.has(appid) && isSteamApp(appid));
	if (adopted.length) await customMarkMany({ a_appids: JSON.stringify(adopted) });
}

export async function exportBackup(flag: CancelFlag): Promise<{ path?: string; error?: string; cancelled?: boolean }> {
	await adoptExistingArtwork();
	const state: BackupState = await loadState();
	state.customized = await customizedSteamApps(state);
	const appids = [...Object.values(state.imported).map((e) => e.appid), ...state.customized];
	const started = json<{ path?: string; error?: string }>(unquote(await backupExport({ a_state: JSON.stringify(state), b_appids: JSON.stringify(appids) })), { error: 'no answer' });
	if (!started.path) return started;
	return (await waitJob('backup', flag)) === 'cancelled' ? { cancelled: true } : { path: started.path };
}

// Moves a backup to the Recycle Bin
export async function deleteBackup(path: string): Promise<boolean> {
	return String(unquote(await backupDelete({ a_zip: path }))) === 'true';
}

export async function listBackups(): Promise<{ dir: string; files: Backup[] }> {
	const list = json<{ dir?: string; files?: Backup[] }>(unquote(await backupList()), {});
	return { dir: list.dir ?? '', files: Array.isArray(list.files) ? list.files : [] };
}

// Opens a backup: what it holds, for the confirmation
export async function readBackup(path: string): Promise<BackupState | null> {
	await backupOpen({ a_zip: path });
	await waitJob('unzip');
	const state = json<BackupState | null>(await backupState(), null);
	return state && typeof state === 'object' && state.settings ? state : null;
}

// Puts a backup back: settings, imported games (created again when missing), collections and artwork
export async function restoreBackup(backup: BackupState, step: Step): Promise<{ games: number; files: number }> {
	const { customized = [], ...restored } = backup;
	const state = restored as UgiState;

	step('games');
	// Steam gives a shortcut created again a new id: the artwork is renamed to follow it.
	// A shortcut already in Steam with the same name and command is used again, and copies of it
	// (left by an interrupted restore) are removed.
	const existing = await steamShortcuts();
	// Among copies, the one UGI uses now (it has the pictures and the collections) is kept
	const inUse = new Set(Object.values((await loadState()).imported).map((e) => e.appid));
	const moved: Record<string, number> = {};
	let games = 0;
	for (const [id, entry] of Object.entries(state.imported)) {
		try {
			const matches = existing.filter((s) => sameShortcut(s, entry));
			const kept = matches.find((s) => s.appid === entry.appid) ?? matches.find((s) => inUse.has(s.appid)) ?? matches[0];
			for (const copy of matches) {
				if (copy === kept) continue;
				for (const type of [0, 1, 2, 3]) SteamClient.Apps.ClearCustomArtworkForApp(copy.appid, type);
				SteamClient.Apps.RemoveShortcut(copy.appid);
			}
			const appid = kept ? kept.appid : await recreateShortcut(id, entry);
			if (!kept) games++;
			if (appid !== entry.appid) moved[String(entry.appid)] = appid;
			entry.appid = appid;
		} catch (err) {
			console.error('[UGI] restore: cannot add', entry.name, err);
		}
	}

	step('images');
	const restoredFiles = json<{ files?: number; icons?: Record<string, string>; error?: string }>(
		unquote(await backupRestore({ a_appids: JSON.stringify(moved), b_steam: JSON.stringify(customized) })),
		{},
	);
	// The settings are only saved once the pictures are back
	if (restoredFiles.error) throw new Error(restoredFiles.error);
	await waitJob('restore');
	for (const [appid, path] of Object.entries(restoredFiles.icons ?? {})) SteamClient.Apps.SetShortcutIcon(Number(appid), path);
	if (customized.length) await customMarkMany({ a_appids: JSON.stringify(customized) });

	step('collections');
	// Collections and shelves deleted meanwhile are created again by the sync
	if (state.settings.collections) await syncCollections(state);
	// A restored UGI is set up already
	state.onboarded = true;
	await saveState(state);
	setLanguage(state.settings.language);
	return { games, files: restoredFiles.files ?? 0 };
}

// Before uninstalling: removes the imported games, UGI's collections and shelves, the artwork UGI
// set on Steam games, its files and its settings
export async function removeEverything(step: Step): Promise<{ games: number; apps: number }> {
	const state = await loadState();

	step('steamGames');
	const apps = await customizedSteamApps(state);
	await resetImages(apps, () => {}, { stop: false });

	step('games');
	let games = 0;
	for (const entry of Object.values(state.imported)) {
		if (!shortcutExists(entry.appid)) continue;
		// The custom artwork files would stay behind in Steam's grid folder
		for (const type of [0, 1, 2, 3]) SteamClient.Apps.ClearCustomArtworkForApp(entry.appid, type);
		SteamClient.Apps.RemoveShortcut(entry.appid);
		games++;
	}

	step('collections');
	await removeCollections(state);

	step('files');
	await cleanup();
	// A clean state: the next start (if the plugin is kept) is a first install
	await saveState({ imported: {}, excluded: {}, store_kinds: {}, settings: { collections: false, shelves: false }, collections: {}, sgdb_ids: {}, custom_icons: {} });
	return { games, apps: apps.length };
}
