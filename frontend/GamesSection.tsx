import React, { useEffect, useMemo, useState } from 'react';
import { SteamImage } from 'SteamImage';
import { GalleryActions, GalleryOptions, GalleryPicker, IMAGE_TYPES, useGallery } from 'Gallery';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { missingFor, replaceGame, searchGames } from 'sgdb';
import { infoCandidates, InfoCandidate, prefetchInfo } from 'gameInfo';
import { ImageKind, launcherName, launchShortcut } from 'steamApps';
import { syncCollections } from 'collections';
import { callable } from '@steambrew/client';
import { applyEntry, launchFields, usesLaunchHelper } from 'importer';
import { windowsDialog } from 'backend';
import { GameProfile, ImportedEntry, LaunchSettings, ProfileChoice, UgiState } from 'types';
import { ImagesProgress, watchImages } from 'imagesProgress';
import { backdrop } from 'backdrop';

type Row = ImportedEntry & { id: string };

// A game's window: its pictures, how it starts, what Steam does with it
const TABS = ['images', 'profile', 'launch', 'steam'] as const;

// The mosaic's order (the cover spans two rows)
const MOSAIC: ImageKind[] = ['grid', 'wide', 'logo', 'hero', 'icon'];

const pickProgram = callable<[], string>('ugi_pick_game');
const pickFolder = callable<[], string>('ugi_pick_folder');

const DEFAULT_CLOSED = 60;

// How the game starts, in one of these ways: through its launcher (for games added by hand: their
// program), its own program directly, or a command written by hand. Saved and applied to the shortcut.
type Mode = 'launcher' | 'direct' | 'custom';
const modeOf = (launch: LaunchSettings): Mode => (launch.command ? 'custom' : launch.direct ? 'direct' : 'launcher');

