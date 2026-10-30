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
	// false: Steam's overlay turned off for this game (kept from the imported entry)
	overlay?: boolean;
};

export type LauncherStatus = {
	id: string;
	name: string;
	enabled: boolean;
	count: number;
	error?: string;
	// The launcher accepts a custom folder, and whether it was found on this PC
	supports_path?: boolean;
	installed?: boolean;
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
	// A shortcut the user had added by hand and UGI took over: how it was, to put it back
	manual?: ShortcutFields;
	// false: Steam's overlay turned off for this game (see withOverlay)
	overlay?: boolean;
};

export type ShortcutFields = { name: string; exe: string; start_dir: string; launch_options: string };

export type UgiState = {
	imported: Record<string, ImportedEntry>;
	excluded: Record<string, boolean>;
	// Microsoft Store classification cache: package family -> game / app
	store_kinds: Record<string, 'game' | 'app'>;
	settings: UgiSettings;
	// Per launcher: the collection / Home shelf UGI created, or that the user turned off in the Launcher section
	collections: Record<string, CollectionInfo>;
	// SteamGridDB game id per appid, and shortcuts whose icon UGI already set
	sgdb_ids: Record<string, number>;
	custom_icons: Record<string, boolean>;
	// Last check (ISO date) and what each launcher reported
	last_check?: string;
	last_launchers?: LauncherStatus[];
	// First-install setup completed
	onboarded?: boolean;
};

export type UgiSettings = {
	collections: boolean;
	shelves: boolean;
	sgdb_key?: string;
	// Optional: game descriptions from RAWG when the stores don't know the game
	rawg_key?: string;
	// Optional: Xbox achievements of every game through OpenXBL (xbl.io)
	xbl_key?: string;
	// Prefer animated images when SteamGridDB has them
	animated?: boolean;
	// Include WebP images (on by default, can be turned off)
	webp?: boolean;
	theme?: 'steam' | 'modern';
	// 'auto' follows Steam's language
	language?: 'auto' | 'en' | 'it';
	// How often to look for new games
	check_interval?: 'off' | 'daily' | 'weekly' | 'monthly';
	// Per launcher: turned off, or a custom folder
	launchers?: Record<string, { enabled?: boolean; path?: string }>;
	// Gallery filters per image type ("0".. "4")
	filters?: Record<string, { style?: string; dimension?: string; webp?: boolean; nsfw?: string; humor?: string }>;
};

type CollectionInfo = {
	collection_id?: string;
	shelf_id?: number;
	off_collection?: boolean;
	off_shelf?: boolean;
};
