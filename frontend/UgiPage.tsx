import React, { useEffect, useState } from 'react';
import { loadState, saveState } from 'backend';
import { relativeTime, t } from 'i18n';
import { themeStyle, UGI_CSS } from 'theme';
import { UgiState } from 'types';
import GamesSection from 'GamesSection';
import { ImagesSection, LaunchersSection, SettingsSection } from 'Sections';
import ReviewDialog from 'ReviewDialog';
import { runScan } from 'scanner';
import { SyncPlan } from 'importer';
import Onboarding from 'Onboarding';
import { takePendingReview } from 'pending';

type Section = 'games' | 'launchers' | 'images' | 'settings';

const SECTIONS: { id: Section; label: () => string }[] = [
	{ id: 'games', label: () => t('nav.games') },
	{ id: 'launchers', label: () => t('nav.launchers') },
	{ id: 'images', label: () => t('nav.images') },
	{ id: 'settings', label: () => t('nav.settings') },
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
		<div className="ugi-overlay" onClick={onClose}>
			<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
				<h2>{t('apikey.title')}</h2>
				<p>{t('apikey.intro')}</p>
				<ol>
					<li>{t('apikey.step1')}</li>
					<li>{t('apikey.step2')}</li>
					<li>{t('apikey.step3')}</li>
					<li>{t('apikey.step4')}</li>
				</ol>
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

export default function UgiPage() {
	const [state, setState] = useState<UgiState | null>(null);
	const [section, setSection] = useState<Section>('games');
	const [keyDialog, setKeyDialog] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [plan, setPlan] = useState<SyncPlan | null>(null);
	const [message, setMessage] = useState('');
	const [setup, setSetup] = useState(false);

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

	return (
		<div className="ugi-root" style={themeStyle(theme) as React.CSSProperties}>
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
					{state && section === 'settings' && (
						<SettingsSection
							state={state}
							onChanged={reload}
							onRedoSetup={() => setSetup(true)}
						/>
					)}
				</div>
			</section>
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
}
