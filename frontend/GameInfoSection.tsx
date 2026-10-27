// "About this game" section in the library page of imported games. Steam shows a dashed box there
// ("some detailed information is not available for non-Steam shortcuts"): UGI's block takes its place.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { loadState } from 'backend';
import { GameInfo, gameInfo, importedKeyFor, Screenshot } from 'gameInfo';
import { t } from 'i18n';
import { mainDocument } from 'overlay';

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string } | undefined };
declare const MainWindowBrowserManager: { m_lastLocation?: { pathname?: string } } | undefined;

const SOURCE_NAMES: Record<GameInfo['source'], string> = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games Store', rawg: 'RAWG' };

const CSS = `
.ugi-info { overflow-wrap: anywhere; margin: 0 0 16px; padding: 16px 20px; background: rgba(0,0,0,.2); border-radius: 3px; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px; line-height: 1.5; }
.ugi-info h2 { margin: 0 0 10px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #ffffff; }
.ugi-info-text p { margin: 0 0 10px; white-space: pre-line; text-align: justify; }
.ugi-info-text h3 { margin: 16px 0 6px; font-size: 14px; font-weight: 700; color: #ffffff; }
.ugi-info-side { overflow-wrap: anywhere; margin: 0 0 16px; padding: 14px 16px 6px; background: rgba(0,0,0,.2); border-radius: 3px; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 13px; line-height: 1.4; }
.ugi-info-side div { margin-bottom: 10px; }
.ugi-info-side a { color: #dcdedf; cursor: pointer; }
.ugi-info-side a:hover { color: #1a9fff; }
.ugi-info-side span { display: block; color: #8f98a0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.ugi-info-source { margin-top: 10px; color: #8f98a0; font-size: 12px; }
.ugi-info-source a { color: #8f98a0; text-decoration: underline; cursor: pointer; }
.ugi-info-muted { color: #8f98a0; }
.ugi-player { margin-bottom: 16px; }
.ugi-player-main { position: relative; aspect-ratio: 16 / 9; background: #000; cursor: zoom-in; }
.ugi-player-main img { width: 100%; height: 100%; object-fit: contain; display: block; }
.ugi-player-strip { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.ugi-player-thumbs { flex: 1; min-width: 0; display: flex; gap: 4px; overflow: hidden; scroll-behavior: smooth; }
.ugi-player-thumbs img { width: 116px; height: 65px; object-fit: cover; flex: none; cursor: pointer; opacity: .6; border: 2px solid transparent; box-sizing: border-box; }
.ugi-player-thumbs img:hover { opacity: .9; }
.ugi-player-thumbs img.on { opacity: 1; border-color: #ffffff; }
.ugi-player-arrow { flex: none; width: 28px; height: 65px; border: 0; padding: 0; background: rgba(255,255,255,.08); color: #ffffff; cursor: pointer; display: grid; place-items: center; }
.ugi-player-arrow:hover { background: rgba(255,255,255,.2); }
.ugi-player-arrow svg { width: 14px; height: 14px; }
.ugi-full { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.92); display: flex; align-items: center; justify-content: center; font-family: "Motiva Sans", Arial, sans-serif; }
.ugi-full img { max-width: calc(100vw - 160px); max-height: calc(100vh - 100px); object-fit: contain; }
.ugi-full-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 56px; height: 96px; border: 0; background: rgba(255,255,255,.08); color: #ffffff; cursor: pointer; display: grid; place-items: center; }
.ugi-full-arrow:hover { background: rgba(255,255,255,.2); }
.ugi-full-arrow svg { width: 24px; height: 24px; }
.ugi-full-arrow.left { left: 24px; }
.ugi-full-arrow.right { right: 24px; }
.ugi-full-close { position: absolute; top: 16px; right: 24px; width: 40px; height: 40px; border: 0; background: none; color: #ffffff; font-size: 28px; cursor: pointer; }
.ugi-full-count { position: absolute; bottom: 20px; left: 0; right: 0; text-align: center; color: #8f98a0; font-size: 13px; }
`;

// Steam store pages open in Steam's own store; other sites in the web browser
function openUrl(url: string) {
	if (url.startsWith('https://store.steampowered.com/')) (SteamClient as any).URL.ExecuteSteamURL(`steam://openurl/${url}`);
	else (SteamClient as any).System?.OpenInSystemBrowser?.(url);
}

const Chevron = ({ left }: { left?: boolean }) => (
	<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
		<path d={left ? 'M10 2 L4 8 L10 14' : 'M6 2 L12 8 L6 14'} />
	</svg>
);

