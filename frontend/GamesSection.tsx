import React, { useEffect, useMemo, useState } from 'react';
import { SteamImage } from 'SteamImage';
import { GalleryActions, GalleryOptions, GalleryPicker, IMAGE_TYPES, useGallery } from 'Gallery';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { missingFor } from 'sgdb';
import { ImageKind, launcherName, launchShortcut } from 'steamApps';
import { syncCollections } from 'collections';
import { callable } from '@steambrew/client';
import { applyEntry, launchFields, usesLaunchHelper } from 'importer';
import { unquote } from 'backend';
import { ImportedEntry, LaunchSettings, UgiState } from 'types';
import { ImagesProgress, watchImages } from 'imagesProgress';
import { backdrop } from 'backdrop';

type Row = ImportedEntry & { id: string };

// A game's window: its pictures, how it starts, what Steam does with it
const TABS = ['images', 'launch', 'steam'] as const;

// The mosaic's order (the cover spans two rows)
const MOSAIC: ImageKind[] = ['grid', 'wide', 'logo', 'hero', 'icon'];

const pickProgram = callable<[], string>('ugi_pick_game');
const pickFolder = callable<[], string>('ugi_pick_folder');

const DEFAULT_CLOSED = 60;

// How the game starts. Launcher games: through their launcher, or their own program directly; games
// added by hand: their program, folder and arguments. Saved and applied to the shortcut at once.
function LaunchTab({ row, overlay }: { row: Row; overlay: boolean }) {
	const manual = row.launcher === 'manual';
	const helper = usesLaunchHelper(row.launch_options);
	const [draft, setDraft] = useState<LaunchSettings>(row.launch ?? {});
	const [saved, setSaved] = useState<LaunchSettings>(row.launch ?? {});
	const [busy, setBusy] = useState(false);
	// Changing a setting makes the command again from the settings
	const set = (part: Partial<LaunchSettings>) => setDraft((d) => ({ ...d, command: undefined, ...part }));
	const pickExe = async () => {
		try {
			const picked = JSON.parse(unquote(await pickProgram()) || 'null');
			if (picked?.path) set({ exe: picked.path });
		} catch {}
	};
	const pickDir = async () => {
		const picked = unquote(await pickFolder());
		if (picked) set({ start_dir: picked });
	};
	const commandOf = (launch: LaunchSettings) => {
		const fields = launchFields({ ...row, exe: row.exe ?? '', start_dir: row.start_dir ?? '', launch_options: row.launch_options ?? '', overlay: overlay ? undefined : false, launch: { ...launch, command: undefined } });
		return { exe: fields.exe, launch_options: fields.launch_options };
	};
	const save = async (next: LaunchSettings) => {
		setBusy(true);
		try {
			const clean: LaunchSettings = {};
			if (next.exe?.trim()) clean.exe = next.exe.trim();
			if (next.start_dir?.trim()) clean.start_dir = next.start_dir.trim();
			if (next.args?.trim()) clean.args = next.args.trim();
			if (next.closed && next.closed !== DEFAULT_CLOSED) clean.closed = Math.max(5, Math.round(next.closed));
			if (!manual && next.direct && clean.exe) clean.direct = true;
			// A command written by hand is kept only when it differs from the one the settings make
			if (next.command) {
				const made = commandOf(clean);
				if (next.command.exe.trim() !== made.exe || next.command.launch_options.trim() !== made.launch_options) {
					clean.command = { exe: next.command.exe.trim(), launch_options: next.command.launch_options.trim() };
				}
			}
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
	// The command shown: the one written by hand, or the one the saved settings make
	const shown = draft.command ?? commandOf(saved);
	const editCommand = (part: Partial<{ exe: string; launch_options: string }>) => set({ command: { ...shown, ...part } });
	const program = (
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
		</>
	);
	return (
		<div className="ugi-win-pane">
			<div className="ugi-kv">
				{t('detail.launcher')}: <code>{launcherName(row.launcher)}</code>
			</div>
			{manual ? (
				program
			) : helper ? (
				<>
					<div className="ugi-set compact">
						<div>
							<strong>{t('launch.direct')}</strong>
							<small>{t('launch.directText', { launcher: launcherName(row.launcher) })}</small>
						</div>
						<span className={`ugi-switch${draft.direct ? ' on' : ''}`} onClick={() => set({ direct: !draft.direct })}>
							<span className="ugi-tog" />
						</span>
					</div>
					{draft.direct && program}
					<div className="ugi-set compact">
						<div>
							<strong>{t('launch.closed')}</strong>
							<small>{t('launch.closedText')}</small>
						</div>
						<div className="ugi-field narrow">
							<input type="number" min={5} value={draft.closed ?? DEFAULT_CLOSED} onChange={(e) => set({ closed: Number(e.target.value) || DEFAULT_CLOSED })} />
						</div>
					</div>
				</>
			) : (
				<p className="ugi-muted">{t('launch.none')}</p>
			)}
			<div className="ugi-set compact column">
				<strong>{t('launch.target')}</strong>
				<div className="ugi-field">
					<input type="text" value={shown.exe} onChange={(e) => editCommand({ exe: e.target.value })} />
				</div>
			</div>
			<div className="ugi-set compact column">
				<strong>{t('launch.options')}</strong>
				<small>{t('launch.optionsText')}</small>
				<div className="ugi-field">
					<textarea rows={3} value={shown.launch_options} onChange={(e) => editCommand({ launch_options: e.target.value })} />
				</div>
			</div>
			{saved.command && <p className="ugi-muted">{t('launch.byHand')}</p>}
			<div className="ugi-foot left">
				<button className="ugi-btn primary" disabled={busy || !changed || (!!draft.direct && !draft.exe?.trim() && !draft.command) || (!!draft.command && !draft.command.exe.trim())} onClick={() => save(draft)}>{t('launch.save')}</button>
				<button className="ugi-btn secondary" disabled={busy || !Object.keys(saved).length} onClick={() => save({})}>{t('launch.reset')}</button>
			</div>
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
