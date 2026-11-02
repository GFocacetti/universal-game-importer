import React, { useEffect, useState } from 'react';
import { Backup, listBackups, pickBackup, readBackup, restoreBackup } from 'maintenance';
import { epicAccountName, epicSignIn, loadState, saveState, unquote } from 'backend';
import { GuideSteps } from 'Guide';
import { t } from 'i18n';
import ReviewDialog from 'ReviewDialog';
import { runScan, ScanOutcome } from 'scanner';
import { LAUNCHER_NAMES } from 'steamApps';

type Step = 'welcome' | 'key' | 'keyWarning' | 'rawg' | 'xbl' | 'epic' | 'collections' | 'shelves' | 'scan' | 'review' | 'done' | 'restored';
const DOTS: Step[] = ['welcome', 'key', 'rawg', 'xbl', 'epic', 'collections', 'scan', 'done'];

export default function Onboarding({ onClose }: { onClose: () => void }) {
	const [step, setStep] = useState<Step>('welcome');
	const [key, setKey] = useState('');
	// The optional keys and the Epic account, each on its own page after SteamGridDB's
	const [rawgKey, setRawgKey] = useState('');
	const [xblKey, setXblKey] = useState('');
	const [epicName, setEpicName] = useState('');
	const [epicCode, setEpicCode] = useState('');
	const [epicBusy, setEpicBusy] = useState(false);
	const [epicFailed, setEpicFailed] = useState(false);
	const [collections, setCollections] = useState(true);
	const [shelves, setShelves] = useState(true);
	const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
	const [added, setAdded] = useState(0);
	const [error, setError] = useState('');
	// Someone who used UGI before can take everything back from a backup instead of setting it up
	const [latest, setLatest] = useState<Backup | null>(null);
	const [restoring, setRestoring] = useState('');
	const [restored, setRestored] = useState('');
	useEffect(() => {
		listBackups().then((list) => setLatest(list.files[0] ?? null)).catch(() => {});
		epicAccountName().then((n) => setEpicName(unquote(n))).catch(() => {});
	}, []);

	const restore = async (backup: Backup | null) => {
		if (!backup) return;
		setRestoring(t('maint.reading'));
		try {
			const content = await readBackup(backup.path);
			if (!content) {
				setRestoring('');
				setRestored(t('maint.notBackup'));
				return;
			}
			const out = await restoreBackup(content, (step) => setRestoring(t(`maint.step.${step}` as any)));
			setRestored(t('maint.restoreDone', { games: out.games, files: out.files }));
			setStep('restored');
		} catch (err) {
			console.error('[UGI] restore failed', err);
			setRestored(t('maint.error'));
		}
		setRestoring('');
	};

	const finish = async () => {
		const s = await loadState();
		s.onboarded = true;
		await saveState(s);
		onClose();
	};

	const startScan = async () => {
		setStep('scan');
		const s = await loadState();
		if (key.trim()) s.settings.sgdb_key = key.trim();
		if (rawgKey.trim()) s.settings.rawg_key = rawgKey.trim();
		if (xblKey.trim()) s.settings.xbl_key = xblKey.trim();
		s.settings.collections = collections;
		s.settings.shelves = collections && shelves;
		await saveState(s);
		try {
			setOutcome(await runScan());
			setStep('review');
		} catch (err) {
			setError(String(err));
		}
	};

	const epicSignInNow = async () => {
		setEpicBusy(true);
		setEpicFailed(false);
		const signed = unquote(await epicSignIn({ a_code: epicCode.trim() }).catch(() => ''));
		setEpicBusy(false);
		if (signed) {
			setEpicName(signed);
			setEpicCode('');
		} else setEpicFailed(true);
	};

	const dot = DOTS.indexOf(step === 'keyWarning' ? 'key' : step === 'shelves' ? 'collections' : step === 'review' ? 'scan' : step === 'restored' ? 'done' : step);

	if (step === 'review' && outcome) {
		return (
			<ReviewDialog
				plan={outcome.plan}
				onClose={() => setStep('done')}
				onDone={(n) => {
					setAdded(n);
					setStep('done');
				}}
			/>
		);
	}

	const choice = (value: boolean, set: (v: boolean) => void, yes: [string, string], no: [string, string]) => (
		<div className="ugi-choice">
			<div className={value ? 'sel' : ''} onClick={() => set(true)}><strong>{yes[0]}</strong>{yes[1]}</div>
			<div className={!value ? 'sel' : ''} onClick={() => set(false)}><strong>{no[0]}</strong>{no[1]}</div>
		</div>
	);

	return (
		<div className="ugi-overlay">
			<div className="ugi-dialog ugi-onboarding">
				<header className="ugi-ob-head">
					<div className="ugi-logo">UGI</div>
					<span className="ugi-muted">Universal Game Importer</span>
					<span className="ugi-sp" />
					<span className="ugi-dots">{DOTS.map((d, i) => <i key={d} className={i <= dot ? 'on' : ''} />)}</span>
					<button className="ugi-link" title={t('common.close')} onClick={finish}>✕</button>
				</header>

				{step === 'welcome' && (
					<>
						<h2>{t('ob.welcome')}</h2>
						<p>{t('ob.welcomeText')}</p>
						<p>{t('ob.supported')} {Object.values(LAUNCHER_NAMES).map((n) => <span key={n} className="ugi-tag">{n}</span>)}</p>
						<p>{t('ob.minute')}</p>
						<div className="ugi-foot"><button className="ugi-btn primary" disabled={!!restoring} onClick={() => setStep('key')}>{t('ob.start')}</button></div>
						<div className="ugi-card" style={{ marginTop: 18 }}>
							<strong>{t('ob.restoreTitle')}</strong>
							<p className="ugi-muted" style={{ margin: '4px 0 10px' }}>{t('ob.restoreText')}</p>
							{restoring ? (
								<div className="ugi-row-between"><span>{restoring}</span><div className="ugi-spinner" /></div>
							) : (
								<div className="ugi-row-between">
									{latest ? (
										<button className="ugi-btn secondary" onClick={() => restore(latest)}>{t('ob.restoreLatest', { name: latest.name })}</button>
									) : (
										<span className="ugi-muted">{t('ob.restoreNone')}</span>
									)}
									<span className="ugi-link" onClick={async () => restore(await pickBackup())}>{t('maint.pick')}</span>
								</div>
							)}
							{restored && <p style={{ margin: '10px 0 0' }}>{restored}</p>}
						</div>
					</>
				)}

				{step === 'restored' && (
					<>
						<h2>{t('ob.restoredTitle')}</h2>
						<p>{restored}</p>
						<div className="ugi-foot"><button className="ugi-btn primary" onClick={onClose}>{t('common.close')}</button></div>
					</>
				)}

				{(step === 'key' || step === 'keyWarning') && (
					<>
						<h2>{t('ob.images')}</h2>
						<p>{t('apikey.intro')}</p>
						<GuideSteps id="sgdb" />
						<div className="ugi-field"><input value={key} placeholder={t('apikey.placeholder')} onChange={(e) => setKey(e.target.value)} /></div>
						<div className="ugi-foot">
							<button className="ugi-link" onClick={() => setStep('keyWarning')}>{t('ob.skip')}</button>
							<span className="ugi-sp" />
							<button className="ugi-btn secondary" onClick={() => setStep('welcome')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" disabled={!key.trim()} onClick={() => setStep('rawg')}>{t('ob.next')}</button>
						</div>
						{step === 'keyWarning' && (
							<div className="ugi-warn-layer">
								<div className="ugi-warn-box">
									<h2>{t('ob.noKeyTitle')}</h2>
									<p>{t('ob.noKeyText')}</p>
									<p>{t('ob.noKeyLater')}</p>
									<div className="ugi-foot">
										<button className="ugi-btn secondary" onClick={() => setStep('key')}>{t('ob.back')}</button>
										<button className="ugi-btn primary" onClick={() => { setKey(''); setStep('rawg'); }}>{t('ob.noKeyContinue')}</button>
									</div>
								</div>
							</div>
						)}
					</>
				)}

				{step === 'rawg' && (
					<>
						<h2>{t('ob.rawg')}</h2>
						<p>{t('ob.rawgText')}</p>
						<p className="ugi-guide-note">{t('guide.optional')}</p>
						<GuideSteps id="rawg" />
						<div className="ugi-field"><input value={rawgKey} placeholder={t('apikey.placeholder')} onChange={(e) => setRawgKey(e.target.value)} /></div>
						<div className="ugi-foot">
							<button className="ugi-link" onClick={() => setStep('xbl')}>{t('ob.skip')}</button>
							<span className="ugi-sp" />
							<button className="ugi-btn secondary" onClick={() => setStep('key')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" onClick={() => setStep('xbl')}>{t('ob.next')}</button>
						</div>
					</>
				)}

				{step === 'xbl' && (
					<>
						<h2>{t('ob.xbl')}</h2>
						<p>{t('ob.xblText')}</p>
						<p className="ugi-guide-note">{t('guide.optional')}</p>
						<GuideSteps id="xbl" />
						<div className="ugi-field"><input value={xblKey} placeholder={t('apikey.placeholder')} onChange={(e) => setXblKey(e.target.value)} /></div>
						<div className="ugi-foot">
							<button className="ugi-link" onClick={() => setStep('epic')}>{t('ob.skip')}</button>
							<span className="ugi-sp" />
							<button className="ugi-btn secondary" onClick={() => setStep('rawg')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" onClick={() => setStep('epic')}>{t('ob.next')}</button>
						</div>
					</>
				)}

				{step === 'epic' && (
					<>
						<h2>{t('ob.epic')}</h2>
						<p>{t('ob.epicText')}</p>
						<p className="ugi-guide-note">{t('guide.optional')}</p>
						<GuideSteps id="epic" />
						<p className="ugi-guide-note">{t('guide.epicSafe')}</p>
						{epicName ? (
							<p>{t('settings.epicSignedIn', { name: epicName })}</p>
						) : (
							<div className="ugi-field">
								<input value={epicCode} placeholder={t('settings.epicCode')} onChange={(e) => setEpicCode(e.target.value)} />
								<button className="ugi-btn secondary" disabled={!epicCode.trim() || epicBusy} onClick={epicSignInNow}>{t('settings.epicConnect')}</button>
							</div>
						)}
						{epicFailed && <p className="ugi-launcher-warn">{t('settings.epicFailed')}</p>}
						<div className="ugi-foot">
							<button className="ugi-link" onClick={() => setStep('collections')}>{t('ob.skip')}</button>
							<span className="ugi-sp" />
							<button className="ugi-btn secondary" onClick={() => setStep('xbl')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" onClick={() => setStep('collections')}>{t('ob.next')}</button>
						</div>
					</>
				)}

				{step === 'collections' && (
					<>
						<h2>{t('ob.collections')}</h2>
						<p>{t('ob.collectionsText')}</p>
						{choice(collections, setCollections, [t('ob.collectionsYes'), t('ob.collectionsYesText')], [t('ob.no'), t('ob.collectionsNoText')])}
						<div className="ugi-foot">
							<button className="ugi-btn secondary" onClick={() => setStep('epic')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" onClick={() => (collections ? setStep('shelves') : startScan())}>{t('ob.next')}</button>
						</div>
					</>
				)}

				{step === 'shelves' && (
					<>
						<h2>{t('ob.shelves')}</h2>
						<p>{t('ob.shelvesText')}</p>
						{choice(shelves, setShelves, [t('ob.shelvesYes'), t('ob.shelvesYesText')], [t('ob.shelvesNo'), t('ob.shelvesNoText')])}
						<div className="ugi-foot">
							<button className="ugi-btn secondary" onClick={() => setStep('collections')}>{t('ob.back')}</button>
							<button className="ugi-btn primary" onClick={startScan}>{t('ob.next')}</button>
						</div>
					</>
				)}

				{step === 'scan' && (
					<>
						<h2>{t('ob.scanning')}</h2>
						<p>{error ? t('ob.scanError') : t('ob.scanningText')}</p>
						{!error && <div className="ugi-spinner" />}
						{error && <div className="ugi-foot"><button className="ugi-btn primary" onClick={startScan}>{t('ob.retry')}</button></div>}
					</>
				)}

				{step === 'done' && (
					<>
						<h2>{t('ob.done')}</h2>
						<p>{t('ob.doneText')}</p>
						<div className="ugi-summary">
							<div><strong>{added}</strong>{t('ob.summaryGames')}</div>
							<div><strong>{outcome?.launchers.filter((l) => l.count > 0).length ?? 0}</strong>{t('ob.summaryLaunchers')}</div>
							<div><strong>{collections ? outcome?.launchers.filter((l) => l.count > 0).length ?? 0 : 0}</strong>{t('ob.summaryCollections')}</div>
						</div>
						<p>{t('ob.doneWeekly')}</p>
						<div className="ugi-foot"><button className="ugi-btn primary" onClick={finish}>{t('ob.openLibrary')}</button></div>
					</>
				)}
			</div>
		</div>
	);
}

