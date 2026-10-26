import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { applyImage, FILTER_OPTIONS, gameIdFor, imagesFor, ImageType, resetImage, SgdbImage, UserFilter } from 'sgdb';
import { ImageKind } from 'steamApps';
import { SteamImage } from 'SteamImage';
import { themeStyle, UGI_CSS } from 'theme';
import { UgiState } from 'types';
import { libraryVisible } from 'location';

const TYPES: { type: ImageType; kind: ImageKind; label: () => string }[] = [
	{ type: 0, kind: 'grid', label: () => t('image.grid') },
	{ type: 3, kind: 'wide', label: () => t('image.wide') },
	{ type: 1, kind: 'hero', label: () => t('image.hero') },
	{ type: 2, kind: 'logo', label: () => t('image.logo') },
	{ type: 4, kind: 'icon', label: () => t('image.icon') },
];

function Gallery({ appid, name, onClose }: { appid: number; name: string; onClose: () => void }) {
	const [state, setState] = useState<UgiState | null>(null);
	const [type, setType] = useState<ImageType>(0);
	const [animated, setAnimated] = useState(false);
	const [images, setImages] = useState<Record<string, SgdbImage[]>>({});
	const [gameId, setGameId] = useState<number | null>(null);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		loadState().then((s) => {
			setState(s);
			setAnimated(!!s.settings.animated);
		});
		// Leaving the library (e.g. to the store) would hide the gallery while it still catches clicks
		const timer = setInterval(() => {
			if (!libraryVisible()) onClose();
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	// Loads the lists for all five types (the counts are shown on the left)
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
			for (const { type: ty } of TYPES) lists[ty] = await imagesFor(s, id, ty, anim ? 'animated' : 'static');
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
		setVersion(version + 1);
		setBusy(false);
	};

	const reset = async () => {
		await resetImage(appid, type);
		setVersion(version + 1);
	};

	const clearCache = async () => {
		const s = await loadState();
		delete s.sgdb_ids[String(appid)];
		await saveState(s);
		setState(s);
	};

	const openWebsite = () => {
		if (gameId) (SteamClient as any).System?.OpenInSystemBrowser?.(`https://www.steamgriddb.com/game/${gameId}`);
	};

	const options = FILTER_OPTIONS[type];
	const current = TYPES.find((x) => x.type === type)!;
	const list = images[type] ?? [];

	return (
		<div className="ugi-overlay" onClick={onClose}>
			<div className="ugi-win" onClick={(e) => e.stopPropagation()}>
				<header>
					<h2>{name} · {t('gallery.title')}</h2>
					<span className="ugi-sp" />
					<label className={`ugi-switch${animated ? ' on' : ''}`} onClick={() => setAnimated(!animated)}>
						<span className="ugi-tog" />
						{t('gallery.animated')}
					</label>
					<span className="ugi-sp" />
					<button className="ugi-btn secondary" disabled={!gameId} onClick={openWebsite}>{t('gallery.website')}</button>
					<button className="ugi-btn secondary" onClick={onClose}>✕</button>
				</header>
				<div className="ugi-win-body">
					<nav className="ugi-types">
						{TYPES.map((x) => (
							<div key={x.type} className={`ugi-nav${x.type === type ? ' on' : ''}`} onClick={() => setType(x.type)}>
								<span>{x.label()}</span>
								<small>{images[x.type]?.length ?? ''}</small>
							</div>
						))}
						<div className="ugi-current">
							{t('gallery.current')}
							<div className={`ugi-im ${current.kind}`} key={`${type}-${version}`}>
								<SteamImage appid={appid} kind={current.kind} />
							</div>
						</div>
					</nav>
					<div className="ugi-pick">
						<details className="ugi-filters" open>
							<summary>{t('gallery.filters', { type: current.label() })}</summary>
							<div className="ugi-filter-row">
								<select value={filter.style ?? ''} onChange={(e) => setFilter({ style: e.target.value })}>
									<option value="">{t('gallery.styleAll')}</option>
									{options.styles.map((s) => <option key={s} value={s}>{s}</option>)}
								</select>
								{options.dimensions.length > 0 && (
									<select value={filter.dimension ?? 'default'} onChange={(e) => setFilter({ dimension: e.target.value === 'default' ? undefined : e.target.value })}>
										<option value="default">{t('gallery.dimDefault')}</option>
										<option value="">{t('gallery.dimAll')}</option>
										{options.dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
									</select>
								)}
								{type !== 4 && (
									<select value={(filter.webp ?? state?.settings.webp) ? 'webp' : 'basic'} onChange={(e) => setFilter({ webp: e.target.value === 'webp' })}>
										<option value="basic">{t('gallery.formatBasic')}</option>
										<option value="webp">{t('gallery.formatWebp')}</option>
									</select>
								)}
								<select value={filter.nsfw ?? ''} onChange={(e) => setFilter({ nsfw: e.target.value })}>
									<option value="">{t('gallery.nsfwNo')}</option>
									<option value="true">{t('gallery.nsfwOnly')}</option>
									<option value="any">{t('gallery.nsfwAny')}</option>
								</select>
								<select value={filter.humor ?? ''} onChange={(e) => setFilter({ humor: e.target.value })}>
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
									<video key={image.id} className="ugi-thumb" src={image.thumb} autoPlay loop muted playsInline onClick={() => !busy && apply(image)} />
								) : (
									<img key={image.id} className="ugi-thumb" src={image.thumb} onClick={() => !busy && apply(image)} />
								),
							)}
							{!list.length && !status && <p className="ugi-muted">{t('gallery.empty')}</p>}
						</div>
					</div>
				</div>
				<footer>
					<span className="ugi-muted">{status || t('gallery.hint')}</span>
					<span className="ugi-sp" />
					<button className="ugi-link" onClick={clearCache}>{t('gallery.clearCache')}</button>
					<button className="ugi-btn secondary" onClick={reset}>{t('gallery.reset')}</button>
				</footer>
			</div>
		</div>
	);
}

// Opens the gallery over Steam in the given window (the one where the click happened)
export async function openGallery(appid: number, name: string, doc: Document, onClosed?: () => void) {
	const theme = (await loadState()).settings.theme ?? 'steam';
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
