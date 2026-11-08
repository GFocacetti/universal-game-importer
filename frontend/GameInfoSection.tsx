// "About this game" section in the library page of imported games. Steam shows a dashed box there
// ("some detailed information is not available for non-Steam shortcuts"): UGI's block takes its place.
import { Navigation } from '@steambrew/client';
import Hls from 'hls.js';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { AchievementsBlock } from 'Achievements';
import { importedKeyFor, loadState, saveState } from 'backend';
import { GameInfo, gameInfo, Requirement, Reviews, Video } from 'gameInfo';
import { t, textDir } from 'i18n';
import { gamepadDocument, gamepadWindow, mainWindowPath } from 'location';
import { mainDocument } from 'overlay';
import { GamepadMode, Group, Pressable, Row, useGamepad } from 'Pressable';
import { imageUrls, isShortcut, openUrl } from 'steamApps';
import { steamCopy } from 'steamCopies';

declare const appStore: { GetAppOverviewByAppID(appid: number): { display_name?: string } | undefined };

const SOURCE_NAMES: Record<GameInfo['source'], string> = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games Store', microsoft: 'Microsoft Store', rawg: 'RAWG' };

// Laid out like a Steam store page: media player and summary across the whole page on top; below,
// description and system requirements on the left, and features, languages, age rating and Metacritic
// at the top of Steam's right column (above the notes)
const CSS = `
.ugi-info { container-type: inline-size; overflow-wrap: anywhere; margin: 0 0 16px; padding: 16px 20px; background: rgba(0,0,0,.2); border-radius: 3px; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px; line-height: 1.5; }
.ugi-info h2.first { margin-top: 0; }
.ugi-info .ugi-top + h2.first { margin-top: 28px; }
.ugi-info h2 { margin: 18px 0 10px; padding-bottom: 4px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #ffffff; border-bottom: 1px solid rgba(255,255,255,.08); }
.ugi-info-text p { margin: 0 0 10px; white-space: pre-line; text-align: justify; }
/* The stores' texts may be in another language than UGI's (English on an Arabic page): each paragraph
   takes its own writing direction */
.ugi-info-text p, .ugi-info-text h3, .ugi-req > div > div, .ugi-glance-summary, .ugi-glance-value, .ugi-feature span, .ugi-langs td, .ugi-ach-text b, .ugi-ach-text span { unicode-bidi: plaintext; }
.ugi-info-text h3 { margin: 16px 0 6px; font-size: 14px; font-weight: 700; color: #ffffff; }
.ugi-info-source { margin-top: 10px; color: #8f98a0; font-size: 12px; }
.ugi-info-source a { color: #8f98a0; text-decoration: underline; cursor: pointer; }
.ugi-info-muted { color: #8f98a0; }
.ugi-top { display: flex; gap: 16px; align-items: flex-start; }
.ugi-top .ugi-player { flex: 1 1 auto; min-width: 0; }
.ugi-glance { flex: 0 0 32%; min-width: 0; font-size: 12px; line-height: 1.45; }
.ugi-top > .ugi-glance:only-child { flex: 1 1 auto; }
.ugi-glance-header { width: 100%; aspect-ratio: 460 / 215; object-fit: cover; display: block; margin-bottom: 10px; }
.ugi-glance-summary { margin: 0 0 12px; color: #c6d4df; font-size: 13px; line-height: 1.45; }
.ugi-glance-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 12px; row-gap: 6px; margin-bottom: 12px; }
.ugi-glance-label { color: #556772; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding-top: 2px; }
.ugi-glance-value { color: #8f98a0; }
.ugi-glance a { color: #66c0f4; cursor: pointer; }
.ugi-glance a:hover { color: #ffffff; }
.ugi-review.positive { color: #66c0f4; }
.ugi-review.mixed { color: #b9a074; }
.ugi-review.negative { color: #a34c25; }
.ugi-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ugi-chip { background: rgba(103,193,245,.2); color: #67c1f5; padding: 0 7px; border-radius: 2px; font-size: 11px; line-height: 19px; cursor: pointer; }
.ugi-chip:hover { background: #67c1f5; color: #ffffff; }
.ugi-chip.plain { cursor: default; }
.ugi-chip.plain:hover { background: rgba(103,193,245,.2); color: #67c1f5; }
.ugi-copy { margin-top: 10px; color: #8f98a0; font-size: 12px; }
.ugi-req { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 13px; }
.ugi-req h4 { margin: 0 0 6px; color: #ffffff; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.ugi-req div { margin-bottom: 4px; color: #acb2b8; }
.ugi-req b { color: #8f98a0; font-weight: 400; }
@container (max-width: 720px) {
	.ugi-top { flex-direction: column; }
	.ugi-top .ugi-player, .ugi-glance { flex: none; width: 100%; }
	.ugi-req { grid-template-columns: 1fr; }
}
.ugi-player-main { position: relative; aspect-ratio: 16 / 9; background: #000; }
.ugi-player-main img, .ugi-player-main video { width: 100%; height: 100%; object-fit: contain; display: block; }
.ugi-player-main.image { cursor: zoom-in; }
.ugi-play { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #ffffff; font-size: 13px; cursor: pointer; background: rgba(0,0,0,.35); }
.ugi-play svg { width: 64px; height: 64px; }
.ugi-play:hover { background: rgba(0,0,0,.15); }
.ugi-player-strip { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.ugi-player-thumbs { position: relative; flex: 1; min-width: 0; display: flex; gap: 4px; overflow: hidden; scroll-behavior: smooth; }
.ugi-thumb { position: relative; width: 116px; height: 65px; flex: none; cursor: pointer; opacity: .6; border: 2px solid transparent; box-sizing: border-box; }
.ugi-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ugi-thumb svg { position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; color: #ffffff; }
.ugi-thumb:hover { opacity: .9; }
.ugi-thumb.on { opacity: 1; border-color: #ffffff; }
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
.ugi-info-side { overflow-wrap: anywhere; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 13px; line-height: 1.4; }
.ugi-side-panel { margin: 0 0 16px; padding: 12px 14px; background: rgba(0,0,0,.2); border-radius: 3px; }
.ugi-side-panel h3 { margin: 0 0 8px; color: #8f98a0; font-size: 12px; font-weight: 400; text-transform: uppercase; letter-spacing: .04em; }
.ugi-feature { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; padding: 4px 6px; background: rgba(103,193,245,.08); color: #67c1f5; font-size: 13px; }
.ugi-feature.link { cursor: pointer; }
.ugi-feature.link:hover { background: rgba(103,193,245,.25); color: #ffffff; }
.ugi-feature span { width: 26px; height: 16px; flex: none; display: grid; place-items: center; }
.ugi-feature img { max-width: 26px; max-height: 16px; }
.ugi-feature i { width: 6px; height: 6px; border-radius: 50%; background: #67c1f5; }
.ugi-langs { width: 100%; border-collapse: collapse; font-size: 12px; }
.ugi-langs th { color: #556772; font-weight: 400; font-size: 11px; text-align: center; padding: 2px 4px; }
.ugi-langs th:first-child, .ugi-langs td:first-child { text-align: left; }
.ugi-langs td { color: #acb2b8; padding: 3px 4px; border-top: 1px solid rgba(255,255,255,.05); text-align: center; }
.ugi-langs .yes { color: #67c1f5; }
.ugi-age { display: flex; gap: 10px; align-items: flex-start; }
.ugi-age b { flex: none; padding: 4px 8px; border: 2px solid #dcdedf; border-radius: 3px; color: #ffffff; font-size: 14px; }
.ugi-age span { color: #8f98a0; font-size: 12px; }
.ugi-meta { display: flex; align-items: center; gap: 10px; }
.ugi-meta b { width: 40px; height: 40px; flex: none; display: grid; place-items: center; color: #ffffff; font-size: 18px; border-radius: 3px; }
.ugi-meta a { color: #66c0f4; cursor: pointer; font-size: 12px; }
.ugi-pad-inline { display: inline-block; }
.ugi-pad-block { display: block; }
.ugi-bpm .ugi-info-side { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0 16px; margin-top: 18px; }
`;

