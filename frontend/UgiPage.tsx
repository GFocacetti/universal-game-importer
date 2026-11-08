import { Focusable } from '@steambrew/client';
import React, { useEffect, useState } from 'react';
import { loadState, saveState } from 'backend';
import { relativeTime, t, textDir } from 'i18n';
import { themeStyle, UGI_CSS } from 'theme';
import { UgiState } from 'types';
import GamesSection from 'GamesSection';
import { ImagesSection, LaunchersSection, SettingsSection } from 'Sections';
import ReviewDialog from 'ReviewDialog';
import { runScan } from 'scanner';
import { addManualGame, SyncPlan } from 'importer';
import { callable } from '@steambrew/client';
import { windowsDialog } from 'backend';
import Onboarding from 'Onboarding';
import { takePendingReview } from 'pending';
import UninstallSection from 'UninstallSection';
import { openUrl } from 'steamApps';
import { bigPicture, gamepadDocument } from 'location';
import { watchGamepad } from 'gamepad';
import { backdrop } from 'backdrop';
import { GuideSteps } from 'Guide';

// Big Picture draws its top bar (search, clock) and its button hints over the page: keep the page, and the
// windows opened over it (--ugi-bars), between them
const BIG_PICTURE_BARS = { paddingTop: 40, paddingBottom: 40, boxSizing: 'border-box', '--ugi-bars': '40px' } as React.CSSProperties;

type Section = 'games' | 'launchers' | 'images' | 'settings' | 'uninstall';

const SECTIONS: { id: Section; label: () => string }[] = [
	{ id: 'games', label: () => t('nav.games') },
	{ id: 'launchers', label: () => t('nav.launchers') },
	{ id: 'images', label: () => t('nav.images') },
	{ id: 'settings', label: () => t('nav.settings') },
	{ id: 'uninstall', label: () => t('nav.uninstall') },
];

function ApiKeyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
	const [key, setKey] = useState('');
	const save = async () => {
		const state = await loadState();
		state.settings.sgdb_key = key.trim();
		await saveState(state);
		onSaved();
	};
	return (
		<div className="ugi-overlay" {...backdrop(onClose)}>
			<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
				<h2>{t('apikey.title')}</h2>
				<p>{t('apikey.intro')}</p>
				<GuideSteps id="sgdb" />
				<div className="ugi-field">
					<input value={key} placeholder={t('apikey.placeholder')} onChange={(e) => setKey(e.target.value)} />
				</div>
				<div className="ugi-foot">
					<button className="ugi-btn secondary" onClick={onClose}>{t('common.cancel')}</button>
					<button className="ugi-btn primary" disabled={!key.trim()} onClick={save}>{t('apikey.save')}</button>
				</div>
			</div>
		</div>
	);
}

const pickGame = callable<[], string>('ugi_pick_game');

// After picking a game's program: the name UGI guessed, to correct before adding it
function AddGameDialog({ picked, onClose, onAdded }: { picked: { path: string; name: string }; onClose: () => void; onAdded: () => void }) {
	const [name, setName] = useState(picked.name);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const add = async () => {
		setBusy(true);
		setFailed(false);
		try {
			await addManualGame(picked.path, name.trim());
			onAdded();
		} catch (err) {
			console.error('[UGI] add game failed', err);
			setFailed(true);
			setBusy(false);
		}
	};
	return (
		<div className="ugi-overlay" {...backdrop(onClose)}>
			<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
				<h2>{t('add.title')}</h2>
				<p>{t('add.text')}</p>
				<p className="ugi-muted"><code>{picked.path}</code></p>
				<div className="ugi-field">
					<input value={name} placeholder={t('add.name')} onChange={(e) => setName(e.target.value)} />
				</div>
				{failed && <p className="ugi-launcher-warn">{t('add.failed')}</p>}
				<div className="ugi-foot">
					<button className="ugi-btn secondary" onClick={onClose}>{t('common.cancel')}</button>
					<button className="ugi-btn primary" disabled={!name.trim() || busy} onClick={add}>{t('add.button')}</button>
				</div>
			</div>
		</div>
	);
}

