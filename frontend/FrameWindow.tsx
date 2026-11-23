// The window where a cover frame is chosen: for a launcher (Launchers section) or for one game (its
// Images tab). See frames.ts.
import React, { useEffect, useState } from 'react';
import { importedKeyFor, loadState, saveState } from 'backend';
import { t } from 'i18n';
import { backdrop } from 'backdrop';
import { collectionFrameInfo, CoverType, FrameGroup, FRAME_SOURCES, hasBadge, iconsFor, reframe, Template, templateSource, templatesFor } from 'frames';
import { LAUNCHER_NAMES } from 'steamApps';
import { FrameChoice, UgiState } from 'types';

type Mode = 'inherit' | FrameChoice['kind'];

/** The name of a frame choice, for buttons and lists (undefined: the launcher's) */
export function frameLabel(choice: FrameChoice | undefined): string {
	if (!choice) return t('frame.inherit');
	return choice.kind === 'badge' ? t('frame.badge') : choice.kind === 'template' ? t('frame.template') : t('frame.none');
}

const sourceName = (id: string) => FRAME_SOURCES[id]?.name ?? LAUNCHER_NAMES[id] ?? id;

// The template sources by group, as the list shows them: launchers by name, consoles newest first
const GROUPS: FrameGroup[] = ['launcher', 'nintendo', 'playstation', 'xbox', 'sega', 'atari', 'other'];
const groupName = (g: FrameGroup) => (g === 'launcher' ? t('nav.launchers') : g === 'other' ? t('frame.otherPlatforms') : { nintendo: 'Nintendo', playstation: 'PlayStation', xbox: 'Xbox', sega: 'Sega', atari: 'Atari' }[g]);
const sourcesOf = (g: FrameGroup) => {
	const ids = Object.keys(FRAME_SOURCES).filter((id) => FRAME_SOURCES[id]!.group === g);
	return g === 'launcher' ? ids.sort((a, b) => sourceName(a).localeCompare(sourceName(b))) : ids;
};

// Pictures to choose from (templates or icons), loaded from SteamGridDB. none: the label of a first tile that chooses nothing
function Choices({ load, kind, title, chosen, none, onChoose }: { load: { key: string; get: (s: UgiState) => Promise<Template[]> }; kind: string; title?: string; chosen?: string; none?: string; onChoose: (url?: string) => void }) {
	const [list, setList] = useState<Template[] | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		setList(null);
		setError('');
		let live = true;
		loadState()
			.then(load.get)
			.then((found) => live && setList(found))
			.catch((err) => live && setError(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error')));
		return () => {
			live = false;
		};
	}, [load.key]);
	// Without a "none" tile, nothing chosen means the first one (frames.ts takes the first icon)
	const active = chosen ?? (none ? undefined : list?.[0]?.url);
	return (
		<>
			{title && <h4 className="ugi-frame-head">{title}</h4>}
			<div className={`ugi-thumbs ugi-frame-thumbs ${kind}`}>
				{none && (
					<div className={`ugi-thumb ugi-frame-off${chosen ? '' : ' on'}`} onClick={() => onChoose(undefined)}>
						{none}
					</div>
				)}
				{list?.map((x) => <img key={x.url} className={`ugi-thumb ugi-frame-tpl${active === x.url ? ' on' : ''}`} src={x.thumb} onClick={() => onChoose(x.url)} />)}
			</div>
			{!list && !error && <p className="ugi-muted">{t('frame.loading')}</p>}
			{error && <p className="ugi-muted">{error}</p>}
			{list && !list.length && <p className="ugi-muted">{t('frame.empty')}</p>}
		</>
	);
}

/**
 * title: what the frame is for (a launcher's or a game's name). launcher: the game's or the
 * launcher's id (none for games added by hand). inherit: what a game follows without a frame of its
 * own (its collection's or its launcher's; shown only for a game). source: where the templates are looked
 * for at first. onSave: puts the frame on the covers; progress(done, total) while it works.
 */