const Chevron = ({ left }: { left?: boolean }) => (
	<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
		<path d={left ? 'M10 2 L4 8 L10 14' : 'M6 2 L12 8 L6 14'} />
	</svg>
);

const PlayIcon = () => (
	<svg viewBox="0 0 64 64">
		<circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.5)" stroke="currentColor" strokeWidth="2" />
		<path d="M26 20 L46 32 L26 44 Z" fill="currentColor" />
	</svg>
);

// Steam's trailers are HLS streams (video and audio in separate tracks): played with hls.js, or by
// the browser itself where it can. If neither works, the trailer opens on its store page.
function Trailer({ video, onFail }: { video: Video; onFail: () => void }) {
	const element = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const el = element.current;
		if (!el || !video.hls) return onFail();
		if (Hls.isSupported()) {
			const hls = new Hls();
			hls.on(Hls.Events.ERROR, (_event, data) => {
				if (data.fatal) onFail();
			});
			hls.loadSource(video.hls);
			hls.attachMedia(el);
			return () => hls.destroy();
		}
		if (el.canPlayType('application/vnd.apple.mpegurl')) {
			el.src = video.hls;
			return;
		}
		onFail();
	}, [video.hls]);
	return <video ref={element} poster={video.thumb} controls autoPlay muted onError={onFail} />;
}

type Media = { thumb: string; full?: string; video?: Video };

function MediaView({ item, onZoom }: { item: Media; onZoom?: () => void }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [item]);
	if (!item.video) return <img src={item.full} onClick={onZoom} />;
	const video = item.video;
	if (video.hls && !failed) return <Trailer key={video.hls} video={video} onFail={() => setFailed(true)} />;
	return (
		<>
			<img src={video.thumb} />
			{video.page && (
				<Pressable block onPress={() => openUrl(video.page!)}>
					<div className="ugi-play" onClick={() => openUrl(video.page!)}>
						<PlayIcon />
						<span>{t('info.watchTrailer')}</span>
					</div>
				</Pressable>
			)}
		</>
	);
}

