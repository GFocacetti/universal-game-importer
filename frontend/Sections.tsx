import { callable } from '@steambrew/client';
import React, { useEffect, useState } from 'react';
import { loadState, saveState, unquote } from 'backend';
import { removeCollections, removeLauncherCollection, syncCollections } from 'collections';
import { LanguageChoice, setLanguage, t } from 'i18n';
import { checkMissing, fillMissing, ImageType, replaceAll, resetImages, StopFlag } from 'sgdb';
import { isGameOrShortcut, LAUNCHER_NAMES, openUrl } from 'steamApps';
import { CancelFlag, exportBackup } from 'maintenance';
import { UgiState } from 'types';
import { backdrop } from 'backdrop';

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string } | undefined };
declare const collectionStore: {
	allAppsCollection: { allApps: { appid: number }[] };
	userCollections: { id: string; displayName: string; allApps: { appid: number }[] }[];
};

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	return <span className={`ugi-switch${on ? ' on' : ''}${disabled ? ' disabled' : ''}`} onClick={() => !disabled && onChange(!on)}><span className="ugi-tog" /></span>;
}

async function update(change: (s: UgiState) => void | Promise<void>, onChanged: () => void) {
	const s = await loadState();
	await change(s);
	await saveState(s);
	onChanged();
}

// ---------- Launchers ----------

export function LaunchersSection({ state, onChanged }: { state: UgiState; onChanged: () => void }) {
	const launchers = state.last_launchers ?? [];
	const [paths, setPaths] = useState<Record<string, string>>({});
	if (!launchers.length) return <p className="ugi-muted">{t('launchers.empty')}</p>;

	const setEnabled = (id: string, on: boolean) =>
		update((s) => {
			s.settings.launchers = { ...(s.settings.launchers ?? {}), [id]: { ...(s.settings.launchers?.[id] ?? {}), enabled: on } };
		}, onChanged);
	const savePath = (id: string) =>
		update((s) => {
			s.settings.launchers = { ...(s.settings.launchers ?? {}), [id]: { ...(s.settings.launchers?.[id] ?? {}), path: (paths[id] ?? '').trim() } };
		}, onChanged);
	const setCollection = (id: string, what: 'collection' | 'shelf', on: boolean) =>
		update(async (s) => {
			const info = (s.collections[id] ??= {});
			if (on) {
				if (what === 'collection') {
					s.settings.collections = true;
					delete info.off_collection;
				} else {
					s.settings.collections = true;
					s.settings.shelves = true;
					delete info.off_collection;
					delete info.off_shelf;
				}
				await syncCollections(s);
			} else {
				await removeLauncherCollection(s, id, what);
			}
		}, onChanged);

	return (
		<>
			<div className="ugi-card ugi-launcher-help">
				<div><b>{t('launchers.helpSwitchTitle')}</b> {t('launchers.helpSwitch')} <span className="ugi-launcher-warn">⚠ {t('launchers.helpSwitchWarn')}</span></div>
				<div><b>{t('launchers.collection')}</b> {t('launchers.helpCollection')}</div>
				<div><b>{t('launchers.shelf')}</b> {t('launchers.helpShelf')}</div>
				<div><b>{t('launchers.path')}</b> {t('launchers.helpPath')}</div>
			</div>
			{launchers.map((l) => {
				const cfg = state.settings.launchers?.[l.id] ?? {};
				const info = state.collections[l.id] ?? {};
				const hasCollection = state.settings.collections && !info.off_collection;
				const hasShelf = hasCollection && state.settings.shelves && !info.off_shelf;
				// Found by the last scan (apps included, for Xbox) and actually imported
				const imported = Object.values(state.imported).filter((e) => e.launcher === l.id).length;
				const meta = l.error
					? t('launchers.error')
					: !l.installed
						? t('launchers.notFound')
						: [
								t('launchers.installed'),
								l.count === 1 ? t('launchers.foundOne') : t('launchers.found', { n: l.count }),
								...(imported ? [imported === 1 ? t('launchers.importedOne') : t('launchers.imported', { n: imported })] : []),
							].join(' · ');
				return (
					<div key={l.id} className="ugi-card ugi-lrow">
						<div>
							<h3>{LAUNCHER_NAMES[l.id] ?? l.name}</h3>
							<div className="ugi-muted">{cfg.enabled === false ? t('launchers.disabled') : meta}</div>
							{cfg.enabled === false && imported > 0 && (
								<div className="ugi-launcher-warn">
									⚠ {imported === 1 ? t('launchers.offWarningOne') : t('launchers.offWarning', { n: imported })}
								</div>
							)}
						</div>
						<Toggle on={cfg.enabled !== false} onChange={(v) => setEnabled(l.id, v)} />
						<div className="ugi-opts">
							<label><input type="checkbox" checked={hasCollection} onChange={(e) => setCollection(l.id, 'collection', e.target.checked)} /> {t('launchers.collection')}</label>
							<label><input type="checkbox" checked={hasShelf} onChange={(e) => setCollection(l.id, 'shelf', e.target.checked)} /> {t('launchers.shelf')}</label>
							{l.supports_path && (
								<label>
									{t('launchers.path')}
									<input
										type="text"
										placeholder={t('launchers.pathAuto')}
										value={paths[l.id] ?? cfg.path ?? ''}
										onChange={(e) => setPaths({ ...paths, [l.id]: e.target.value })}
										onBlur={() => paths[l.id] !== undefined && savePath(l.id)}
									/>
								</label>
							)}
						</div>
					</div>
				);
			})}
			<p className="ugi-muted">{t('launchers.hint')}</p>
		</>
	);
}

