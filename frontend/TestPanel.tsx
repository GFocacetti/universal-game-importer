// Temporary test panel for development milestones; replaced by the real UGI page
import { DialogButton, Field } from '@steambrew/client';
import React, { useState } from 'react';
import { scan, loadState, saveState } from 'backend';
import { classify } from 'classifier';
import { planSync, applySync, removeAll, SyncPlan } from 'importer';
import { Game, LauncherStatus } from 'types';

export default function TestPanel() {
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [launchers, setLaunchers] = useState<LauncherStatus[]>([]);
	const [plan, setPlan] = useState<SyncPlan | null>(null);
	const [chosen, setChosen] = useState<Set<string>>(new Set());

	const run = async (label: string, job: () => Promise<void>) => {
		setBusy(true);
		setStatus(label);
		try {
			await job();
		} catch (err) {
			setStatus(`Error: ${err}`);
		}
		setBusy(false);
	};

	const doScan = () =>
		run('Scanning…', async () => {
			const result = await scan();
			const state = await loadState();
			if (await classify(result.games, state)) await saveState(state);
			const next = planSync(result.games, result.launchers, state);
			setLaunchers(result.launchers);
			setPlan(next);
			setChosen(new Set(next.newGames.filter((g) => g.kind === 'game').map((g) => g.id)));
			setStatus(`Found ${result.games.length} · new ${next.newGames.length} · excluded ${next.previouslyExcluded.length} · to update ${next.outdated.length} · uninstalled ${next.gone.length}`);
		});

	const doImport = () =>
		run('Importing…', async () => {
			if (!plan) return;
			const res = await applySync(plan, chosen);
			setPlan(null);
			setStatus(`Added ${res.added}, updated ${res.updated}, removed ${res.removed}`);
		});

	const doRemoveAll = () =>
		run('Removing…', async () => {
			setStatus(`Removed ${await removeAll()} shortcuts`);
			setPlan(null);
		});

	const toggle = (id: string) => {
		const next = new Set(chosen);
		next.has(id) ? next.delete(id) : next.add(id);
		setChosen(next);
	};

	const row = (g: Game) => (
		<label key={g.id} style={{ display: 'flex', gap: 8, padding: '3px 0', opacity: chosen.has(g.id) ? 1 : 0.6 }}>
			<input type="checkbox" checked={chosen.has(g.id)} onChange={() => toggle(g.id)} />
			{g.name} <span style={{ opacity: 0.6 }}>· {g.launcher}{g.kind === 'uncertain' ? ' · uncertain' : ''}</span>
		</label>
	);

	return (
		<div>
			<Field label="UGI test panel" description="Temporary panel for testing, not the final UI." bottomSeparator="standard">
				<div style={{ display: 'flex', gap: 8 }}>
					<DialogButton disabled={busy} onClick={doScan}>Scan</DialogButton>
					<DialogButton disabled={busy || !plan} onClick={doImport}>Apply ({chosen.size} new)</DialogButton>
					<DialogButton disabled={busy} onClick={doRemoveAll}>Remove all UGI shortcuts</DialogButton>
				</div>
			</Field>
			<div style={{ padding: '8px 0' }}>{status}</div>
			{launchers.map((l) => (
				<div key={l.id}>{l.name}: {l.error ? `error – ${l.error}` : `${l.count} found`}</div>
			))}
			{plan && (
				<div style={{ marginTop: 10 }}>
					<b>New</b>
					{plan.newGames.filter((g) => g.kind !== 'app').map(row)}
					{plan.newGames.some((g) => g.kind === 'app') && (
						<details>
							<summary>Other apps · {plan.newGames.filter((g) => g.kind === 'app').length}</summary>
							{plan.newGames.filter((g) => g.kind === 'app').map(row)}
						</details>
					)}
					{plan.previouslyExcluded.length > 0 && (
						<details>
							<summary>Previously excluded · {plan.previouslyExcluded.length}</summary>
							{plan.previouslyExcluded.map(row)}
						</details>
					)}
				</div>
			)}
		</div>
	);
}