// Like the store's media player: big picture or trailer, thumbnails below, full screen on click
function Player({ media }: { media: Media[] }) {
	const pad = useGamepad();
	const [index, setIndex] = useState(0);
	const [full, setFull] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const strip = useRef<HTMLDivElement>(null);
	const go = (step: number) => setIndex((i) => (i + step + media.length) % media.length);

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
	}, [full, media.length]);

	const current = media[Math.min(index, media.length - 1)]!;
	return (
		<div className="ugi-player" dir="ltr" ref={box}>
			<div className={`ugi-player-main${current.video ? '' : ' image'}`}>
				{/* Big Picture: no full screen view (Steam's navigation can't reach it) */}
				<MediaView item={current} onZoom={pad ? undefined : () => setFull(true)} />
			</div>
			<div className="ugi-player-strip">
				{/* Big Picture: the D-pad moves along the thumbnails, the arrows aren't needed */}
				{!pad && <button className="ugi-player-arrow" onClick={() => go(-1)}><Chevron left /></button>}
				<Row className="ugi-player-thumbs" ref={strip}>
					{media.map((m, i) => (
						<Pressable key={m.thumb + i} onPress={() => setIndex(i)} onFocus={() => setIndex(i)}>
							<div className={`ugi-thumb${i === index ? ' on' : ''}`} onClick={() => setIndex(i)}>
								<img src={m.thumb} />
								{m.video && <PlayIcon />}
							</div>
						</Pressable>
					))}
				</Row>
				{!pad && <button className="ugi-player-arrow" onClick={() => go(1)}><Chevron /></button>}
			</div>
			{full && box.current &&
				createPortal(
					<div className="ugi-full" onClick={() => setFull(false)}>
						<style>{CSS}</style>
						<div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
							<MediaView item={current} />
						</div>
						<button className="ugi-full-arrow left" onClick={(e) => { e.stopPropagation(); go(-1); }}><Chevron left /></button>
						<button className="ugi-full-arrow right" onClick={(e) => { e.stopPropagation(); go(1); }}><Chevron /></button>
						<button className="ugi-full-close" onClick={() => setFull(false)}>✕</button>
						<div className="ugi-full-count">{index + 1} / {media.length}</div>
					</div>,
					box.current.ownerDocument.body,
				)}
		</div>
	);
}

// The first picture that loads; nothing when none does
function FirstImage({ urls, className }: { urls: string[]; className: string }) {
	const [index, setIndex] = useState(0);
	useEffect(() => setIndex(0), [urls.join('|')]);
	if (index >= urls.length) return null;
	return <img className={className} src={urls[index]} onError={() => setIndex(index + 1)} />;
}

// Steam's wording for a review score, from the share of positive reviews and their number
function reviewVerdict(r: Reviews): { label: string; tone: 'positive' | 'mixed' | 'negative' } {
	const { percent: p, total: n } = r;
	if (p >= 80) return { label: t(n >= 500 && p >= 95 ? 'review.9' : n >= 50 ? 'review.8' : 'review.7'), tone: 'positive' };
	if (p >= 70) return { label: t('review.6'), tone: 'positive' };
	if (p >= 40) return { label: t('review.5'), tone: 'mixed' };
	if (p >= 20) return { label: t('review.4'), tone: 'negative' };
	return { label: t(n >= 500 ? 'review.1' : n >= 50 ? 'review.2' : 'review.3'), tone: 'negative' };
}

const metacriticColor = (score: number) => (score >= 75 ? '#66cc33' : score >= 50 ? '#ffcc33' : '#ff0000');

