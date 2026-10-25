// Temporary test panel for development milestones; replaced by the real UGI page
import { DialogButton, Field, TextField, Toggle } from '@steambrew/client';
import React, { useState } from 'react';
import { scan, loadState, saveState } from 'backend';
import { classify } from 'classifier';
import { planSync, applySync, removeAll, SyncPlan } from 'importer';
import { syncCollections, removeCollections } from 'collections';
import { checkMissing, fillMissing, replaceAll, resetImages, setTrace, IMAGE_TYPE_NAMES, ImageType, StopFlag } from 'sgdb';

declare const collectionStore: { allAppsCollection: { allApps: { appid: number }[] } };
import { Game, LauncherStatus, UgiSettings } from 'types';

export default function TestPanel() {
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [launchers, setLaunchers] = useState<LauncherStatus[]>([]);
	const [plan, setPlan] = useState<SyncPlan | null>(null);
	const [chosen, setChosen] = useState<Set<string>>(new Set());
	const [settings, setSettings] = useState<UgiSettings | null>(null);

	if (!settings) loadState().then((s) => setSettings(s.settings));

	// Turning an option on also lifts the "deleted by the user" block, then syncs
	const setOption = (key: 'collections' | 'shelves', value: boolean) =>
		run('Updating collections…', async () => {
			const state = await loadState();
			state.settings[key] = value;
			if (value) {
				for (const info of Object.values(state.collections)) {
					if (key === 'collections') delete info.declined_collection;
					else delete info.declined_shelf;
				}
			}
			await syncCollections(state);
			await saveState(state);
			setSettings(state.settings);
			setStatus('Collections updated');
		});

	const [keyDraft, setKeyDraft] = useState<string | null>(null);
	const [scope, setScope] = useState<'imported' | 'library'>('imported');
	const [flag, setFlag] = useState<StopFlag | null>(null);

	const saveSetting = async (patch: Partial<UgiSettings>) => {
		const state = await loadState();
		Object.assign(state.settings, patch);
		await saveState(state);
		setSettings(state.settings);
	};

	const targetAppids = async () => {
		const state = await loadState();
		return scope === 'imported'
			? Object.values(state.imported).map((e) => e.appid)
			: collectionStore.allAppsCollection.allApps.map((a) => a.appid);
	};

	// Runs a bulk image tool with progress and Stop
	const imageTool = (label: string, job: (appids: number[], progress: (d: number, t: number) => void, f: StopFlag) => Promise<string>) =>
		run(label, async () => {
			const f: StopFlag = { stop: false };
			setFlag(f);
			setTrace((msg) => setStatus(`${label} ${msg}`));
			try {
				const appids = await targetAppids();
				const result = await job(appids, (d, t) => setStatus(`${label} ${d}/${t}`), f);
				setStatus(f.stop ? `Stopped · ${result}` : result);
			} finally {
				setFlag(null);
			}
		});

	const doCheck = () =>
		imageTool('Checking…', async (appids) => {
			const counts = await checkMissing(appids);
			return `Missing in ${appids.length} apps: ` + (Object.keys(counts) as unknown as ImageType[]).map((t) => `${IMAGE_TYPE_NAMES[t]} ${counts[t]}`).join(' · ');
		});
	const doFill = () =>
		imageTool('Filling missing…', async (appids, p, f) => {
			const state = await loadState();
			const n = await fillMissing(state, appids, p, f);
			await saveState(state);
			return `Applied ${n} images`;
		});
	const doReplace = () =>
		imageTool('Replacing…', async (appids, p, f) => {
			const state = await loadState();
			const n = await replaceAll(state, appids, [0, 1, 2, 3, 4], p, f);
			await saveState(state);
			return `Applied ${n} images`;
		});
	const doReset = () =>
		imageTool('Resetting…', async (appids, p, f) => {
			await resetImages(appids, p, f);
			return 'Back to the original images';
		});

	const doRemoveCollections = () =>
		run('Removing collections…', async () => {
			const state = await loadState();
			const n = await removeCollections(state);
			await saveState(state);
			setSettings(state.settings);
			setStatus(`Removed ${n} collections / shelves`);
		});

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
			{settings && (
				<>
					<Field label="Collections per launcher" bottomSeparator="none">
						<Toggle value={settings.collections} disabled={busy} onChange={(v: boolean) => setOption('collections', v)} />
					</Field>
					<Field label="Home shelves" bottomSeparator="none">
						<Toggle value={settings.shelves} disabled={busy || !settings.collections} onChange={(v: boolean) => setOption('shelves', v)} />
					</Field>
					<DialogButton disabled={busy} onClick={doRemoveCollections}>Remove UGI collections and shelves</DialogButton>
					<Field label="SteamGridDB API key" bottomSeparator="none">
						<TextField value={keyDraft ?? settings.sgdb_key ?? ''} onChange={(e: any) => setKeyDraft(e.target.value)} />
					</Field>
					<DialogButton disabled={busy || keyDraft === null} onClick={() => saveSetting({ sgdb_key: (keyDraft ?? '').trim() }).then(() => setKeyDraft(null))}>Save key</DialogButton>
					<Field label="Prefer animated images" bottomSeparator="none">
						<Toggle value={!!settings.animated} disabled={busy} onChange={(v: boolean) => saveSetting({ animated: v })} />
					</Field>
					<Field label="Image tools apply to" bottomSeparator="none">
						<DialogButton onClick={() => setScope(scope === 'imported' ? 'library' : 'imported')}>{scope === 'imported' ? 'Imported games' : 'Whole library'}</DialogButton>
					</Field>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
						<DialogButton disabled={busy} onClick={doCheck}>Check missing</DialogButton>
						<DialogButton disabled={busy || !settings.sgdb_key} onClick={doFill}>Fill missing</DialogButton>
						<DialogButton disabled={busy || !settings.sgdb_key} onClick={doReplace}>Replace all</DialogButton>
						<DialogButton disabled={busy} onClick={doReset}>Reset</DialogButton>
					</div>
					{flag && <DialogButton onClick={() => { flag.stop = true; setStatus('Stopping…'); }}>Stop</DialogButton>}
				</>
			)}
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
