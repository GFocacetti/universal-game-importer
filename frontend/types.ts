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
};
