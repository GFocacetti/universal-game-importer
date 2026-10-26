import { loadState, saveState, scan } from 'backend';
import { classify } from 'classifier';
import { planSync, SyncPlan } from 'importer';
import { Game, LauncherStatus } from 'types';

export type ScanOutcome = { plan: SyncPlan; launchers: LauncherStatus[]; games: Game[] };

// Scans the enabled launchers (with custom paths), classifies Store apps and plans the sync.
// Remembers when the check ran and what each launcher reported.
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
	return { plan: planSync(result.games, result.launchers, state), launchers: result.launchers, games: result.games };
}

// Something worth showing to the user: new games, or games to remove / update
export function hasChanges(plan: SyncPlan): boolean {
	return plan.newGames.length > 0 || plan.gone.length > 0 || plan.outdated.length > 0;
}
