import { UgiState } from 'types';
import { launcherName } from 'steamApps';

// Steam client stores (globals in Steam's UI context)
type SteamCollection = {
	id: string;
	displayName: string;
	allApps: { appid: number }[];
	AsEditableCollection(): { AddApps(apps: unknown[]): void; RemoveApps(apps: unknown[]): void };
	Save(): Promise<void>;
	Delete(): Promise<void>;
};
declare const collectionStore: {
	NewUnsavedCollection(name: string, filter: unknown, apps: unknown[]): SteamCollection;
	GetCollection(id: string): SteamCollection | undefined;
};
declare const showcaseStore: {
	showcases: { nShowcaseId: number; strCollectionId: string }[];
	maxShowcases: number;
	AddNewShowcase(collectionId: string): void;
	DeleteShowcase(showcaseId: number): void;
};
declare const appStore: { GetAppOverviewByAppID(appid: number): unknown };

const shelfExists = (id: number) => showcaseStore.showcases.some((s) => s.nShowcaseId === id);

// A shortcut just added may take a moment to show up in Steam's app list
async function overviewOf(appid: number) {
	for (let i = 0; i < 20; i++) {
		const overview = appStore.GetAppOverviewByAppID(appid);
		if (overview) return overview;
		await new Promise((r) => setTimeout(r, 250));
	}
	return null;
}

// Keeps one collection (and optionally one Home shelf) per launcher in line with the imported games.
// A collection or shelf deleted by hand in Steam is created again; one turned off in the
// Launcher section (off_collection / off_shelf) is not. A launcher left without games loses its
// collection and shelf, made again when one of its games comes back.
export async function syncCollections(state: UgiState): Promise<void> {
	const byLauncher: Record<string, number[]> = {};
	for (const entry of Object.values(state.imported)) {
		(byLauncher[entry.launcher] ??= []).push(entry.appid);
	}

	const everyImported = new Set(Object.values(state.imported).map((e) => e.appid));
	for (const [launcher, appids] of Object.entries(byLauncher)) {
		const info = (state.collections[launcher] ??= {});
		if (!state.settings.collections || info.off_collection) continue;

		let collection = info.collection_id ? collectionStore.GetCollection(info.collection_id) : undefined;
		if (info.collection_id && !collection) {
			// Deleted in Steam: create it again (its shelf went with it)
			delete info.collection_id;
			delete info.shelf_id;
		}
		if (!collection) {
			collection = collectionStore.NewUnsavedCollection(launcherName(launcher), undefined, []);
			await collection.Save();
			info.collection_id = collection.id;
		}

		const wanted = new Set(appids);
		const present = new Set(collection.allApps.map((a) => a.appid));
		const toAdd = (await Promise.all(appids.filter((id) => !present.has(id)).map(overviewOf))).filter(Boolean);
		// Only games UGI put there (or now another launcher's): what the user added stays
		const ours = new Set(info.apps ?? []);
		const toRemove = [...present].filter((id) => !wanted.has(id) && (ours.has(id) || everyImported.has(id))).map((id) => appStore.GetAppOverviewByAppID(id)).filter(Boolean);
		if (toAdd.length || toRemove.length) {
			const editable = collection.AsEditableCollection();
			if (toAdd.length) editable.AddApps(toAdd);
			if (toRemove.length) editable.RemoveApps(toRemove);
			await collection.Save();
		}
		info.apps = appids;

		if (!state.settings.shelves || info.off_shelf) continue;
		// Deleted in Steam: create it again
		if (info.shelf_id !== undefined && !shelfExists(info.shelf_id)) delete info.shelf_id;
		if (info.shelf_id === undefined) {
			if (showcaseStore.showcases.length >= showcaseStore.maxShowcases) {
				console.warn('[UGI] shelf limit reached, no shelf for', launcher);
				continue;
			}
			showcaseStore.AddNewShowcase(collection.id);
			const shelf = showcaseStore.showcases.find((s) => s.strCollectionId === collection!.id);
			if (shelf) info.shelf_id = shelf.nShowcaseId;
		}
	}

	if (!state.settings.collections) return;
	for (const [launcher, info] of Object.entries(state.collections)) {
		if (byLauncher[launcher]?.length) continue;
		if (info.shelf_id !== undefined) {
			if (shelfExists(info.shelf_id)) showcaseStore.DeleteShowcase(info.shelf_id);
			delete info.shelf_id;
		}
		if (info.collection_id) {
			await collectionStore.GetCollection(info.collection_id)?.Delete();
			delete info.collection_id;
		}
		delete info.apps;
	}
}

// Removes one launcher's shelf (or collection and shelf) and remembers the choice
export async function removeLauncherCollection(state: UgiState, launcher: string, what: 'collection' | 'shelf'): Promise<void> {
	const info = (state.collections[launcher] ??= {});
	if (info.shelf_id !== undefined && shelfExists(info.shelf_id)) showcaseStore.DeleteShowcase(info.shelf_id);
	delete info.shelf_id;
	info.off_shelf = true;
	if (what === 'collection') {
		const collection = info.collection_id ? collectionStore.GetCollection(info.collection_id) : undefined;
		if (collection) await collection.Delete();
		delete info.collection_id;
		info.off_collection = true;
	}
}

// Removes every collection and shelf UGI created; the games stay in the library
export async function removeCollections(state: UgiState): Promise<number> {
	let removed = 0;
	for (const info of Object.values(state.collections)) {
		if (info.shelf_id !== undefined && shelfExists(info.shelf_id)) {
			showcaseStore.DeleteShowcase(info.shelf_id);
			removed++;
		}
		const collection = info.collection_id ? collectionStore.GetCollection(info.collection_id) : undefined;
		if (collection) {
			await collection.Delete();
			removed++;
		}
	}
	state.collections = {};
	state.settings.collections = false;
	state.settings.shelves = false;
	return removed;
}