// ---------- Images ----------

export function ImagesSection({ state, onChanged }: { state: UgiState; onChanged: () => void }) {
	const [scope, setScope] = useState('all');
	const [flag, setFlag] = useState<StopFlag | null>(null);
	// The running operation: what it does, where it is, what it changed so far
	const [progress, setProgress] = useState<{ label: string; text: string; done: number; total: number; current?: string; applied?: number; games?: number } | null>(null);
	const [result, setResult] = useState('');
	// "Replace all" and "Restore" overwrite the current pictures: confirmed first, with a backup offered
	const [ask, setAsk] = useState<{ title: string; go: () => void } | null>(null);
	const [backup, setBackup] = useState<CancelFlag | null>(null);

	// Games and demos: tools Steam keeps in the library (dedicated servers, SDKs, benchmarks) are left out
	const appids = (): number[] => {
		if (scope === 'imported') return Object.values(state.imported).map((e) => e.appid);
		const apps = scope.startsWith('coll:')
			? collectionStore.userCollections.find((c) => c.id === scope.slice(5))?.allApps ?? []
			: collectionStore.allAppsCollection.allApps;
		return apps.map((a) => a.appid).filter((appid) => isGameOrShortcut(appid));
	};

	const run = async (label: string, text: string, job: (ids: number[], p: (d: number, tt: number, applied?: number, games?: number) => void, f: StopFlag, s: UgiState) => Promise<string>) => {
		const f: StopFlag = { stop: false };
		setFlag(f);
		setResult('');
		const s = await loadState();
		const ids = appids();
		try {
			const outcome = await job(
				ids,
				(done, total, applied, games) => setProgress({ label, text, done, total, applied, games, current: ids[done] ? appStore.GetAppOverviewByAppID(ids[done]!)?.display_name : undefined }),
				f,
				s,
			);
			await saveState(s);
			setResult(f.stop ? t('images.stopped', { result: outcome }) : outcome);
		} catch (err) {
			setResult(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error'));
		}
		setFlag(null);
		setProgress(null);
		onChanged();
	};

	const backupThen = async (go: () => void) => {
		const f: CancelFlag = { cancel: false };
		setBackup(f);
		setResult('');
		try {
			const out = await exportBackup(f);
			setBackup(null);
			if (out.path) go();
			else setResult(out.cancelled ? t('images.backupCancelled') : t('maint.error'));
		} catch (err) {
			console.error('[UGI] backup before images failed', err);
			setBackup(null);
			setResult(t('maint.error'));
		}
	};

	const names: Record<ImageType, string> = { 0: t('image.grid'), 1: t('image.hero'), 2: t('image.logo'), 3: t('image.wide'), 4: t('image.icon') };
	const noKey = !state.settings.sgdb_key;

	return (
		<>
			<div className="ugi-toolbar">
				<span className="ugi-muted">{t('images.scope')}</span>
				<select className="ugi-select" value={scope} disabled={!!flag} onChange={(e) => setScope(e.target.value)}>
					<option value="all">{t('images.scopeAll')}</option>
					<option value="imported">{t('images.scopeImported')}</option>
					{collectionStore.userCollections.map((c) => <option key={c.id} value={`coll:${c.id}`}>{t('images.scopeCollection', { name: c.displayName })}</option>)}
				</select>
			</div>
			{backup && (
				<div className="ugi-card">
					<div className="ugi-row-between">
						<strong>{t('maint.backupBusy')}</strong>
						<span className="ugi-row-between" style={{ gap: 12 }}>
							<button className="ugi-btn secondary" onClick={() => (backup.cancel = true)}>{t('maint.stop')}</button>
							<div className="ugi-spinner" />
						</span>
					</div>
				</div>
			)}
			{ask && (
				<div className="ugi-overlay" {...backdrop(() => setAsk(null))}>
					<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
						<h2>{ask.title}</h2>
						<p>{t('images.confirmText', { n: appids().length })}</p>
						<div className="ugi-foot">
							<button className="ugi-btn secondary" onClick={() => setAsk(null)}>{t('common.cancel')}</button>
							<button className="ugi-btn secondary" onClick={() => { const go = ask.go; setAsk(null); go(); }}>{t('images.withoutBackup')}</button>
							<button className="ugi-btn primary" onClick={() => { const go = ask.go; setAsk(null); backupThen(go); }}>{t('images.backupFirst')}</button>
						</div>
					</div>
				</div>
			)}
			{progress && (
				<div className="ugi-card">
					<div className="ugi-row-between">
						<strong>{progress.label}</strong>
						<button className="ugi-btn secondary" onClick={() => flag && (flag.stop = true)}>{t('images.stop')}</button>
					</div>
					<p className="ugi-muted" style={{ margin: '4px 0 8px' }}>{progress.text}</p>
					<div className="ugi-progress"><b style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
					<div className="ugi-row-between ugi-muted">
						<span>
							{t('images.progress', { done: progress.done, total: progress.total })}
							{progress.current && <> · {t('images.current', { name: progress.current })}</>}
						</span>
						{progress.applied !== undefined && <span>{t('images.sofar', { n: progress.applied, games: progress.games ?? 0 })}</span>}
					</div>
				</div>
			)}
			{result && <div className="ugi-card">{result}</div>}
			<div className="ugi-tools">
				<div className="ugi-card">
					<h3>{t('images.check')}</h3>
					<p>{t('images.checkText')}</p>
					<button className="ugi-btn secondary" disabled={!!flag} onClick={() => run(t('images.check'), t('images.checkRunning'), async (ids) => {
						const counts = await checkMissing(ids);
						return t('images.checkResult', { n: ids.length }) + ' ' + (Object.keys(counts) as unknown as ImageType[]).map((ty) => `${names[ty]} ${counts[ty]}`).join(' · ');
					})}>{t('images.checkButton')}</button>
				</div>
				<div className="ugi-card">
					<h3>{t('images.fill')}</h3>
					<p>{t('images.fillText')}</p>
					<button className="ugi-btn primary" disabled={!!flag || noKey} onClick={() => run(t('images.fill'), t('images.fillRunning'), async (ids, p, f, s) => t('images.applied', { n: await fillMissing(s, ids, p, f) }))}>{t('images.fillButton')}</button>
				</div>
				<div className="ugi-card">
					<h3>{t('images.replace')}</h3>
					<p>{t('images.replaceText')}</p>
					<button className="ugi-btn secondary" disabled={!!flag || !!backup || noKey} onClick={() => setAsk({
						title: t('images.replace'),
						go: () => run(t('images.replace'), t('images.replaceRunning'), async (ids, p, f, s) => t('images.applied', { n: await replaceAll(s, ids, [0, 1, 2, 3, 4], p, f) })),
					})}>{t('images.replaceButton')}</button>
				</div>
				<div className="ugi-card">
					<h3>{t('images.reset')}</h3>
					<p>{t('images.resetText')}</p>
					<button className="ugi-btn secondary" disabled={!!flag || !!backup} onClick={() => setAsk({
						title: t('images.reset'),
						go: () => run(t('images.reset'), t('images.resetRunning'), async (ids, p, f) => {
							await resetImages(ids, p, f);
							return t('images.resetDone');
						}),
					})}>{t('images.resetButton')}</button>
				</div>
			</div>
		</>
	);
}

// ---------- Settings ----------

// The site where a key is made, after the setting's explanation
const SiteLink = ({ url }: { url: string }) => (
	<>
		{' '}
		<button className="ugi-link" onClick={() => openUrl(url)}>{url.replace(/^https:\/\/(www\.)?/, '')}</button>
	</>
);

const epicAccountName = callable<[], string>('ugi_epic_account');
const epicSignIn = callable<[{ a_code: string }], string>('ugi_epic_sign_in');
const epicSignOut = callable<[], boolean>('ugi_epic_sign_out');
// Epic's sign-in page: once signed in, it shows the code to paste in UGI
const EPIC_LOGIN = 'https://www.epicgames.com/id/login?redirectUrl=' +
	encodeURIComponent('https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code');

// Epic account for achievements: sign in on Epic's page, then paste the code it shows
function EpicAccount() {
	const [name, setName] = useState<string | null>(null);
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		epicAccountName().then((n) => setName(unquote(n)));
	}, []);
	const signIn = async () => {
		setBusy(true);
		setFailed(false);
		const signed = unquote(await epicSignIn({ a_code: code }));
		setBusy(false);
		if (signed) {
			setName(signed);
			setCode('');
		} else setFailed(true);
	};
	return (
		<div className="ugi-set">
			<div>
				<strong>{t('settings.epic')}</strong>
				<small>
					{name ? t('settings.epicSignedIn', { name }) : t('settings.epicText')}
					{!name && (
						<>
							{' '}
							<button className="ugi-link" onClick={() => openUrl(EPIC_LOGIN)}>{t('settings.epicOpen')}</button>
						</>
					)}
				</small>
				{failed && <small className="ugi-launcher-warn">{t('settings.epicFailed')}</small>}
			</div>
			{name ? (
				<button className="ugi-btn secondary" onClick={() => epicSignOut().then(() => setName(''))}>{t('settings.epicSignOut')}</button>
			) : (
				<div className="ugi-field">
					<input type="text" value={code} placeholder={t('settings.epicCode')} onChange={(e) => setCode(e.target.value)} />
					<button className="ugi-btn secondary" disabled={!code.trim() || busy} onClick={signIn}>{t('settings.epicConnect')}</button>
				</div>
			)}
		</div>
	);
}

