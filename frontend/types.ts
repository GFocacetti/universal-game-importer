export type ManagedShortcut = {
	id: string;
	name: string;
	enabled: boolean;
	icon?: string | null;
	source?: string | null;
};

export type SettingsState = {
	current_user?: {
		steamid64: string;
		steam3: string;
		account_name?: string;
		persona_name?: string;
	};
	default_disablelist_enabled: boolean;
	auto_resync_on_startup: boolean;
	disabled_shortcuts: string[];
	managed_shortcuts: ManagedShortcut[];
	last_sync_at?: string | null;
};

export type ResyncResult = {
	success: boolean;
	changed: boolean;
	message?: string;
	synced_at?: string;
};

export type FilterMode = 'all' | 'enabled' | 'disabled';
