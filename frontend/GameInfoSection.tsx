// "About this game" section in the library page of imported games, under the play bar.
// Steam has no store page for non-Steam shortcuts: UGI adds its own block to the page.
import { findClassModule } from '@steambrew/client';
import React, { useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { loadState } from 'backend';
import { GameInfo, gameInfo, importedKeyFor } from 'gameInfo';
import { t } from 'i18n';
import { mainDocument } from 'overlay';

declare const MainWindowBrowserManager: { m_lastLocation?: { pathname?: string } } | undefined;

const SOURCE_NAMES: Record<GameInfo['source'], string> = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games Store', rawg: 'RAWG' };

const CSS = `
.ugi-info { margin: 16px 2.8vw 0; padding: 16px 20px; background: rgba(0,0,0,.2); border-radius: 3px; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px; line-height: 1.5; }
.ugi-info h2 { margin: 0 0 10px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #ffffff; }
.ugi-info-cols { display: flex; gap: 28px; }
.ugi-info-text { flex: 1; min-width: 0; }
.ugi-info-text p { margin: 0 0 10px; white-space: pre-line; }
.ugi-info-side { width: 240px; flex: none; font-size: 13px; }
.ugi-info-side div { margin-bottom: 8px; }
.ugi-info-side span { display: block; color: #8f98a0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.ugi-info-more { background: none; border: 0; padding: 0; color: #1a9fff; font: inherit; font-size: 13px; cursor: pointer; }
.ugi-info-shots { display: flex; gap: 8px; overflow-x: auto; margin-top: 12px; padding-bottom: 4px; }
.ugi-info-shots img { height: 110px; border-radius: 2px; cursor: pointer; flex: none; }
.ugi-info-big { margin-top: 10px; }
.ugi-info-big img { max-width: 100%; border-radius: 2px; cursor: pointer; }
.ugi-info-source { margin-top: 10px; color: #8f98a0; font-size: 12px; }
.ugi-info-source a { color: #8f98a0; text-decoration: underline; cursor: pointer; }
.ugi-info-muted { color: #8f98a0; }
`;

function openUrl(url: string) {
	(SteamClient as any).System?.OpenInSystemBrowser?.(url);
}

function InfoBlock({ appid }: { appid: number }) {
	const [info, setInfo] = useState<GameInfo | null | undefined>(undefined);
	const [more, setMore] = useState(false);
	const [shot, setShot] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setInfo(undefined);
		setMore(false);
		setShot(null);
		(async () => {
			const state = await loadState();
			const key = importedKeyFor(state, appid);
			const found = key ? await gameInfo(state, key) : null;
			if (alive) setInfo(found);
		})().catch(() => alive && setInfo(null));
		return () => {
			alive = false;
		};
	}, [appid]);

	// Nothing to show: no block at all
	if (info === null) return null;
	if (info === undefined) {
		return (
			<div className="ugi-info">
				<h2>{t('info.title')}</h2>
				<span className="ugi-info-muted">{t('info.loading')}</span>
			</div>
		);
	}

	const paragraphs = (more ? info.description : info.summary).split('\n\n').filter(Boolean);
	const side: [string, string | undefined][] = [
		[t('info.developer'), info.developers.join(', ')],
		[t('info.publisher'), info.publishers.join(', ')],
		[t('info.genres'), info.genres.join(', ')],
		[t('info.released'), info.released],
	];

	return (
		<div className="ugi-info">
			<h2>{t('info.title')}</h2>
			<div className="ugi-info-cols">
				<div className="ugi-info-text">
					{paragraphs.map((p, i) => <p key={i}>{p}</p>)}
					{info.description !== info.summary && (
						<button className="ugi-info-more" onClick={() => setMore(!more)}>{more ? t('info.less') : t('info.more')}</button>
					)}
				</div>
				<div className="ugi-info-side">
					{side.filter(([, v]) => v).map(([label, value]) => (
						<div key={label}><span>{label}</span>{value}</div>
					))}
				</div>
			</div>
			{info.screenshots.length > 0 && (
				<div className="ugi-info-shots">
					{info.screenshots.slice(0, 8).map((src) => <img key={src} src={src} onClick={() => setShot(shot === src ? null : src)} />)}
				</div>
			)}
			{shot && <div className="ugi-info-big"><img src={shot} onClick={() => setShot(null)} /></div>}
			<div className="ugi-info-source">
				{t('info.source')} <a onClick={() => openUrl(info.url)}>{SOURCE_NAMES[info.source]}</a>
			</div>
		</div>
	);
}

// ---------- Placing the block in Steam's page ----------

type Mounted = { host: HTMLElement; root: Root; appid: number };
let mounted: Mounted | null = null;
let importedAppids = new Set<number>();
let lastStateLoad = 0;

function unmount() {
	if (!mounted) return;
	try {
		mounted.root.unmount();
	} catch {}
	mounted.host.remove();
	mounted = null;
}

function playBar(doc: Document): HTMLElement | null {
	const classes = findClassModule((m: any) => m.HeaderLoaded && m.PlayBar) as any;
	return classes?.PlayBar ? doc.querySelector<HTMLElement>(`.${classes.PlayBar}`) : null;
}

async function refreshImported() {
	// The list changes only on imports: reloaded at most every 10 seconds
	if (Date.now() - lastStateLoad < 10000) return;
	lastStateLoad = Date.now();
	const state = await loadState();
	importedAppids = new Set(Object.values(state.imported).map((e) => e.appid));
}

async function tick() {
	const path = MainWindowBrowserManager?.m_lastLocation?.pathname ?? '';
	const appid = Number(path.match(/^\/library\/app\/(\d+)/)?.[1] ?? 0);
	if (!appid) return unmount();
	await refreshImported();
	if (!importedAppids.has(appid)) return unmount();

	const doc = mainDocument();
	const bar = doc && playBar(doc);
	if (!doc || !bar) return unmount();
	// Already in place for this game
	if (mounted && mounted.appid === appid && mounted.host.isConnected && mounted.host.previousElementSibling === bar) return;

	unmount();
	const host = doc.createElement('div');
	bar.insertAdjacentElement('afterend', host);
	const root = createRoot(host);
	root.render(
		<>
			<style>{CSS}</style>
			<InfoBlock appid={appid} />
		</>,
	);
	mounted = { host, root, appid };
}

export function startGameInfo() {
	let busy = false;
	setInterval(() => {
		if (busy) return;
		busy = true;
		tick()
			.catch((err) => console.error('[UGI] game info', err))
			.finally(() => (busy = false));
	}, 1000);
}