export function SettingsSection({ state, onChanged, onRedoSetup }: { state: UgiState; onChanged: () => void; onRedoSetup: () => void }) {
	const [key, setKey] = useState<string | null>(null);
	const [rawgKey, setRawgKey] = useState<string | null>(null);
	const [xblKey, setXblKey] = useState<string | null>(null);
	const set = (patch: Partial<UgiState['settings']>) => update((s) => void Object.assign(s.settings, patch), onChanged);

	return (
		<div className="ugi-settings">
			<div className="ugi-set">
				<div><strong>{t('settings.interval')}</strong><small>{t('settings.intervalText')}</small></div>
				<select className="ugi-select" value={state.settings.check_interval ?? 'weekly'} onChange={(e) => set({ check_interval: e.target.value as any })}>
					<option value="off">{t('settings.intervalOff')}</option>
					<option value="daily">{t('settings.intervalDaily')}</option>
					<option value="weekly">{t('settings.intervalWeekly')}</option>
					<option value="monthly">{t('settings.intervalMonthly')}</option>
				</select>
			</div>
			<div className="ugi-set">
				<div><strong>{t('apikey.title')}</strong><small>{t('settings.keyText')}<SiteLink url="https://www.steamgriddb.com/profile/preferences/api" /></small></div>
				<div className="ugi-field">
					<input type="password" value={key ?? state.settings.sgdb_key ?? ''} placeholder={t('apikey.placeholder')} onChange={(e) => setKey(e.target.value)} />
					<button className="ugi-btn secondary" disabled={key === null} onClick={() => set({ sgdb_key: (key ?? '').trim() }).then(() => setKey(null))}>{t('settings.save')}</button>
				</div>
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.rawg')}</strong><small>{t('settings.rawgText')}<SiteLink url="https://rawg.io/apidocs" /></small></div>
				<div className="ugi-field">
					<input type="password" value={rawgKey ?? state.settings.rawg_key ?? ''} placeholder={t('apikey.placeholder')} onChange={(e) => setRawgKey(e.target.value)} />
					<button className="ugi-btn secondary" disabled={rawgKey === null} onClick={() => set({ rawg_key: (rawgKey ?? '').trim() }).then(() => setRawgKey(null))}>{t('settings.save')}</button>
				</div>
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.xbl')}</strong><small>{t('settings.xblText')}<SiteLink url="https://xbl.io" /></small></div>
				<div className="ugi-field">
					<input type="password" value={xblKey ?? state.settings.xbl_key ?? ''} placeholder={t('apikey.placeholder')} onChange={(e) => setXblKey(e.target.value)} />
					<button className="ugi-btn secondary" disabled={xblKey === null} onClick={() => set({ xbl_key: (xblKey ?? '').trim() }).then(() => setXblKey(null))}>{t('settings.save')}</button>
				</div>
			</div>
			<EpicAccount />
			<div className="ugi-set">
				<div><strong>{t('settings.achToasts')}</strong><small>{t('settings.achToastsText')}</small></div>
				<Toggle on={state.settings.achievement_toasts !== false} onChange={(v) => set({ achievement_toasts: v })} />
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.animated')}</strong><small>{t('settings.animatedText')}</small></div>
				<Toggle on={!!state.settings.animated} onChange={(v) => set({ animated: v })} />
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.webp')}</strong><small>{t('settings.webpText')}</small></div>
				<Toggle on={state.settings.webp !== false} onChange={(v) => set({ webp: v })} />
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.collections')}</strong><small>{t('settings.collectionsText')}</small></div>
				<Toggle on={state.settings.collections} onChange={(v) => update(async (s) => {
					s.settings.collections = v;
					if (v) Object.values(s.collections).forEach((i) => delete i.off_collection);
					if (v) await syncCollections(s);
					else await removeCollections(s);
				}, onChanged)} />
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.shelves')}</strong><small>{t('settings.shelvesText')}</small></div>
				<Toggle on={state.settings.collections && state.settings.shelves} disabled={!state.settings.collections} onChange={(v) => update(async (s) => {
					s.settings.shelves = v;
					Object.keys(s.collections).forEach((id) => {
						const info = s.collections[id]!;
						if (v) delete info.off_shelf;
					});
					if (v) await syncCollections(s);
					else for (const id of Object.keys(s.collections)) await removeLauncherCollection(s, id, 'shelf');
				}, onChanged)} />
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.language')}</strong><small>{t('settings.languageText')}</small></div>
				<select
					className="ugi-select"
					value={state.settings.language ?? 'auto'}
					onChange={(e) => {
						const language = e.target.value as LanguageChoice;
						setLanguage(language);
						set({ language });
					}}
				>
					<option value="auto">{t('settings.languageAuto')}</option>
					<option value="en">English</option>
					<option value="it">Italiano</option>
				</select>
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.theme')}</strong><small>{t('settings.themeText')}</small></div>
				<select className="ugi-select" value={state.settings.theme ?? 'steam'} onChange={(e) => set({ theme: e.target.value as any })}>
					<option value="steam">{t('settings.themeSteam')}</option>
					<option value="modern">{t('settings.themeModern')}</option>
				</select>
			</div>
			<div className="ugi-set">
				<div><strong>{t('settings.setup')}</strong><small>{t('settings.setupText')}</small></div>
				<button className="ugi-btn secondary" onClick={onRedoSetup}>{t('settings.setupButton')}</button>
			</div>
		</div>
	);
}