function LaunchTab({ row, overlay }: { row: Row; overlay: boolean }) {
	const manual = row.launcher === 'manual';
	const helper = usesLaunchHelper(row.launch_options);
	const modes: Mode[] = helper && !manual ? ['launcher', 'direct', 'custom'] : ['launcher', 'custom'];
	const [draft, setDraft] = useState<LaunchSettings>(row.launch ?? {});
	const [saved, setSaved] = useState<LaunchSettings>(row.launch ?? {});
	const [busy, setBusy] = useState(false);
	const mode = modeOf(draft);
	const set = (part: Partial<LaunchSettings>) => setDraft((d) => ({ ...d, ...part }));
	const commandOf = (launch: LaunchSettings) => {
		const fields = launchFields({ ...row, exe: row.exe ?? '', start_dir: row.start_dir ?? '', launch_options: row.launch_options ?? '', overlay: overlay ? undefined : false, launch: { ...launch, command: undefined } });
		return { exe: fields.exe, launch_options: fields.launch_options };
	};
	// The custom command starts from the one the current way makes
	const setMode = (next: Mode) => {
		if (next === mode) return;
		if (next === 'custom') set({ command: commandOf(draft) });
		else set({ command: undefined, direct: next === 'direct' || undefined });
	};
	const pickExe = async () => {
		try {
			const picked = JSON.parse((await windowsDialog(pickProgram, 'game')) || 'null');
			if (picked?.path) set({ exe: picked.path });
		} catch {}
	};
	const pickDir = async () => {
		const picked = await windowsDialog(pickFolder, 'folder');
		if (picked) set({ start_dir: picked });
	};
	const save = async (next: LaunchSettings) => {
		setBusy(true);
		try {
			const clean: LaunchSettings = {};
			const nextMode = modeOf(next);
			if (nextMode === 'custom' && next.command) {
				clean.command = { exe: next.command.exe.trim(), launch_options: next.command.launch_options.trim() };
			} else if (manual || nextMode === 'direct') {
				if (next.exe?.trim()) clean.exe = next.exe.trim();
				if (next.start_dir?.trim()) clean.start_dir = next.start_dir.trim();
				if (next.args?.trim()) clean.args = next.args.trim();
				if (nextMode === 'direct' && clean.exe) clean.direct = true;
			}
			if (helper && nextMode !== 'custom' && next.closed && next.closed !== DEFAULT_CLOSED) clean.closed = Math.max(5, Math.round(next.closed));
			const state = await loadState();
			const entry = state.imported[row.id];
			if (!entry) return;
			if (Object.keys(clean).length) entry.launch = clean;
			else delete entry.launch;
			applyEntry(row.id, entry);
			await saveState(state);
			row.launch = entry.launch;
			setSaved(clean);
			setDraft(clean);
		} catch (err) {
			console.error('[UGI] launch settings', err);
		} finally {
			setBusy(false);
		}
	};
	const changed = JSON.stringify(draft) !== JSON.stringify(saved);
	const invalid = (mode === 'direct' && !draft.exe?.trim()) || (mode === 'custom' && !draft.command?.exe.trim());
	const label = (m: Mode) => (m === 'launcher' ? (manual ? t('launch.mode.program') : t('launch.mode.launcher', { launcher: launcherName(row.launcher) })) : t(`launch.mode.${m}`));
	const command = commandOf(draft);
	return (
		<div className="ugi-win-pane">
			<div className="ugi-set compact column">
				<strong>{t('launch.how')}</strong>
				<div className="ugi-modes">
					{modes.map((m) => (
						<span key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
							<i />
							{label(m)}
						</span>
					))}
				</div>
			</div>
			{mode === 'launcher' && !manual && !helper && <p className="ugi-muted">{t('launch.none')}</p>}
			{(mode === 'direct' || (mode === 'launcher' && manual)) && (
				<>
					<div className="ugi-set compact column">
						<strong>{t('launch.program')}</strong>
						<div className="ugi-field">
							<input type="text" value={draft.exe ?? ''} placeholder={manual ? row.exe : t('launch.programHint')} onChange={(e) => set({ exe: e.target.value })} />
							<button className="ugi-btn secondary" onClick={pickExe}>{t('launch.choose')}</button>
						</div>
					</div>
					<div className="ugi-set compact column">
						<strong>{t('launch.folder')}</strong>
						<div className="ugi-field">
							<input type="text" value={draft.start_dir ?? ''} placeholder={t('launch.folderHint')} onChange={(e) => set({ start_dir: e.target.value })} />
							<button className="ugi-btn secondary" onClick={pickDir}>{t('launch.choose')}</button>
						</div>
					</div>
					<div className="ugi-set compact column">
						<strong>{t('launch.args')}</strong>
						<div className="ugi-field">
							<input type="text" value={draft.args ?? ''} placeholder="-windowed" onChange={(e) => set({ args: e.target.value })} />
						</div>
					</div>
					{mode === 'direct' && <p className="ugi-muted">⚠ {t('launch.directText', { launcher: launcherName(row.launcher) })}</p>}
				</>
			)}
			{mode === 'custom' && draft.command && (
				<>
					<div className="ugi-set compact column">
						<strong>{t('launch.target')}</strong>
						<div className="ugi-field">
							<input type="text" value={draft.command.exe} onChange={(e) => set({ command: { ...draft.command!, exe: e.target.value } })} />
						</div>
					</div>
					<div className="ugi-set compact column">
						<strong>{t('launch.options')}</strong>
						<small>{t('launch.customText')}</small>
						<div className="ugi-field">
							<textarea rows={3} value={draft.command.launch_options} onChange={(e) => set({ command: { ...draft.command!, launch_options: e.target.value } })} />
						</div>
					</div>
				</>
			)}
			{helper && mode !== 'custom' && (
				<div className="ugi-set compact">
					<div>
						<strong>{t('launch.closed')}</strong>
						<small>{t('launch.closedText')}</small>
					</div>
					<div className="ugi-field narrow">
						<input type="number" min={5} value={draft.closed ?? DEFAULT_CLOSED} onChange={(e) => set({ closed: Number(e.target.value) || DEFAULT_CLOSED })} />
					</div>
				</div>
			)}
			{mode !== 'custom' && (
				<div className="ugi-kv">
					{t('detail.command')}: <code>{`"${command.exe}" ${command.launch_options}`.trim()}</code>
				</div>
			)}
			<div className="ugi-foot left">
				<button className="ugi-btn primary" disabled={busy || !changed || invalid} onClick={() => save(draft)}>{t('launch.save')}</button>
				<button className="ugi-btn secondary" disabled={busy || !Object.keys(saved).length} onClick={() => save({})}>{t('launch.reset')}</button>
			</div>
		</div>
	);
}

