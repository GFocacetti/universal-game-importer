import {
	callable,
} from '@steambrew/client';
import { ManagedShortcut, SettingsState, ResyncResult } from 'types';
import { safeJsonParse, toStringArray, toManagedShortcutArray } from 'utils';

// setup backend calls
const getSettingsState = callable<[], string>('get_settings_state');
const getManagedShortcuts = callable<[], string>('get_managed_shortcuts');

const setDisabledShortcuts = callable<[{ json: string }], boolean>('set_disabled_shortcuts');
const setDefaultDisableListEnabled = callable<[{ bool: boolean }], boolean>('set_default_disablelist_enabled');
const setAutoResyncOnStartup = callable<[{ bool: boolean }], boolean>('set_auto_resync_on_startup');

const resyncLibrary = callable<[], string>('resync_library');
const restartSteamClient = callable<[], boolean>('restart_steam_client');
const readImageAsDataUrl = callable<[{ path: string }], string>('read_image_as_data_url');

// wrapped and parsed
export async function restartSteam() {
    return await restartSteamClient();
}

export async function readImageAsDataURL(path: string): Promise<string> {
    return await readImageAsDataUrl({ path });
}

export async function loadSettings(): Promise<SettingsState> {
	const raw = await getSettingsState();
	const p = safeJsonParse<Partial<SettingsState>>(raw, {});

	return {
		current_user: p.current_user,
		default_disablelist_enabled: p.default_disablelist_enabled ?? true,
		auto_resync_on_startup: p.auto_resync_on_startup ?? true,
		disabled_shortcuts: toStringArray(p.disabled_shortcuts),
		managed_shortcuts: toManagedShortcutArray(p.managed_shortcuts),
		last_sync_at: p.last_sync_at ?? null,
	};
}

export async function loadManagedShortcuts(): Promise<ManagedShortcut[]> {
	const raw = await getManagedShortcuts();
	return toManagedShortcutArray(safeJsonParse(raw, []));
}

export async function saveDisabled(ids: string[]) {
	return setDisabledShortcuts({ json: JSON.stringify({ ids }) });
}

export async function saveDefaultDisableList(enabled: boolean) {
	return setDefaultDisableListEnabled({ bool: enabled });
}

export async function saveAutoResync(enabled: boolean) {
	return setAutoResyncOnStartup({ bool: enabled });
}

export async function runResync(): Promise<ResyncResult> {
	return safeJsonParse<ResyncResult>(await resyncLibrary(), {
		success: false,
		changed: false,
		message: 'Invalid backend response',
		synced_at: undefined,
	});
}

// we dont really use these for anything right now, but they might be useful later.
export class UGI {
	static onBackendReady(raw: string) {
		console.log('[backend ready]', safeJsonParse(raw, {}));
		return true;
	}

	static onDisabledShortcutsChanged(raw: string) {
		console.log('[disabled changed]', safeJsonParse(raw, []));
		return true;
	}

	static onResyncFinished(raw: string) {
		console.log('[resync finished]', safeJsonParse(raw, {}));
		return true;
	}

	static onDefaultDisableListChanged(enabled: boolean) {
		console.log('[default disablelist changed]', enabled);
		return true;
	}

	static onAutoResyncChanged(enabled: boolean) {
		console.log('[auto resync changed]', enabled);
		return true;
	}

	static onConfigChanged(key: string, raw: string) {
		const v = safeJsonParse(raw, { value: null });
		console.log('[config changed]', key, v.value);
		return true;
	}
}