// Like the store's media player: big picture, thumbnails below, full screen on click
function Player({ shots }: { shots: Screenshot[] }) {
	const [index, setIndex] = useState(0);
	const [full, setFull] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const strip = useRef<HTMLDivElement>(null);
	const go = (step: number) => setIndex((i) => (i + step + shots.length) % shots.length);

	// Keeps the selected thumbnail in view (only the strip scrolls, never the page)
	useEffect(() => {
		const row = strip.current;
		const thumb = row?.children[index] as HTMLElement | undefined;
		if (!row || !thumb) return;
		if (thumb.offsetLeft < row.scrollLeft) row.scrollLeft = thumb.offsetLeft;
		else if (thumb.offsetLeft + thumb.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = thumb.offsetLeft + thumb.offsetWidth - row.clientWidth;
	}, [index]);

	// Full screen: arrow keys move, Esc closes (kept away from Steam's own shortcuts)
	useEffect(() => {
		const win = box.current?.ownerDocument.defaultView;
		if (!full || !win) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowLeft') go(-1);
			else if (e.key === 'ArrowRight') go(1);
			else if (e.key === 'Escape') setFull(false);
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		win.addEventListener('keydown', onKey, true);
		return () => win.removeEventListener('keydown', onKey, true);
	}, [full, shots.length]);

	const current = shots[Math.min(index, shots.length - 1)]!;
	return (
		<div className="ugi-player" ref={box}>
			<div className="ugi-player-main" onClick={() => setFull(true)}>
				<img src={current.full} />
			</div>
			<div className="ugi-player-strip">
				<button className="ugi-player-arrow" onClick={() => go(-1)}><Chevron left /></button>
				<div className="ugi-player-thumbs" ref={strip}>
					{shots.map((s, i) => <img key={s.thumb} src={s.thumb} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} />)}
				</div>
				<button className="ugi-player-arrow" onClick={() => go(1)}><Chevron /></button>
			</div>
			{full && box.current &&
				createPortal(
					<div className="ugi-full" onClick={() => setFull(false)}>
						<style>{CSS}</style>
						<img src={current.full} onClick={(e) => e.stopPropagation()} />
						<button className="ugi-full-arrow left" onClick={(e) => { e.stopPropagation(); go(-1); }}><Chevron left /></button>
						<button className="ugi-full-arrow right" onClick={(e) => { e.stopPropagation(); go(1); }}><Chevron /></button>
						<button className="ugi-full-close" onClick={() => setFull(false)}>✕</button>
						<div className="ugi-full-count">{index + 1} / {shots.length}</div>
					</div>,
					box.current.ownerDocument.body,
				)}
		</div>
	);
}

function InfoBlock({ appid, sideHost }: { appid: number; sideHost: HTMLElement | null }) {
	const [info, setInfo] = useState<GameInfo | null | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		setInfo(undefined);
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

	// Names with a store page are links
	const linked = (list: string[]) =>
		list.length
			? list.map((name, i) => (
					<React.Fragment key={name}>
						{i > 0 && ', '}
						{info.links?.[name] ? <a onClick={() => openUrl(info.links![name]!)}>{name}</a> : name}
					</React.Fragment>
				))
			: undefined;
	const side: [string, React.ReactNode][] = [
		[t('info.developer'), linked(info.developers)],
		[t('info.publisher'), linked(info.publishers)],
		[t('info.genres'), linked(info.genres)],
		[t('info.released'), info.released],
	];

	const details = side.filter(([, v]) => v);
	return (
		<div className="ugi-info">
			<h2>{t('info.title')}</h2>
			{info.screenshots.length > 0 && <Player shots={info.screenshots} />}
			<div className="ugi-info-text">
				{info.description.split('\n\n').filter(Boolean).map((p, i) => (p.startsWith('# ') ? <h3 key={i}>{p.slice(2)}</h3> : <p key={i}>{p}</p>))}
			</div>
			{sideHost && details.length > 0 &&
				createPortal(
					<div className="ugi-info-side">
						<style>{CSS}</style>
						{details.map(([label, value]) => (
							<div key={label}><span>{label}</span>{value}</div>
						))}
					</div>,
					sideHost,
				)}
			<div className="ugi-info-source">
				{t('info.source')} <a onClick={() => openUrl(info.url)}>{SOURCE_NAMES[info.source]}</a>
			</div>
		</div>
	);
}

// ---------- Placing the block in Steam's page ----------

type Mounted = { host: HTMLElement; root: Root; appid: number; notice: HTMLElement; side: HTMLElement | null; column: HTMLElement | null; observer?: ResizeObserver };
let mounted: Mounted | null = null;
let importedAppids = new Set<number>();
let lastStateLoad = 0;