// The right game when the name alone finds another one with the same name: one list for where the
// information comes from (Steam store pages, RAWG games), one for SteamGridDB's game (the images).
// A choice is saved at once; a new SteamGridDB game also picks the game's images again.
function ProfileTab({ row, onImages }: { row: Row; onImages: () => void }) {
	const [query, setQuery] = useState(row.name);
	const [profile, setProfile] = useState<GameProfile>(row.profile ?? {});
	const [info, setInfo] = useState<InfoCandidate[] | null>(null);
	const [games, setGames] = useState<ProfileChoice[] | null>(null);
	const [keys, setKeys] = useState({ rawg: false, sgdb: false });
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const search = async (name: string) => {
		const state = await loadState();
		setKeys({ rawg: !!state.settings.rawg_key, sgdb: !!state.settings.sgdb_key });
		setInfo(null);
		setGames(null);
		infoCandidates(state, name).then(setInfo, () => setInfo([]));
		if (state.settings.sgdb_key) searchGames(state, name).then(setGames, () => setGames([]));
		else setGames([]);
	};
	useEffect(() => {
		search(row.name);
	}, []);
	const save = async (change: (p: GameProfile) => void) => {
		const state = await loadState();
		const entry = state.imported[row.id];
		if (!entry) return null;
		const next: GameProfile = { ...(entry.profile ?? {}) };
		change(next);
		if (next.info || next.sgdb) entry.profile = next;
		else delete entry.profile;
		row.profile = entry.profile;
		setProfile(next);
		return state;
	};
	const chooseInfo = async (choice: InfoCandidate | null) => {
		const state = await save((p) => {
			if (choice) p.info = { source: choice.source, id: choice.id, name: choice.name, ...(choice.year ? { year: choice.year } : {}) };
			else delete p.info;
		});
		if (!state) return;
		await saveState(state);
		setStatus(t('profile.infoDone'));
		prefetchInfo(state, [row.id]);
	};
	const chooseGame = async (choice: ProfileChoice | null) => {
		setBusy(true);
		setStatus(t('profile.imagesBusy'));
		try {
			const state = await save((p) => {
				if (choice) p.sgdb = { id: choice.id, name: choice.name, ...(choice.year ? { year: choice.year } : {}) };
				else delete p.sgdb;
			});
			if (!state) return;
			await saveState(state);
			const n = await replaceGame(state, row.appid);
			await saveState(state);
			setStatus(t('profile.imagesDone', { n }));
			onImages();
		} catch (err) {
			console.error('[UGI] profile images', err);
			setStatus(t('gallery.error'));
		} finally {
			setBusy(false);
		}
	};
	const year = (c: { year?: string }) => (c.year ? ` (${c.year})` : '');
	const list = <T extends ProfileChoice>(items: T[] | null, chosen: ProfileChoice | undefined, same: (c: T) => boolean, choose: (c: T | null) => void, image?: (c: T) => React.ReactNode, note?: (c: T) => string) => (
		<div className="ugi-choice-list">
			<div className={`ugi-choice${chosen ? '' : ' on'}`} onClick={() => !busy && chosen && choose(null)}>
				<i />
				<span>{t('profile.auto')}</span>
			</div>
			{chosen && !items?.some(same) && (
				<div className="ugi-choice on">
					<i />
					<span>{chosen.name}{year(chosen)}</span>
				</div>
			)}
			{items === null && <p className="ugi-muted">{t('profile.loading')}</p>}
			{items?.length === 0 && <p className="ugi-muted">{t('profile.none')}</p>}
			{items?.map((c) => (
				<div key={`${(c as any).source ?? 'sgdb'}:${c.id}`} className={`ugi-choice${same(c) ? ' on' : ''}`} onClick={() => !busy && !same(c) && choose(c)}>
					<i />
					{image?.(c)}
					<span>
						{c.name}{year(c)}
						{note && <small>{note(c)}</small>}
					</span>
				</div>
			))}
		</div>
	);
	return (
		<div className="ugi-win-pane">
			<p className="ugi-muted">{t('profile.text')}</p>
			<div className="ugi-field">
				<input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query.trim() && search(query.trim())} />
				<button className="ugi-btn secondary" disabled={!query.trim()} onClick={() => search(query.trim())}>{t('profile.search')}</button>
			</div>
			<div className="ugi-profile">
				<div>
					<strong>{t('profile.info')}</strong>
					{list(
						info,
						profile.info,
						(c) => profile.info?.source === c.source && profile.info.id === c.id,
						chooseInfo,
						(c) => (c.image ? <img src={c.image} /> : <b />),
						(c) => (c.source === 'steam' ? 'Steam' : `RAWG${c.platforms ? ` · ${c.platforms}` : ''}`),
					)}
					{!keys.rawg && <p className="ugi-muted">{t('profile.noRawg')}</p>}
				</div>
				<div>
					<strong>{t('profile.images')}</strong>
					{keys.sgdb ? list(games, profile.sgdb, (c) => profile.sgdb?.id === c.id, chooseGame) : <p className="ugi-muted">{t('profile.noSgdb')}</p>}
				</div>
			</div>
			{status && <p className="ugi-muted">{status}</p>}
		</div>
	);
}

