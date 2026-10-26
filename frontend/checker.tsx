import React, { useEffect } from 'react';
import { loadState, saveState } from 'backend';
import { syncCollections } from 'collections';
import { t } from 'i18n';
import { applySync, SyncPlan } from 'importer';
import { mountOverlay, waitForMainDocument } from 'overlay';
import { Navigation } from '@steambrew/client';
import { UGI_ROUTE } from 'menu';
import { setPendingReview } from 'pending';
import { libraryVisible, waitForLibrary } from 'location';
import { runScan } from 'scanner';
import { LAUNCHER_NAMES } from 'steamApps';

const INTERVAL_MS = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5 } as const;
// Wait a little after Steam starts, so the check doesn't slow down loading
const STARTUP_DELAY_MS = 2 * 60 * 1000;
const TOAST_MS = 12000;

function Toast({ plan, onOpen, onClose }: { plan: SyncPlan; onOpen: () => void; onClose: () => void }) {
	useEffect(() => {
		const timer = setTimeout(onClose, TOAST_MS);
		// Leaving the library would hide it while it still catches clicks in its corner
		const watch = setInterval(() => {
			if (!libraryVisible()) onClose();
		}, 1000);
		return () => {
			clearTimeout(timer);
			clearInterval(watch);
		};
	}, []);
	const counts: Record<string, number> = {};
	plan.newGames.filter((g) => g.kind !== 'app').forEach((g) => (counts[g.launcher] = (counts[g.launcher] ?? 0) + 1));
	const detail = Object.entries(counts).map(([l, n]) => `${LAUNCHER_NAMES[l] ?? l} (${n})`).join(', ');
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	return (
		<div className="ugi-toast" onClick={onOpen}>
			<div className="ugi-toast-icon">UGI</div>
			<div className="ugi-toast-text">
				<strong>{t('toast.title', { n: total })}</strong>
				<span>{detail} · {t('toast.hint')}</span>
			</div>
		</div>
	);
}

// Opens the review list for the new games inside the UGI page
export function showReview(plan: SyncPlan) {
	setPendingReview(plan);
	Navigation.Navigate(UGI_ROUTE);
}

// Periodic check: runs a while after startup when due. Uninstalled or changed games are handled
// right away; new games are only announced (imported after the user confirms).
export async function startPeriodicCheck() {
	await new Promise((r) => setTimeout(r, STARTUP_DELAY_MS));
	// Puts back in their collections the games Steam left out (e.g. a game added again right after
	// removing it). Not earlier: reading Steam's collections while it is still loading breaks its library.
	try {
		const current = await loadState();
		if (current.onboarded && current.settings.collections) {
			await syncCollections(current);
			await saveState(current);
		}
	} catch (err) {
		console.error('[UGI] collection sync failed', err);
	}
	const state = await loadState();
	const interval = state.settings.check_interval ?? 'weekly';
	if (!state.onboarded || interval === 'off') return;
	const last = state.last_check ? Date.parse(state.last_check) : 0;
	if (Date.now() - last < INTERVAL_MS[interval]) return;

	const { plan } = await runScan();
	if (plan.gone.length || plan.outdated.length) {
		await applySync({ ...plan, newGames: [], previouslyExcluded: [] }, new Set());
	}
	if (!plan.newGames.some((g) => g.kind !== 'app')) return;
	await waitForLibrary();
	const doc = await waitForMainDocument();
	if (!doc) return;
	mountOverlay(
		doc,
		(close) => (
			<Toast
				plan={plan}
				onClose={close}
				onOpen={() => {
					close();
					showReview({ ...plan, gone: [], outdated: [] });
				}}
			/>
		),
		undefined,
		'toast',
	);
}
