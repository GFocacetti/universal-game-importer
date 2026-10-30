import { callable } from '@steambrew/client';
import { loadState, saveState, scan, unquote } from 'backend';
import { classify } from 'classifier';
import { planSync, steamShortcuts, SyncPlan, unquotePath } from 'importer';
import { Game, LauncherStatus, UgiState } from 'types';

export type ScanOutcome = { plan: SyncPlan; launchers: LauncherStatus[]; games: Game[] };

// Scans the enabled launchers (with custom paths), classifies Store apps and plans the sync.
// Remembers when the check ran and what each launcher reported.
const missingFiles = callable<[{ a_paths: string }], string>('ugi_missing_files');

// Programs of games added by hand that are no longer there (lowercase)
async function missingPrograms(state: UgiState): Promise<Set<string>> {
	const exes = Object.values(state.imported).filter((e) => e.launcher === 'manual' && e.exe).map((e) => unquotePath(e.launch?.exe || e.exe));
	if (!exes.length) return new Set();
	try {
		const list = JSON.parse(unquote(await missingFiles({ a_paths: JSON.stringify(exes) })));
		return new Set((Array.isArray(list) ? list : []).map((p: unknown) => String(p).toLowerCase()));
	} catch {
		return new Set();
	}
}

export async function runScan(): Promise<ScanOutcome> {
	const state = await loadState();
	const enabled: Record<string, boolean> = {};
	const paths: Record<string, string> = {};
	for (const [id, cfg] of Object.entries(state.settings.launchers ?? {})) {
		if (cfg.enabled === false) enabled[id] = false;
		if (cfg.path) paths[id] = cfg.path;
	}
	const result = await scan({ enabled, paths });
	await classify(result.games, state);
	state.last_check = new Date().toISOString();
	state.last_launchers = result.launchers;
	await saveState(state);
	return { plan: planSync(result.games, result.launchers, state, await steamShortcuts(), await missingPrograms(state)), launchers: result.launchers, games: result.games };
}