function Detail({ row, missing, onClose, onRemoved, onImages }: { row: Row; missing: number[]; onClose: () => void; onRemoved: () => void; onImages: () => void }) {
	const [missingNow, setMissingNow] = useState(missing);
	const [tab, setTab] = useState<(typeof TABS)[number]>('images');
	const refresh = async () => {
		onImages();
		// Steam writes the new images in the background: count the missing ones once they are there
		await new Promise((r) => setTimeout(r, 2000));
		setMissingNow((await missingFor([row.appid]))[String(row.appid)] ?? []);
	};
	const g = useGallery(row.appid, refresh);
	const [overlay, setOverlay] = useState(row.overlay !== false);
	const changeOverlay = async (on: boolean) => {
		const state = await loadState();
		const entry = state.imported[row.id];
		if (!entry) return;
		if (on) delete entry.overlay;
		else entry.overlay = false;
		applyEntry(row.id, entry);
		await saveState(state);
		setOverlay(on);
	};
	const remove = async () => {
		const state = await loadState();
		SteamClient.Apps.RemoveShortcut(row.appid);
		delete state.imported[row.id];
		// Removed on purpose: don't offer it again as a new game
		state.excluded[row.id] = true;
		// Its launcher's collection may be left empty
		await syncCollections(state).catch((err) => console.error('[UGI] collections', err));
		await saveState(state);
		onRemoved();
	};
	// A picture of the mosaic: clicked, the images on the right are for its type
	const tile = (kind: ImageKind) => {
		const info = IMAGE_TYPES.find((x) => x.kind === kind)!;
		return (
			<div className={`ugi-im ${kind} clickable${g.type === info.type ? ' on' : ''}`} title={t('detail.changeImage')} key={`${kind}-${g.version}`} onClick={() => g.setType(info.type)}>
				<SteamImage appid={row.appid} kind={kind} />
				<span>{info.label()}</span>
			</div>
		);
	};
	return (
		<div className="ugi-overlay" {...backdrop(onClose)}>
			<div className="ugi-win large" onClick={(e) => e.stopPropagation()}>
				<header>
					<div>
						<h2>{row.name}</h2>
						<span className="ugi-muted">{launcherName(row.launcher)}</span>
					</div>
					<span className="ugi-sp" />
					<button className="ugi-btn primary" onClick={() => launchShortcut(row.appid)}>{t('detail.play')}</button>
					<button className="ugi-btn danger" onClick={remove}>{t('detail.remove')}</button>
					<button className="ugi-btn secondary" onClick={onClose}>✕</button>
				</header>
				<div className="ugi-tabs pad">
					{TABS.map((id) => (
						<span key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(`detail.tab.${id}`)}</span>
					))}
				</div>
				{tab === 'images' && (
					<>
						<div className="ugi-win-body">
							<div className="ugi-mosaic">
								<div className="ugi-imgs">{MOSAIC.map(tile)}</div>
								<p className="ugi-muted">{missingNow.length ? t('detail.missing', { n: missingNow.length }) : t('detail.complete')}</p>
							</div>
							<GalleryPicker g={g} top={<GalleryOptions g={g} />} />
						</div>
						<footer>
							<GalleryActions g={g} />
						</footer>
					</>
				)}
				{tab === 'profile' && <ProfileTab row={row} onImages={() => { g.reload(); refresh(); }} />}
				{tab === 'launch' && <LaunchTab row={row} overlay={overlay} />}
				{tab === 'steam' && (
					<div className="ugi-win-pane">
						{usesLaunchHelper(row.launch_options) ? (
							<div className="ugi-set compact">
								<div>
									<strong>{t('detail.overlay')}</strong>
									<small>{t('detail.overlayText')}</small>
								</div>
								<span className={`ugi-switch${overlay ? ' on' : ''}`} onClick={() => changeOverlay(!overlay)}>
									<span className="ugi-tog" />
								</span>
							</div>
						) : (
							<p className="ugi-muted">{t('detail.noSteamSettings')}</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

export default function GamesSection({ state, onChanged }: { state: UgiState; onChanged: () => void }) {
	const [filter, setFilter] = useState<string>('all');
	const [search, setSearch] = useState('');
	const [view, setView] = useState<'grid' | 'list'>('grid');
	const [missing, setMissing] = useState<Record<string, number[]>>({});
	const [open, setOpen] = useState<Row | null>(null);
	// Bumped when images change, so the covers load again
	const [version, setVersion] = useState(0);

	const rows: Row[] = useMemo(
		() => Object.entries(state.imported).map(([id, e]) => ({ ...e, id })).sort((a, b) => a.name.localeCompare(b.name)),
		[state],
	);
	// Games still getting their images after an import
	const [images, setImages] = useState<ImagesProgress>({ pending: [], round: 0 });
	useEffect(() => watchImages(setImages), []);
	useEffect(() => {
		missingFor(rows.map((r) => r.appid)).then(setMissing);
	}, [rows, images.round]);
	const loading = (r: Row) => {
		const index = images.pending.indexOf(r.appid);
		if (index < 0) return null;
		return (
			<div className={`ugi-loading${index ? ' waiting' : ''}`}>
				<div className="ugi-spinner" />
				<span>{index ? t('cover.waiting') : t('cover.downloading')}</span>
			</div>
		);
	};

	const launchers = [...new Set(rows.map((r) => r.launcher))];
	const visible = rows.filter((r) => (filter === 'all' || r.launcher === filter) && r.name.toLowerCase().includes(search.toLowerCase()));
	const missingOf = (r: Row) => missing[String(r.appid)] ?? [];

	if (!rows.length) return <p className="ugi-muted">{t('games.empty')}</p>;

	return (
		<>
			<div className="ugi-toolbar">
				<span className={`ugi-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>{t('games.all')} {rows.length}</span>
				{launchers.map((l) => (
					<span key={l} className={`ugi-chip${filter === l ? ' on' : ''}`} onClick={() => setFilter(l)}>
						{launcherName(l)} {rows.filter((r) => r.launcher === l).length}
					</span>
				))}
				<input className="ugi-search" placeholder={t('games.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
				<div className="ugi-seg">
					<span className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>{t('games.grid')}</span>
					<span className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t('games.list')}</span>
				</div>
			</div>
			{view === 'grid' ? (
				<div className="ugi-grid">
					{visible.map((r) => (
						<div key={`${r.id}-${version}-${images.round}`} className="ugi-game" onClick={() => setOpen(r)}>
							<SteamImage appid={r.appid} kind="grid" className="ugi-cover" label={r.name} />
							{loading(r)}
							<span className="ugi-badge">{launcherName(r.launcher)}</span>
						</div>
					))}
				</div>
			) : (
				<div>
					{visible.map((r) => (
						<div key={`${r.id}-${version}-${images.round}`} className="ugi-row" onClick={() => setOpen(r)}>
							<SteamImage appid={r.appid} kind="grid" className="ugi-mini" />
							<span>{r.name}</span>
							<span className="ugi-muted">{launcherName(r.launcher)}</span>
							<span className="ugi-muted">{images.pending.includes(r.appid) ? t('cover.downloading') : missingOf(r).length ? t('games.imagesMissing') : t('games.imagesComplete')}</span>
						</div>
					))}
				</div>
			)}
			{open && (
				<Detail
					row={open}
					missing={missingOf(open)}
					onClose={() => setOpen(null)}
					onImages={() => {
						// Steam writes the new images in the background: load the covers again once they are there
						for (const ms of [0, 2000, 5000]) setTimeout(() => setVersion((v) => v + 1), ms);
						setTimeout(() => missingFor(rows.map((r) => r.appid)).then(setMissing), 2000);
					}}
					onRemoved={() => {
						setOpen(null);
						onChanged();
					}}
				/>
			)}
		</>
	);
}
