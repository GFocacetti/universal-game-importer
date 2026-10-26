import { UgiState } from 'types';

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

const LAUNCHER_NAMES: Record<string, string> = {
	xbox: 'Xbox',
	epic: 'Epic Games',
	gog: 'GOG',
	ea: 'EA',
	battlenet: 'Battle.net',
	amazon: 'Amazon Games',
	ubisoft: 'Ubisoft Connect',
};

const shelfExists = (id: number) => showcaseStore.showcases.some((s) => s.nShowcaseId === id);

// Keeps one collection (and optionally one Home shelf) per launcher in line with the imported games.
// Collections or shelves the user deleted by hand are not recreated.
export async function syncCollections(state: UgiState): Promise<void> {
	const byLauncher: Record<string, number[]> = {};
	for (const entry of Object.values(state.imported)) {
		(byLauncher[entry.launcher] ??= []).push(entry.appid);
	}

	for (const [launcher, appids] of Object.entries(byLauncher)) {
		const info = (state.collections[launcher] ??= {});
		if (!state.settings.collections || info.declined_collection) continue;

		let collection = info.collection_id ? collectionStore.GetCollection(info.collection_id) : undefined;
		if (info.collection_id && !collection) {
			// Deleted by the user: respect it
			info.declined_collection = true;
			delete info.collection_id;
			continue;
		}
		if (!collection) {
			collection = collectionStore.NewUnsavedCollection(LAUNCHER_NAMES[launcher] ?? launcher, undefined, []);
			await collection.Save();
			info.collection_id = collection.id;
		}

		const wanted = new Set(appids);
		const present = new Set(collection.allApps.map((a) => a.appid));
		const toAdd = appids.filter((id) => !present.has(id)).map((id) => appStore.GetAppOverviewByAppID(id)).filter(Boolean);
		const toRemove = [...present].filter((id) => !wanted.has(id)).map((id) => appStore.GetAppOverviewByAppID(id)).filter(Boolean);
		if (toAdd.length || toRemove.length) {
			const editable = collection.AsEditableCollection();
			if (toAdd.length) editable.AddApps(toAdd);
			if (toRemove.length) editable.RemoveApps(toRemove);
			await collection.Save();
		}

		if (!state.settings.shelves || info.declined_shelf) continue;
		if (info.shelf_id !== undefined && !shelfExists(info.shelf_id)) {
			info.declined_shelf = true;
			delete info.shelf_id;
			continue;
		}
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
}

// Removes one launcher's shelf (or collection and shelf) and remembers the choice
export async function removeLauncherCollection(state: UgiState, launcher: string, what: 'collection' | 'shelf'): Promise<void> {
	const info = (state.collections[launcher] ??= {});
	if (info.shelf_id !== undefined && shelfExists(info.shelf_id)) showcaseStore.DeleteShowcase(info.shelf_id);
	delete info.shelf_id;
	info.declined_shelf = true;
	if (what === 'collection') {
		const collection = info.collection_id ? collectionStore.GetCollection(info.collection_id) : undefined;
		if (collection) await collection.Delete();
		delete info.collection_id;
		info.declined_collection = true;
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
