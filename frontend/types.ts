export type Game = {
	id: string;
	launcher: string;
	name: string;
	exe: string;
	start_dir: string;
	launch_options: string;
	icon?: string | null;
	// game: imported by default · uncertain: shown unticked · app: listed under "other apps", unticked
	kind?: 'game' | 'uncertain' | 'app';
	// Microsoft Store package family, used to classify Xbox entries
	store_family?: string;
};

export type LauncherStatus = {
	id: string;
	name: string;
	enabled: boolean;
	count: number;
	error?: string;
};

export type ScanResult = {
	launchers: LauncherStatus[];
	games: Game[];
};

export type ImportedEntry = {
	appid: number;
	name: string;
	launcher: string;
	// How the shortcut was created, to detect when it needs updating
	exe?: string;
	start_dir?: string;
	launch_options?: string;
};

export type UgiState = {
	imported: Record<string, ImportedEntry>;
	excluded: Record<string, boolean>;
	// Microsoft Store classification cache: package family -> game / app
	store_kinds: Record<string, 'game' | 'app'>;
	settings: UgiSettings;
	// Per launcher: the collection / Home shelf UGI created, or that the user deleted (declined)
	collections: Record<string, CollectionInfo>;
	// SteamGridDB game id per appid, and shortcuts whose icon UGI already set
	sgdb_ids: Record<string, number>;
	custom_icons: Record<string, boolean>;
};

export type UgiSettings = {
	collections: boolean;
	shelves: boolean;
	sgdb_key?: string;
	// Prefer animated images when SteamGridDB has them
	animated?: boolean;
	// Include WebP images (on by default, can be turned off)
	webp?: boolean;
	theme?: 'steam' | 'modern';
	// Gallery filters per image type ("0".. "4")
	filters?: Record<string, { style?: string; dimension?: string; webp?: boolean; nsfw?: string; humor?: string }>;
};

export type CollectionInfo = {
	collection_id?: string;
	shelf_id?: number;
	declined_collection?: boolean;
	declined_shelf?: boolean;
};
