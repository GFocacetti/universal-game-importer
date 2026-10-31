import React, { useEffect, useState } from 'react';
import { applySync, SyncPlan } from 'importer';
import { loadState } from 'backend';
import { t } from 'i18n';
import { launcherName } from 'steamApps';
import { Game, ImportedEntry } from 'types';
import { backdrop } from 'backdrop';

// List of found games to confirm before importing (first install, "Scan now", new-games notice)
export default function ReviewDialog({ plan, onClose, onDone }: { plan: SyncPlan; onClose: () => void; onDone: (added: number) => void }) {
	const games = plan.newGames.filter((g) => g.kind !== 'app');
	const apps = plan.newGames.filter((g) => g.kind === 'app');
	const [chosen, setChosen] = useState<Set<string>>(new Set(games.filter((g) => g.kind === 'game').map((g) => g.id)));
	const [busy, setBusy] = useState(false);
	// The games to be removed, by name (the plan only has their ids)
	const [gone, setGone] = useState<Record<string, ImportedEntry>>({});
	useEffect(() => {
		loadState().then((s) => setGone(s.imported));
	}, []);
	const named = (g: { name: string; launcher: string } | undefined, id: string) => (g ? `${g.name} (${launcherName(g.launcher)})` : id);

	const toggle = (id: string) => {
		const next = new Set(chosen);
		next.has(id) ? next.delete(id) : next.add(id);
		setChosen(next);
	};
	const byLauncher = (list: Game[]) => {
		const groups: Record<string, Game[]> = {};
		list.forEach((g) => (groups[g.launcher] ??= []).push(g));
		return Object.entries(groups);
	};
	const row = (g: Game, note?: string) => (
		<label key={g.id} className={`ugi-check${chosen.has(g.id) ? '' : ' off'}`}>
			<input type="checkbox" checked={chosen.has(g.id)} onChange={() => toggle(g.id)} />
			<span>{g.name}</span>
			<small>{note ?? (plan.adopt[g.id] ? t('review.adopt') : g.kind === 'uncertain' ? t('review.uncertain') : '')}</small>
		</label>
	);

	const apply = async () => {
		setBusy(true);
		const result = await applySync(plan, chosen);
		setBusy(false);
		onDone(result.added);
	};


	return (
		<div className="ugi-overlay" {...backdrop(busy ? undefined : onClose)}>
			<div className="ugi-dialog ugi-review" onClick={(e) => e.stopPropagation()}>
				<h2>{plan.newGames.length ? t('review.title', { n: plan.newGames.length }) : plan.gone.length || plan.outdated.length ? t('review.nothingNewChanges') : t('review.nothingNew')}</h2>
				<p>{t('review.intro')}</p>
				{(plan.gone.length > 0 || plan.outdated.length > 0) && (
					<p className="ugi-muted">{t('review.changes', { gone: plan.gone.length, updated: plan.outdated.length })}</p>
				)}
				{plan.gone.length > 0 && <p className="ugi-muted">{t('review.goneList')}: {plan.gone.map((id) => named(gone[id], id)).join(', ')}</p>}
				{plan.outdated.length > 0 && <p className="ugi-muted">{t('review.updatedList')}: {plan.outdated.map((g) => named(g, g.id)).join(', ')}</p>}
				<div className="ugi-review-list">
					{byLauncher(games).map(([launcher, list]) => (
						<div key={launcher}>
							<h3>{launcherName(launcher)} · {list.length}</h3>
							{list.map((g) => row(g))}
						</div>
					))}
					{apps.length > 0 && (
						<details className="ugi-excl">
							<summary>{t('review.otherApps', { n: apps.length })}</summary>
							{apps.map((g) => row(g, launcherName(g.launcher)))}
						</details>
					)}
					{plan.previouslyExcluded.length > 0 && (
						<details className="ugi-excl">
							<summary>{t('review.excluded', { n: plan.previouslyExcluded.length })}</summary>
							<p className="ugi-muted">{t('review.excludedHint')}</p>
							{plan.previouslyExcluded.map((g) => row(g, launcherName(g.launcher)))}
						</details>
					)}
				</div>
				<div className="ugi-foot">
					<button className="ugi-link" disabled={busy} onClick={() => setChosen(new Set())}>{t('review.none')}</button>
					<span className="ugi-sp" />
					<button className="ugi-btn secondary" disabled={busy} onClick={onClose}>{t('review.later')}</button>
					<button className="ugi-btn primary" disabled={busy || (chosen.size === 0 && !plan.gone.length && !plan.outdated.length)} onClick={apply}>
						{busy ? t('review.importing') : chosen.size ? t('review.import', { n: chosen.size }) : t('review.apply')}
					</button>
				</div>
			</div>
		</div>
	);
}
