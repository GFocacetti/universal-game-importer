import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { applyImage, FILTER_OPTIONS, gameIdFor, imagesFor, ImageType, replaceGame, resetImage, SgdbImage, sgdbCacheKey, UserFilter } from 'sgdb';
import { ImageKind, openUrl } from 'steamApps';
import { SteamImage } from 'SteamImage';
import { themeStyle, UGI_CSS } from 'theme';
import { UgiState } from 'types';
import { bigPicture, libraryVisible } from 'location';
import { watchGamepad } from 'gamepad';

export const IMAGE_TYPES: { type: ImageType; kind: ImageKind; label: () => string }[] = [
	{ type: 0, kind: 'grid', label: () => t('image.grid') },
	{ type: 3, kind: 'wide', label: () => t('image.wide') },
	{ type: 1, kind: 'hero', label: () => t('image.hero') },
	{ type: 2, kind: 'logo', label: () => t('image.logo') },
	{ type: 4, kind: 'icon', label: () => t('image.icon') },
];

// Everything the gallery shows and does for one game: used by the gallery window (from Steam's menu)
// and by the Images tab of a game's window in UGI's page. onChanged: after an image was applied.
export function useGallery(appid: number, onChanged?: () => void) {
	const [state, setState] = useState<UgiState | null>(null);
	const [type, setType] = useState<ImageType>(0);
	const [animated, setAnimated] = useState(false);
	const [images, setImages] = useState<Record<string, SgdbImage[]>>({});
	const [gameId, setGameId] = useState<number | null>(null);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [version, setVersion] = useState(0);
	const changed = () => {
		setVersion((v) => v + 1);
		onChanged?.();
	};

	useEffect(() => {
		loadState().then((s) => {
			setState(s);
			setAnimated(!!s.settings.animated);
		});
	}, []);

	// Loads the lists for all five types (their counts are shown)
	const loadAll = async (s: UgiState, anim: boolean) => {
		setStatus(t('gallery.loading'));
		try {
			const id = await gameIdFor(s, appid);
			setGameId(id);
			if (!id) {
				setStatus(t('gallery.notFound'));
				return;
			}
			const lists: Record<string, SgdbImage[]> = {};
			for (const { type: ty } of IMAGE_TYPES) lists[ty] = await imagesFor(s, id, ty, anim ? 'animated' : 'static');
			setImages(lists);
			await saveState(s);
			setStatus('');
		} catch (err) {
			setStatus(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error'));
		}
	};

	useEffect(() => {
		if (state) loadAll(state, animated);
	}, [state, animated]);

	const filter: UserFilter = state?.settings.filters?.[String(type)] ?? {};
	const setFilter = async (patch: UserFilter) => {
		const s = await loadState();
		s.settings.filters = { ...(s.settings.filters ?? {}), [String(type)]: { ...filter, ...patch } };
		await saveState(s);
		setState(s);
	};

	const apply = async (image: SgdbImage) => {
		setBusy(true);
		setStatus(t('gallery.applying'));
		const ok = await applyImage(appid, type, image.url);
		setStatus(ok ? '' : t('gallery.applyFailed'));
		changed();
		setBusy(false);
	};

	const reset = async () => {
		await resetImage(appid, type);
		changed();
	};

	// Every type at once, with the images UGI would pick by itself
	const autoPick = async () => {
		setBusy(true);
		setStatus(t('auto.busy'));
		try {
			const s = await loadState();
			const n = await replaceGame(s, appid);
			await saveState(s);
			setState(s);
			setStatus(t('auto.done', { n }));
		} catch (err) {
			setStatus(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error'));
		}
		changed();
		setBusy(false);
	};

	const clearCache = async () => {
		const s = await loadState();
		delete s.sgdb_ids[sgdbCacheKey(s, appid)];
		await saveState(s);
		setState(s);
	};

	const openWebsite = () => {
		if (gameId) openUrl(`https://www.steamgriddb.com/game/${gameId}`);
	};

	return { appid, state, type, setType, animated, setAnimated, images, gameId, status, busy, version, filter, setFilter, apply, reset, autoPick, clearCache, openWebsite };
}

export type GalleryModel = ReturnType<typeof useGallery>;

const currentType = (g: GalleryModel) => IMAGE_TYPES.find((x) => x.type === g.type)!;

// Animated images and SteamGridDB's page
export function GalleryOptions({ g }: { g: GalleryModel }) {
	return (
		<>
			<label className={`ugi-switch${g.animated ? ' on' : ''}`} onClick={() => g.setAnimated(!g.animated)}>
				<span className="ugi-tog" />
				{t('gallery.animated')}
			</label>
			<button className="ugi-btn secondary" disabled={!g.gameId} onClick={g.openWebsite}>{t('gallery.website')}</button>
		</>
	);
}

// The filters and the images to pick for the chosen type; top: a bar above the filters
export function GalleryPicker({ g, top }: { g: GalleryModel; top?: React.ReactNode }) {
	const options = FILTER_OPTIONS[g.type];
	const current = currentType(g);
	const list = g.images[g.type] ?? [];
	const filter = g.filter;
	return (
		<div className="ugi-pick">
			{top && <div className="ugi-pick-bar">{top}</div>}
			<details className="ugi-filters" open>
				<summary>{t('gallery.filters', { type: current.label() })}</summary>
				<div className="ugi-filter-row">
					<select value={filter.style ?? ''} onChange={(e) => g.setFilter({ style: e.target.value })}>
						<option value="">{t('gallery.styleAll')}</option>
						{options.styles.map((s) => <option key={s} value={s}>{s}</option>)}
					</select>
					{options.dimensions.length > 0 && (
						<select value={filter.dimension ?? 'default'} onChange={(e) => g.setFilter({ dimension: e.target.value === 'default' ? undefined : e.target.value })}>
							<option value="default">{t('gallery.dimDefault')}</option>
							<option value="">{t('gallery.dimAll')}</option>
							{options.dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
						</select>
					)}
					{g.type !== 4 && (
						<select value={(filter.webp ?? g.state?.settings.webp) ? 'webp' : 'basic'} onChange={(e) => g.setFilter({ webp: e.target.value === 'webp' })}>
							<option value="basic">{t('gallery.formatBasic')}</option>
							<option value="webp">{t('gallery.formatWebp')}</option>
						</select>
					)}
					<select value={filter.nsfw ?? ''} onChange={(e) => g.setFilter({ nsfw: e.target.value })}>
						<option value="">{t('gallery.nsfwNo')}</option>
						<option value="true">{t('gallery.nsfwOnly')}</option>
						<option value="any">{t('gallery.nsfwAny')}</option>
					</select>
					<select value={filter.humor ?? ''} onChange={(e) => g.setFilter({ humor: e.target.value })}>
						<option value="">{t('gallery.humorAny')}</option>
						<option value="false">{t('gallery.humorNo')}</option>
						<option value="true">{t('gallery.humorOnly')}</option>
					</select>
				</div>
			</details>
			<div className={`ugi-thumbs ${current.kind}`}>
				{list.map((image) =>
					// Animated images come with a video preview
					/\.(webm|mp4)(\?|$)/i.test(image.thumb) ? (
						<video key={image.id} className="ugi-thumb" src={image.thumb} autoPlay loop muted playsInline onClick={() => !g.busy && g.apply(image)} />
					) : (
						<img key={image.id} className="ugi-thumb" src={image.thumb} onClick={() => !g.busy && g.apply(image)} />
					),
				)}
				{!list.length && !g.status && <p className="ugi-muted">{t('gallery.empty')}</p>}
			</div>
		</div>
	);
}

// What is going on, and the actions on all images or the chosen type
export function GalleryActions({ g }: { g: GalleryModel }) {
	return (
		<>
			<span className="ugi-muted">{g.status || t('gallery.hint')}</span>
			<span className="ugi-sp" />
			<button className="ugi-link" onClick={g.clearCache}>{t('gallery.clearCache')}</button>
			<button className="ugi-btn secondary" disabled={g.busy} onClick={g.autoPick}>{t('auto.button')}</button>
			<button className="ugi-btn secondary" onClick={g.reset}>{t('gallery.reset')}</button>
		</>
	);
}

function Gallery({ appid, name, onClose }: { appid: number; name: string; onClose: () => void }) {
	const g = useGallery(appid);

	useEffect(() => {
		// Leaving the library (e.g. to the store) would hide the gallery while it still catches clicks
		const timer = setInterval(() => {
			if (!libraryVisible()) onClose();
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	const current = currentType(g);
	return (
		<div className="ugi-overlay" onClick={onClose}>
			<div className="ugi-win large" onClick={(e) => e.stopPropagation()}>
				<header>
					<h2>{name} · {t('gallery.title')}</h2>
					<span className="ugi-sp" />
					<GalleryOptions g={g} />
					<button className="ugi-btn secondary" onClick={onClose}>✕</button>
				</header>
				<div className="ugi-win-body">
					<nav className="ugi-types">
						{IMAGE_TYPES.map((x) => (
							<div key={x.type} className={`ugi-nav${x.type === g.type ? ' on' : ''}`} onClick={() => g.setType(x.type)}>
								<span>{x.label()}</span>
								<small>{g.images[x.type]?.length ?? ''}</small>
							</div>
						))}
						<div className="ugi-current">
							{t('gallery.current')}
							<div className={`ugi-im ${current.kind}`} key={`${g.type}-${g.version}`}>
								<SteamImage appid={appid} kind={current.kind} />
							</div>
						</div>
					</nav>
					<GalleryPicker g={g} />
				</div>
				<footer>
					<GalleryActions g={g} />
				</footer>
			</div>
		</div>
	);
}

// Opens the gallery over Steam in the given window (the one where the click happened)
export async function openGallery(appid: number, name: string, doc: Document, onClosed?: () => void) {
	const theme = (await loadState()).settings.theme ?? 'steam';
	if (bigPicture()) watchGamepad(doc);
	const host = doc.createElement('div');
	Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999' });
	Object.entries(themeStyle(theme)).forEach(([k, v]) => host.style.setProperty(k, v));
	doc.body.appendChild(host);
	const root = createRoot(host);
	const close = () => {
		root.unmount();
		host.remove();
		onClosed?.();
	};
	root.render(
		<div className="ugi-gallery-host" style={{ position: 'absolute', inset: 0, fontFamily: 'var(--ugi-font)', color: 'var(--ugi-text)' }}>
			<style>{UGI_CSS}</style>
			<Gallery appid={appid} name={name} onClose={close} />
		</div>,
	);
}