export function FrameWindow({
	title,
	launcher,
	value,
	inherit,
	source: firstSource,
	onSave,
	onClose,
}: {
	title: string;
	launcher?: string;
	value: FrameChoice | undefined;
	inherit?: { name: string; current?: FrameChoice; collection?: boolean };
	source?: string;
	onSave: (choice: FrameChoice | undefined, progress: (done: number, total: number) => void) => Promise<void>;
	onClose: () => void;
}) {
	const [mode, setMode] = useState<Mode>(value ? value.kind : inherit ? 'inherit' : 'none');
	const [v, setV] = useState(value?.kind === 'template' ? value.v : undefined);
	const [h, setH] = useState(value?.kind === 'template' ? value.h : undefined);
	const [icon, setIcon] = useState(value?.kind === 'badge' ? value.icon : undefined);
	const [source, setSource] = useState(firstSource ?? templateSource(launcher));
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);

	const modes: Mode[] = [...(inherit ? (['inherit'] as Mode[]) : []), 'none', ...(hasBadge(launcher) ? (['badge'] as Mode[]) : []), 'template'];
	const label = (m: Mode) => (m === 'inherit' ? (inherit?.collection ? t('frame.inheritCollectionShort') : t('frame.inherit')) : frameLabel({ kind: m } as FrameChoice));

	const save = async () => {
		const choice: FrameChoice | undefined = mode === 'inherit' ? undefined : mode === 'template' ? { kind: 'template', v, h } : mode === 'badge' ? { kind: 'badge', icon } : { kind: mode };
		setBusy(true);
		try {
			await onSave(choice, (done, total) => setStatus(total > 1 ? t('frame.applying', { done, total }) : t('frame.applyingOne')));
			onClose();
		} catch (err) {
			setStatus(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error'));
			setBusy(false);
		}
	};

	return (
		<div className="ugi-overlay" {...backdrop(() => !busy && onClose())}>
			<div className="ugi-win large" onClick={(e) => e.stopPropagation()}>
				<header>
					<h2>{title} · {t('frame.title')}</h2>
					<span className="ugi-sp" />
					<button className="ugi-btn secondary" disabled={busy} onClick={onClose}>✕</button>
				</header>
				<div className="ugi-pick-bar">
					<div className="ugi-seg">
						{modes.map((m) => (
							<span key={m} className={mode === m ? 'on' : ''} onClick={() => !busy && setMode(m)}>{label(m)}</span>
						))}
					</div>
					{mode === 'template' && (
						<label className="ugi-frame-source">
							{t('frame.from')}
							<select value={source} onChange={(e) => setSource(e.target.value)}>
								{GROUPS.map((g) => (
									<optgroup key={g} label={groupName(g)}>
										{sourcesOf(g).map((id) => (
											<option key={id} value={id}>{sourceName(id)}</option>
										))}
									</optgroup>
								))}
							</select>
						</label>
					)}
				</div>
				<div className="ugi-frame-body">
					{/* The launcher has a frame: the one chosen here is for this game only */}
					{mode !== 'inherit' && inherit?.current && inherit.current.kind !== 'none' && (
						<p className="ugi-launcher-warn ugi-frame-note">⚠ {inherit.collection ? t('frame.gameOnlyCollection', { collection: inherit.name, frame: frameLabel(inherit.current) }) : t('frame.gameOnly', { launcher: sourceName(inherit.name), frame: frameLabel(inherit.current) })}</p>
					)}
					{mode === 'inherit' && inherit && (
						<p className="ugi-muted">
							{inherit.collection
								? t('frame.inheritCollection', { collection: inherit.name, frame: frameLabel(inherit.current ?? { kind: 'none' }) })
								: t('frame.inheritHint', { launcher: sourceName(inherit.name), frame: frameLabel(inherit.current ?? { kind: 'none' }) })}
						</p>
					)}
					{mode === 'none' && <p className="ugi-muted">{t('frame.noneHint')}</p>}
					{mode === 'badge' && launcher && (
						<>
							<p className="ugi-muted">{t('frame.badgeHint')}</p>
							<Choices load={{ key: `icon:${launcher}`, get: (s) => iconsFor(s, launcher) }} kind="icon" chosen={icon} onChoose={setIcon} />
						</>
					)}
					{mode === 'template' && (
						<>
							{([0, 3] as CoverType[]).map((type) => (
								<Choices
									key={type}
									load={{ key: `${source}:${type}`, get: (s) => templatesFor(s, source, type) }}
									kind={type === 0 ? 'grid' : 'wide'}
									title={type === 0 ? t('frame.vertical') : t('frame.horizontal')}
									chosen={type === 0 ? v : h}
									none={t('frame.noFrame')}
									onChoose={type === 0 ? setV : setH}
								/>
							))}
						</>
					)}
				</div>
				<footer>
					<span className="ugi-muted">{status || t('frame.hint')}</span>
					<span className="ugi-sp" />
					<button className="ugi-btn secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
					<button className="ugi-btn primary" disabled={busy} onClick={save}>{t('frame.apply')}</button>
				</footer>
			</div>
		</div>
	);
}

/**
 * A game's own cover frame: the button that shows it, and the window that changes it (drawn where the
 * caller puts it, over its whole window). Nothing for games UGI didn't import. onChanged: after the
 * covers were drawn again.
 */
export function useGameFrame(appid: number, name: string, onChanged?: () => void): { button: React.ReactNode; window: React.ReactNode } {
	// own: the game's frame; inherited: what it follows without one (its collection's, else its launcher's)
	const [info, setInfo] = useState<{ key: string; launcher: string; own?: FrameChoice; inherited?: { name: string; current?: FrameChoice; collection?: boolean } } | null>(null);
	const [open, setOpen] = useState(false);
	const read = () =>
		loadState().then((s) => {
			const key = importedKeyFor(s, appid);
			const entry = key ? s.imported[key] : undefined;
			if (!key || !entry) return setInfo(null);
			const collection = collectionFrameInfo(s, appid);
			const inherited = collection
				? { name: collection.name, current: collection.frame, collection: true }
				: entry.launcher === 'manual'
					? undefined
					: { name: entry.launcher, current: s.settings.launchers?.[entry.launcher]?.frame };
			setInfo({ key, launcher: entry.launcher, own: entry.frame, inherited });
		});
	useEffect(() => {
		read();
	}, [appid]);
	if (!info) return { button: null, window: null };

	const manual = info.launcher === 'manual';
	const save = async (choice: FrameChoice | undefined, progress: (done: number, total: number) => void) => {
		const s = await loadState();
		const entry = s.imported[info.key];
		if (!entry) return;
		if (choice) entry.frame = choice;
		else delete entry.frame;
		await saveState(s);
		progress(0, 1);
		await reframe(s, appid);
		await saveState(s);
		await read();
		onChanged?.();
	};
	const inherited = info.inherited;
	const label =
		info.own || !inherited
			? frameLabel(info.own ?? { kind: 'none' })
			: `${inherited.collection ? t('frame.inheritCollectionShort') : t('frame.inherit')} (${frameLabel(inherited.current ?? { kind: 'none' })})`;
	return {
		button: (
			<button className="ugi-btn secondary ugi-frame-btn" onClick={() => setOpen(true)}>
				{t('frame.title')}: {label}
			</button>
		),
		window: open ? (
			<FrameWindow
				title={name}
				launcher={manual ? undefined : info.launcher}
				value={info.own}
				inherit={inherited}
				onSave={save}
				onClose={() => setOpen(false)}
			/>
		) : null,
	};
}