export default function UgiPage() {
	const [state, setState] = useState<UgiState | null>(null);
	const [section, setSection] = useState<Section>('games');
	const [keyDialog, setKeyDialog] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [plan, setPlan] = useState<SyncPlan | null>(null);
	const [message, setMessage] = useState('');
	const [setup, setSetup] = useState(false);
	const [picked, setPicked] = useState<{ path: string; name: string } | null>(null);

	const addGame = async () => {
		try {
			const raw = await windowsDialog(pickGame, 'game');
			const game = raw ? JSON.parse(raw) : null;
			if (game?.path) setPicked({ path: String(game.path), name: String(game.name ?? '') });
		} catch (err) {
			console.error('[UGI] pick game failed', err);
		}
	};

	const reload = () => loadState().then(setState);
	useEffect(() => {
		// First install: the setup opens inside this page
		loadState().then((s) => {
			setState(s);
			if (!s.onboarded) setSetup(true);
		});
		// New games announced by the notice
		const pending = takePendingReview();
		if (pending) setPlan(pending);
		if (bigPicture()) watchGamepad(gamepadDocument());
	}, []);

	const scanNow = async () => {
		setScanning(true);
		setMessage('');
		try {
			const outcome = await runScan();
			setPlan(outcome.plan);
		} catch {
			setMessage(t('header.scanError'));
		}
		setScanning(false);
		reload();
	};

	const theme = state?.settings.theme ?? 'steam';
	const gameCount = state ? Object.keys(state.imported).length : 0;
	const launcherInfo = state?.last_launchers?.length
		? `${state.last_launchers.filter((l) => l.enabled !== false && l.installed !== false).length}/${state.last_launchers.length}`
		: '';

	const page = (
		<div className="ugi-root" dir={textDir()} style={{ ...(themeStyle(theme) as React.CSSProperties), ...(bigPicture() ? BIG_PICTURE_BARS : {}) }}>
			<style>{UGI_CSS}</style>
			<nav className="ugi-side">
				<div className="ugi-brand">
					<div className="ugi-logo">UGI</div>
					<span>Universal<br />Game Importer</span>
				</div>
				{SECTIONS.map((s) => (
					<div key={s.id} className={`ugi-nav${section === s.id ? ' on' : ''}`} onClick={() => setSection(s.id)}>
						<span>{s.label()}</span>
						{s.id === 'games' && <small>{gameCount}</small>}
						{s.id === 'launchers' && <small>{launcherInfo}</small>}
					</div>
				))}
			</nav>
			<section className="ugi-main">
				<div className="ugi-head">
					<h1>{SECTIONS.find((s) => s.id === section)?.label()}</h1>
					<span className="ugi-sp" />
					<span className="ugi-muted">{message || (state?.last_check ? t('header.lastCheck', { when: relativeTime(state.last_check) }) : t('header.never'))}</span>
					{section === 'games' && <button className="ugi-btn secondary" onClick={addGame}>{t('header.add')}</button>}
					<button className="ugi-btn primary" disabled={scanning} onClick={scanNow}>{scanning ? t('header.scanning') : t('header.scan')}</button>
				</div>
				{state && !state.settings.sgdb_key && (
					<div className="ugi-apibar" onClick={() => setKeyDialog(true)}>
						<b>⚠</b> {t('apikey.missing')}
						<span className="go">{t('apikey.add')}</span>
					</div>
				)}
				<div className="ugi-content">
					{state && section === 'games' && <GamesSection state={state} onChanged={reload} />}
					{state && section === 'launchers' && <LaunchersSection state={state} onChanged={reload} />}
					{state && section === 'images' && <ImagesSection state={state} onChanged={reload} />}
					{state && section === 'uninstall' && <UninstallSection onChanged={reload} />}
					{state && section === 'settings' && (
						<SettingsSection
							state={state}
							onChanged={reload}
							onRedoSetup={() => setSetup(true)}
						/>
					)}
				</div>
				{/* Credits: a fixed bar under every section */}
				<footer className="ugi-credit">
					Made with ❤️ by <span className="ugi-link" onClick={() => openUrl('https://github.com/GFocacetti/universal-game-importer')}>Ryu</span>
					{" · "}
					<span className="ugi-link" onClick={() => openUrl('https://ko-fi.com/T6U429QJ67')}>{t('footer.support')}</span>
				</footer>
			</section>
			{picked && (
				<AddGameDialog
					picked={picked}
					onClose={() => setPicked(null)}
					onAdded={() => {
						setPicked(null);
						reload();
					}}
				/>
			)}
			{keyDialog && (
				<ApiKeyDialog
					onClose={() => setKeyDialog(false)}
					onSaved={() => {
						setKeyDialog(false);
						reload();
					}}
				/>
			)}
			{setup && (
				<Onboarding
					onClose={() => {
						setSetup(false);
						reload();
					}}
				/>
			)}
			{plan && (
				<ReviewDialog
					plan={plan}
					onClose={() => setPlan(null)}
					onDone={() => {
						setPlan(null);
						reload();
					}}
				/>
			)}
		</div>
	);
	// In Big Picture the page holds Steam's gamepad focus, so the controller buttons reach it (see gamepad.ts)
	return bigPicture() ? (
		<Focusable onActivate={() => {}} noFocusRing style={{ height: '100%' }}>
			{page}
		</Focusable>
	) : (
		page
	);
}