function SidePanels({ info }: { info: GameInfo }) {
	const languages = info.languages ?? [];
	const anyAudio = languages.some((l) => l.audio);
	return (
		<Row className="ugi-info-side">
			<style>{CSS}</style>
			{!!info.features?.length && (
				<Group enterable={info.features.some((f) => f.url)}>
				<div className="ugi-side-panel">
					<h3>{t('info.features')}</h3>
					{info.features.map((f) => (
						<Pressable key={f.name} block onPress={f.url ? () => openUrl(f.url!) : undefined}>
							<div className={`ugi-feature${f.url ? ' link' : ''}`} onClick={f.url ? () => openUrl(f.url!) : undefined}>
								<span>{f.icon ? <img src={f.icon} /> : <i />}</span>
								{f.name}
							</div>
						</Pressable>
					))}
				</div>
				</Group>
			)}
			{languages.length > 0 && (
				<Group>
				<div className="ugi-side-panel">
					<h3>{t('info.languages')}</h3>
					<table className="ugi-langs">
						<thead>
							<tr>
								<th />
								<th>{t('info.interface')}</th>
								{anyAudio && <th>{t('info.audio')}</th>}
							</tr>
						</thead>
						<tbody>
							{languages.map((l) => (
								<tr key={l.name}>
									<td>{l.name}</td>
									<td className="yes">{l.interface ? '✔' : ''}</td>
									{anyAudio && <td className="yes">{l.audio ? '✔' : ''}</td>}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				</Group>
			)}
			{info.age && (
				<Group>
					<div className="ugi-side-panel">
						<h3>{t('info.age')}</h3>
						<div className="ugi-age">
							<b>{info.age.label}</b>
							{info.age.descriptors && <span>{info.age.descriptors}</span>}
						</div>
					</div>
				</Group>
			)}
			{info.metacritic && (
				<Group enterable={!!info.metacritic.url}>
				<div className="ugi-side-panel">
					<h3>Metacritic</h3>
					<div className="ugi-meta">
						<b style={{ background: metacriticColor(info.metacritic.score) }}>{info.metacritic.score}</b>
						{info.metacritic.url && (
							<Pressable onPress={() => openUrl(info.metacritic!.url!)}>
								<a onClick={() => openUrl(info.metacritic!.url!)}>{t('info.metacriticRead')}</a>
							</Pressable>
						)}
					</div>
				</div>
				</Group>
			)}
		</Row>
	);
}

// The plugin's backend does one thing at a time: the achievements (slower to read) wait until the
// information is there, so they don't hold it up. They go below the genres; without information,
// on their own.
function Blocks({ appid, side, top }: { appid: number; side: HTMLElement | null; top: HTMLElement | null }) {
	const [ready, setReady] = useState(false);
	const [noInfo, setNoInfo] = useState(false);
	// Steam's own games have Steam's achievements panel already
	const achievements = isShortcut(appid) ? <AchievementsBlock appid={appid} ready={ready} /> : null;
	return (
		<>
			<style>{CSS}</style>
			<InfoBlock appid={appid} sideHost={side} topHost={top} achievements={achievements} onDone={(shown) => (setNoInfo(!shown), setReady(true))} />
			{noInfo && achievements && <div className="ugi-info">{achievements}</div>}
		</>
	);
}

function InfoBlock({ appid, sideHost, topHost, achievements, onDone }: { appid: number; sideHost: HTMLElement | null; topHost: HTMLElement | null; achievements: React.ReactNode; onDone: (shown: boolean) => void }) {
	const pad = useGamepad();
	const [info, setInfo] = useState<GameInfo | null | undefined>(undefined);
	// The same game in Steam's library, linked below the genres
	const [copy, setCopy] = useState<number | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		setInfo(undefined);
		setCopy(undefined);
		(async () => {
			const state = await loadState();
			// Steam's own games go by their store page
			const key = isShortcut(appid) ? (importedKeyFor(state, appid) ?? `manual:${appid}`) : `steam:${appid}`;
			// A game added by hand goes by its name in Steam (renamed there, it is looked up again)
			const entry = state.imported[key];
			if (entry && alive) setCopy(steamCopy(entry));
			const inSteam = appStore.GetAppOverviewByAppID(appid)?.display_name;
			if (entry && entry.launcher === 'manual' && inSteam && inSteam !== entry.name) {
				entry.name = inSteam;
				await saveState(state);
			}
			const name = entry?.name ?? inSteam ?? '';
			const found = name ? await gameInfo(state, key, name, (fresh) => alive && setInfo(fresh)) : null;
			if (alive) setInfo(found);
			return !!found;
		})()
			.catch(() => {
				if (alive) setInfo(null);
				return false;
			})
			.then(onDone);
		return () => {
			alive = false;
		};
	}, [appid]);

	// Nothing to show: no block at all
	if (info === null) return null;
	if (info === undefined) {
		return (
			<div className="ugi-info">
				<span className="ugi-info-muted">{t('info.loading')}</span>
			</div>
		);
	}

	// Names with a store page are links
	const linked = (list: string[]) =>
		list.map((name, i) => (
			<React.Fragment key={name}>
				{i > 0 && ', '}
				{info.links?.[name] ? (
					<Pressable onPress={() => openUrl(info.links![name]!)}>
						<a onClick={() => openUrl(info.links![name]!)}>{name}</a>
					</Pressable>
				) : (
					name
				)}
			</React.Fragment>
		));
	const verdict = info.reviews && reviewVerdict(info.reviews);
	const rows: [string, React.ReactNode][] = [];
	if (info.reviews && verdict)
		rows.push([
			t('info.reviews'),
			<span className={`ugi-review ${verdict.tone}`} title={t('info.reviewsTip', { p: info.reviews.percent, n: info.reviews.total.toLocaleString() })}>
				{verdict.label} <span className="ugi-glance-value">({info.reviews.total.toLocaleString()})</span>
			</span>,
		]);
	if (info.released) rows.push([t('info.released'), info.released]);
	if (info.developers.length) rows.push([t('info.developer'), linked(info.developers)]);
	if (info.publishers.length) rows.push([t('info.publisher'), linked(info.publishers)]);
	if (info.stores?.length)
		rows.push([
			t('info.store'),
			info.stores.map((store, i) => (
				<React.Fragment key={store.url}>
					{i > 0 && ', '}
					<Pressable onPress={() => openUrl(store.url)}>
						<a onClick={() => openUrl(store.url)}>{store.name}</a>
					</Pressable>
				</React.Fragment>
			)),
		]);

	// The store's header, else the game's own wide pictures from the library
	const headers = [...(info.header ? [info.header] : []), ...imageUrls(appid, 'wide')];
	const media: Media[] = [...(info.videos ?? []).map((video) => ({ thumb: video.thumb, video })), ...info.screenshots.map((s) => ({ thumb: s.thumb, full: s.full }))];
	const minimum = info.requirements?.minimum ?? [];
	const recommended = info.requirements?.recommended ?? [];
	const requirementList = (title: string, list: Requirement[]) =>
		list.length > 0 && (
			<div>
				<h4>{title}</h4>
				{list.map((r, i) => (
					<div key={i}>{r.label ? <><b>{r.label}:</b> {r.value}</> : r.value}</div>
				))}
			</div>
		);

	const top = (
		<div className="ugi-top">
			{media.length > 0 && <Player media={media} />}
			<div className="ugi-glance">
				{/* Big Picture: picture and summary, details, genres are one stop each */}
				<Group>
					<FirstImage urls={headers} className="ugi-glance-header" />
					{info.summary && <p className="ugi-glance-summary">{info.summary}</p>}
				</Group>
				{rows.length > 0 && (
					<Group enterable>
						<div className="ugi-glance-grid">
							{rows.map(([label, value]) => (
								<React.Fragment key={label}>
									<div className="ugi-glance-label">{label}</div>
									<div className="ugi-glance-value">{value}</div>
								</React.Fragment>
							))}
						</div>
					</Group>
				)}
				{info.genres.length > 0 && (
					<Group enterable>
					<div className="ugi-chips">
						{info.genres.map((g) =>
							info.links?.[g] ? (
								<Pressable key={g} onPress={() => openUrl(info.links![g]!)}>
									<span className="ugi-chip" onClick={() => openUrl(info.links![g]!)}>{g}</span>
								</Pressable>
							) : (
								<span key={g} className="ugi-chip plain">{g}</span>
							),
						)}
					</div>
					</Group>
				)}
				{copy && (
					<div className="ugi-copy">
						{t('info.alsoOnSteam')}{' '}
						<Pressable onPress={() => Navigation.Navigate(`/library/app/${copy}`)}>
							<a onClick={() => Navigation.Navigate(`/library/app/${copy}`)}>{t('info.openSteamCopy')}</a>
						</Pressable>
					</div>
				)}
				{achievements}
			</div>
		</div>
	);

	return (
		<div className="ugi-info">
			{topHost
				? createPortal(
						<div className="ugi-info ugi-info-head">
							<style>{CSS}</style>
							{top}
						</div>,
						topHost,
					)
				: top}
			<h2 className="first">{t('info.title')}</h2>
			<div className="ugi-info-text">
				{info.description
					.split('\n\n')
					.filter(Boolean)
					.map((p, i) => (
						<Pressable key={i} block>
							{p.startsWith('# ') ? <h3>{p.slice(2)}</h3> : <p>{p}</p>}
						</Pressable>
					))}
			</div>
			{(minimum.length > 0 || recommended.length > 0) && (
				<>
					<h2>{t('info.requirements')}</h2>
					<Pressable block>
						<div className="ugi-req">
							{requirementList(t('info.minimum'), minimum)}
							{requirementList(t('info.recommended'), recommended)}
						</div>
					</Pressable>
				</>
			)}
			{sideHost && createPortal(<SidePanels info={info} />, sideHost)}
			{/* Big Picture has no right column: the panels follow the description */}
			{!sideHost && pad && <SidePanels info={info} />}
			<div className="ugi-info-source">
				{t('info.source')}{' '}
				<Pressable onPress={() => openUrl(info.url)}>
					<a onClick={() => openUrl(info.url)}>{SOURCE_NAMES[info.source]}</a>
				</Pressable>
			</div>
		</div>
	);
}

// ---------- Placing the block in Steam's page ----------

type Mounted = {
	host: HTMLElement;
	root: Root;
	appid: number;
	// Steam's box for non-Steam shortcuts, hidden while the block is there (none on Steam's own games)
	notice: HTMLElement | null;
	// What the block sits right before: that box, or the first part of the left column
	anchor: HTMLElement;
	side: HTMLElement | null;
	column: HTMLElement | null;
	// Player and summary, across both columns
	top: HTMLElement | null;
	observer?: ResizeObserver;
};
let mounted: Mounted | null = null;

function unmount() {
	if (!mounted) return;
	try {
		mounted.root.unmount();
	} catch {}
	mounted.observer?.disconnect();
	mounted.host.remove();
	mounted.side?.remove();
	mounted.top?.remove();
	if (mounted.column && mounted.column.dataset.ugiMargin !== undefined) {
		mounted.column.style.marginLeft = mounted.column.dataset.ugiMargin;
		delete mounted.column.dataset.ugiMargin;
	}
	if (mounted.notice) showNotice(mounted.notice);
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

// Steam's two columns: the one holding the box, and the right one (notes, screenshots) next to it
function columns(notice: HTMLElement): { left: HTMLElement; right: HTMLElement } | null {
	for (let el: HTMLElement | null = notice; el?.parentElement; el = el.parentElement) {
		const found = Array.from(el.parentElement.children).find((sibling) => sibling !== el && sibling.classList.contains('RightColumn'));
		if (found) return { left: el, right: found as HTMLElement };
	}
	return null;
}

// A Steam game's page: its two columns, the left one (activity) and the right one (achievements, notes)
function gameColumns(doc: Document): { left: HTMLElement; right: HTMLElement } | null {
	const right = Array.from(doc.querySelectorAll<HTMLElement>('.RightColumn')).find((el) => el.getClientRects().length);
	const left = right && Array.from(right.parentElement?.children ?? []).find((el) => el.classList.contains('LeftColumn'));
	return right && left ? { left: left as HTMLElement, right } : null;
}

// The side box starts level with the "About this game" block, and has the same side edges as the
// first section of Steam's column (the notes)
function alignSide(m: Mounted) {
	const anchor = m.host.querySelector('.ugi-info');
	if (!m.side || !anchor || !m.side.firstElementChild) return;
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

	// The top part spans from the left edge of the description to the right edge of the notes,
	// measured on screen (Steam's containers have their own padding)
	const head = m.top?.querySelector<HTMLElement>('.ugi-info-head');
	const block = m.host.querySelector('.ugi-info');
	if (!m.top || !head || !block) return;
	const nudge = (side: 'marginLeft' | 'marginRight', delta: number) => {
		if (Math.abs(delta) >= 1) m.top!.style[side] = `${Math.max(0, (parseFloat(m.top!.style[side]) || 0) + delta)}px`;
	};
	nudge('marginLeft', block.getBoundingClientRect().left - head.getBoundingClientRect().left);
	nudge('marginRight', head.getBoundingClientRect().right - r.right);

	// The summary starts where the right column's text does ("Features"), unless it sits under the player
	const glance = head.querySelector<HTMLElement>('.ugi-glance');
	const heading = m.side.querySelector('.ugi-side-panel h3');
	const row = head.querySelector('.ugi-top');
	const view = head.ownerDocument.defaultView;

	// The description comes as close to the right column as the player to the summary: Steam keeps
	// its floating column away with a left margin, which is narrowed (restored on leaving)
	const panel = m.side.querySelector('.ugi-side-panel');
	if (m.column && panel && row && view) {
		const gap = parseFloat(view.getComputedStyle(row).columnGap) || 16;
		const delta = panel.getBoundingClientRect().left - block.getBoundingClientRect().right - gap;
		if (Math.abs(delta) >= 1) {
			if (m.column.dataset.ugiMargin === undefined) m.column.dataset.ugiMargin = m.column.style.marginLeft;
			const current = parseFloat(view.getComputedStyle(m.column).marginLeft) || 0;
			m.column.style.marginLeft = `${current - delta}px`;
		}
	}

	const player = head.querySelector<HTMLElement>('.ugi-player');
	if (!glance || !heading || !row || view?.getComputedStyle(row).flexDirection === 'column') {
		if (glance?.style.flexBasis) glance.style.flexBasis = '';
		if (player?.style.marginRight) player.style.marginRight = '';
		return;
	}
	const width = `${Math.max(0, glance.getBoundingClientRect().right - heading.getBoundingClientRect().left)}px`;
	if (glance.style.flexBasis !== width) glance.style.flexBasis = width;

	// The player ends where the description does; the summary stays put
	if (player) {
		const delta = player.getBoundingClientRect().right - block.getBoundingClientRect().right;
		if (Math.abs(delta) >= 1) player.style.marginRight = `${Math.max(0, (parseFloat(player.style.marginRight) || 0) + delta)}px`;
	}
}

// Steam draws a game's page a moment after opening it: its box is looked for at every check for the
// first seconds, then once a second (the search goes through the whole page)
let searching = { appid: 0, since: 0, last: 0 };
// The setting for Steam's own games, read again every few seconds (changed in UGI's page meanwhile)
let steamPages = false;
let steamPagesRead = 0;
let aligned = 0;

async function tick() {
	if (Date.now() - steamPagesRead > 3000) {
		steamPagesRead = Date.now();
		steamPages = (await loadState()).settings.steam_pages === true;
	}
	const path = mainWindowPath();
	const appid = Number(path.match(/^\/library\/app\/(\d+)/)?.[1] ?? 0);
	// Every non-Steam game (imported by UGI or added by hand), and Steam's own when the setting is on
	if (!appid || (!isShortcut(appid) && !steamPages)) {
		searching.appid = 0;
		return unmount();
	}
	const now = Date.now();

	const doc = mainDocument();
	// Already in place for this game
	if (
		mounted &&
		mounted.appid === appid &&
		mounted.host.isConnected &&
		mounted.host.nextElementSibling === mounted.anchor &&
		(!mounted.notice || mounted.notice.dataset.ugiStyle !== undefined) &&
		(!mounted.side || (mounted.side.isConnected && mounted.column?.firstElementChild === mounted.side)) &&
		(!mounted.top || mounted.top.isConnected)
	) {
		if (now - aligned >= 1000) {
			aligned = now;
			alignSide(mounted);
		}
		return;
	}
	if (searching.appid !== appid) searching = { appid, since: now, last: 0 };
	if (now - searching.since > 3000 && now - searching.last < 1000) return;
	searching.last = now;
	const name = appStore.GetAppOverviewByAppID(appid)?.display_name;
	const notice = doc && name && isShortcut(appid) ? shortcutNotice(doc, name) : null;
	// A Steam game: the block goes at the top of the left column, under the bar of links to its store page
	const steamColumns = doc && !isShortcut(appid) ? gameColumns(doc) : null;
	const anchor = notice ?? steamColumns?.left.firstElementChild as HTMLElement | null | undefined;
	if (!doc || !anchor) return unmount();

	unmount();
	// Measured while Steam's box is still visible
	const cols = notice ? columns(notice) : steamColumns;
	const column = cols?.right ?? null;
	// UGI's texts follow its language's direction; the media above the columns stay as Steam lays them out
	const host = doc.createElement('div');
	host.dir = textDir();
	anchor.insertAdjacentElement('beforebegin', host);
	if (notice) hideNotice(notice);
	const side = column ? doc.createElement('div') : null;
	if (side) side.dir = textDir();
	if (column && side) column.insertAdjacentElement('afterbegin', side);
	// Above both columns, like the store's media section
	let top: HTMLElement | null = null;
	if (cols) {
		top = doc.createElement('div');
		const first = cols.left.compareDocumentPosition(cols.right) & Node.DOCUMENT_POSITION_FOLLOWING ? cols.left : cols.right;
		first.insertAdjacentElement('beforebegin', top);
	}
	// Like Steam's box: its own layout context, so it narrows beside the floating right column
	host.style.display = 'flow-root';
	const root = createRoot(host);
	root.render(<Blocks appid={appid} side={side} top={top} />);
	mounted = { host, root, appid, notice, anchor, side, column, top };
	// Steam drawing the page again: looked for quickly once more
	searching.appid = 0;
	// Realigned as soon as the block or the right column changes size (pictures loading, window resized)
	const view = doc.defaultView as (Window & typeof globalThis) | null;
	if (view?.ResizeObserver) {
		const current = mounted;
		current.observer = new view.ResizeObserver(() => alignSide(current));
		current.observer.observe(host);
		// The notes narrow with the window: the side box follows at once
		if (column) current.observer.observe(column);
		if (top) current.observer.observe(top);
	}
}

// ---------- Big Picture ----------

// Big Picture's game page has no right column: the blocks go in its "Game info" tab, in place of
// Steam's notice for non-Steam shortcuts and the portrait beside it. They are drawn inside Steam's
// own React contexts (controller navigation, scrolling, focus ring), so the D-pad reaches them.
type BigMounted = { host: HTMLElement; root: Root; appid: number; box: HTMLElement };
let big: BigMounted | null = null;

// The right stick scrolls the page like a mouse wheel (Steam leaves it free on this page; the left one
// moves the focus). Steam sends every stick's position; 47 is the right stick.
const RIGHT_STICK = 47;
// Steam reports the stick in two ways: its position (-1 to 1, up is positive), or a running
// position like a mouse pointer's (thousands, growing downwards), reset to 0 on release
let stickSpeed = 0; // position mode
let stickMoved = 0; // pointer mode: pixels to scroll still pending
let lastPointer: number | null = null;
let lastMessage = 0;
let stickListening = false;
let stickLoop = false;

function listenToStick() {
	if (!stickListening) {
		stickListening = true;
		// (the typings describe another signature than the one Steam calls)
		const input = SteamClient.Input as any;
		try {
			input.EnableControllerAnalogInputMessages(true);
			input.RegisterForControllerAnalogInputMessages((_controller: number, source: number, _active: boolean, x: number, y: number) => {
				if (source !== RIGHT_STICK) return;
				lastMessage = performance.now();
				if (x === 0 && y === 0) {
					stickSpeed = 0;
					lastPointer = null;
				} else if (Math.abs(y) <= 1) {
					stickSpeed = y;
					lastPointer = null;
				} else {
					if (lastPointer !== null) stickMoved += (y - lastPointer) * 0.4;
					lastPointer = y;
				}
			});
		} catch (err) {
			console.error('[UGI] right stick', err);
			return;
		}
	}
	// Each frame while UGI is in Big Picture's page; started again when it comes back
	if (stickLoop) return;
	stickLoop = true;
	let last = performance.now();
	let scrolled = false;
	const step = (now: number) => {
		if (!big) {
			stickLoop = false;
			return;
		}
		const elapsed = Math.min(now - last, 50);
		last = now;
		// No news from the stick: it was let go
		if (now - lastMessage > 120) {
			stickSpeed = 0;
			lastPointer = null;
		}
		let delta = 0;
		if (Math.abs(stickSpeed) > 0.15) delta = -stickSpeed * Math.abs(stickSpeed) * elapsed * 2.2;
		delta += stickMoved;
		stickMoved = 0;
		// A UGI window open over the page (the achievements list) scrolls instead of the page
		const pane = big?.host.ownerDocument.querySelector<HTMLElement>('.ugi-overlay .ugi-win-pane');
		if (pane) {
			if (Math.abs(delta) >= 0.5) pane.scrollTop += delta;
		} else if (big && Math.abs(delta) >= 0.5) {
			scrollPage(big.host, delta);
			scrolled = true;
		} else if (big && scrolled && now - lastMessage > 120) {
			scrolled = false;
			focusOnScreen(big.host);
		}
		requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

// The D-pad goes on from where the page was scrolled to, not from where its focus was left: the
// focus moves to UGI's first element on screen (unless it is on screen already)
function focusOnScreen(host: HTMLElement) {
	const view = host.ownerDocument.defaultView;
	if (!view) return;
	const height = view.innerHeight;
	const visible = (el: Element) => {
		const r = el.getBoundingClientRect();
		return r.height > 0 && r.top >= 0 && r.top < height * 0.8;
	};
	const active = host.ownerDocument.activeElement;
	if (active && active !== host.ownerDocument.body && visible(active)) return;
	const target = [...host.querySelectorAll<HTMLElement>('.ugi-pad-block, .ugi-pad-inline')].find(visible);
	target?.focus({ preventScroll: true });
}

// Down: first Steam's header goes up, then the tab's contents; up the other way round
function scrollPage(from: HTMLElement, delta: number) {
	const scrollers: HTMLElement[] = [];
	for (let el = from.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 1) scrollers.push(el);
	if (delta > 0) scrollers.reverse();
	for (const el of scrollers) {
		const before = el.scrollTop;
		el.scrollTop = before + delta;
		const moved = el.scrollTop - before;
		delta -= moved;
		if (Math.abs(delta) < 0.5) return;
	}
}

function unmountBig() {
	if (!big) return;
	try {
		big.root.unmount();
	} catch {}
	big.host.remove();
	showNotice(big.box);
	big = null;
}

// The contexts around an element in Steam's page, innermost first
function steamContexts(el: HTMLElement): { type: any; value: unknown }[] {
	const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
	const list: { type: any; value: unknown }[] = [];
	for (let f = key ? (el as any)[key] : null; f; f = f.return) {
		if (f.type?.$$typeof === Symbol.for('react.context')) list.push({ type: f.type, value: f.memoizedProps?.value });
	}
	return list;
}

function tickBigPicture() {
	const path: string = gamepadWindow()?.m_history?.location?.pathname ?? '';
	const appid = Number(path.match(/^\/library\/app\/(\d+)\/tab\/GameInfo/)?.[1] ?? 0);
	if (!appid || (!isShortcut(appid) && !steamPages)) return unmountBig();
	if (big && big.appid === appid && big.host.isConnected && big.box.isConnected) return;
	const doc = gamepadDocument();
	// Steam's notice and the portrait beside it, in one box; on Steam's own games, its short summary
	// (details, features, portrait), which UGI's blocks include
	const box = isShortcut(appid)
		? doc?.querySelector<HTMLElement>('.AppGameInfoContainer .Shortcut')?.parentElement
		: doc?.querySelector<HTMLElement>('.AppGameInfoContainer')?.firstElementChild as HTMLElement | null | undefined;
	unmountBig();
	if (!doc || !box) return;

	const host = doc.createElement('div');
	host.className = 'ugi-bpm';
	host.dir = textDir();
	box.insertAdjacentElement('beforebegin', host);
	hideNotice(box);
	let tree: React.ReactNode = (
		<GamepadMode.Provider value={true}>
			<Blocks appid={appid} side={null} top={null} />
		</GamepadMode.Provider>
	);
	for (const context of steamContexts(box)) tree = React.createElement(context.type, { value: context.value }, tree);
	const root = createRoot(host);
	root.render(tree);
	big = { host, root, appid, box };
	listenToStick();
}

export function startGameInfo() {
	let busy = false;
	setInterval(() => {
		try {
			tickBigPicture();
		} catch (err) {
			console.error('[UGI] game info (Big Picture)', err);
		}
		if (busy) return;
		busy = true;
		tick()
			.catch((err) => console.error('[UGI] game info', err))
			.finally(() => (busy = false));
	}, 150);
}