function unmount() {
	if (!mounted) return;
	try {
		mounted.root.unmount();
	} catch {}
	mounted.observer?.disconnect();
	mounted.host.remove();
	mounted.side?.remove();
	showNotice(mounted.notice);
	mounted = null;
}

// Side margins and padding stay: they keep the box (and so UGI's block) clear of the right column
const HIDDEN = { visibility: 'hidden', height: '0', minHeight: '0', paddingTop: '0', paddingBottom: '0', marginTop: '0', marginBottom: '0', borderTopWidth: '0', borderBottomWidth: '0', overflow: 'hidden' };

function hideNotice(notice: HTMLElement) {
	notice.dataset.ugiStyle = notice.style.cssText;
	Object.assign(notice.style, HIDDEN);
}

function showNotice(notice: HTMLElement) {
	notice.style.cssText = notice.dataset.ugiStyle ?? '';
	delete notice.dataset.ugiStyle;
}

// Steam's box for non-Steam shortcuts: the one with a dashed border that names the game
function shortcutNotice(doc: Document, name: string): HTMLElement | null {
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('div'))) {
		if (el.childElementCount > 3 || !el.textContent?.includes(name)) continue;
		if (doc.defaultView?.getComputedStyle(el).borderTopStyle === 'dashed') return el;
	}
	return null;
}

// Steam's right column (notes, screenshots): a sibling of the column holding the box
function rightColumn(notice: HTMLElement): HTMLElement | null {
	for (let el: HTMLElement | null = notice; el?.parentElement; el = el.parentElement) {
		const found = Array.from(el.parentElement.children).find((sibling) => sibling !== el && sibling.classList.contains('RightColumn'));
		if (found) return found as HTMLElement;
	}
	return null;
}

// The side box starts level with the "About this game" block, and has the same side edges as the
// first section of Steam's column (the notes)
function alignSide(m: Mounted) {
	const anchor = m.host.querySelector('.ugi-info');
	if (!m.side || !anchor) return;
	const delta = anchor.getBoundingClientRect().top - m.side.getBoundingClientRect().top;
	if (Math.abs(delta) >= 1) m.side.style.marginTop = `${Math.max(0, (parseFloat(m.side.style.marginTop) || 0) + delta)}px`;

	const column = m.column?.getBoundingClientRect();
	const section = m.side.nextElementSibling;
	// The notes box: the first element set in from the column's edges and almost as wide
	const edge =
		column &&
		section &&
		Array.from(section.querySelectorAll('*')).find((el) => {
			const r = el.getBoundingClientRect();
			return r.left > column.left + 1 && r.width > column.width * 0.8;
		});
	if (!column || !edge) return;
	const r = edge.getBoundingClientRect();
	const left = `${Math.max(0, r.left - column.left)}px`;
	const right = `${Math.max(0, column.right - r.right)}px`;
	if (m.side.style.marginLeft !== left) m.side.style.marginLeft = left;
	if (m.side.style.marginRight !== right) m.side.style.marginRight = right;
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
	// Already in place for this game
	if (
		mounted &&
		mounted.appid === appid &&
		mounted.host.isConnected &&
		mounted.host.nextElementSibling === mounted.notice &&
		mounted.notice.dataset.ugiStyle !== undefined &&
		(!mounted.side || (mounted.side.isConnected && mounted.column?.firstElementChild === mounted.side))
	) {
		alignSide(mounted);
		return;
	}
	const name = appStore.GetAppOverviewByAppID(appid)?.display_name;
	const notice = doc && name ? shortcutNotice(doc, name) : null;
	if (!doc || !notice) return unmount();

	unmount();
	// Measured while Steam's box is still visible
	const column = rightColumn(notice);
	const host = doc.createElement('div');
	notice.insertAdjacentElement('beforebegin', host);
	hideNotice(notice);
	const side = column ? doc.createElement('div') : null;
	if (column && side) column.insertAdjacentElement('afterbegin', side);
	// Like Steam's box: its own layout context, so it narrows beside the floating right column
	host.style.display = 'flow-root';
	const root = createRoot(host);
	root.render(
		<>
			<style>{CSS}</style>
			<InfoBlock appid={appid} sideHost={side} />
		</>,
	);
	mounted = { host, root, appid, notice, side, column };
	// Realigned as soon as the block or the right column changes size (pictures loading, window resized)
	const view = doc.defaultView as (Window & typeof globalThis) | null;
	if (view?.ResizeObserver) {
		const current = mounted;
		current.observer = new view.ResizeObserver(() => alignSide(current));
		current.observer.observe(host);
		// The notes narrow with the window: the side box follows at once
		if (column) current.observer.observe(column);
	}
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
