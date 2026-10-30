import React, { useEffect, useMemo, useState } from 'react';
import { SteamImage } from 'SteamImage';
import { openGallery } from 'Gallery';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { missingFor, replaceGame } from 'sgdb';
import { ImageKind, launcherName, launchShortcut } from 'steamApps';
import { syncCollections } from 'collections';
import { ImportedEntry, UgiState } from 'types';
import { ImagesProgress, watchImages } from 'imagesProgress';

type Row = ImportedEntry & { id: string };

function Detail({ row, missing, onClose, onRemoved, onImages }: { row: Row; missing: number[]; onClose: () => void; onRemoved: () => void; onImages: () => void }) {
	const [version, setVersion] = useState(0);
	const [missingNow, setMissingNow] = useState(missing);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const refresh = async () => {
		setVersion((v) => v + 1);
		onImages();
		// Steam writes the new images in the background: count the missing ones once they are there
		await new Promise((r) => setTimeout(r, 2000));
		setMissingNow((await missingFor([row.appid]))[String(row.appid)] ?? []);
	};
	const autoPick = async () => {
		setBusy(true);
		setStatus(t('auto.busy'));
		try {
			const state = await loadState();
			const n = await replaceGame(state, row.appid);
			await saveState(state);
			setStatus(t('auto.done', { n }));
		} catch (err) {
			setStatus(String(err).includes('API key') ? t('gallery.keyError') : t('gallery.error'));
		}
		await refresh();
		setBusy(false);
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
	const tile = (kind: ImageKind, label: string) => (
		<div className={`ugi-im ${kind} clickable`} title={t('detail.changeImage')} key={`${kind}-${version}`}
			onClick={(e) => openGallery(row.appid, row.name, e.currentTarget.ownerDocument, refresh)}>
			<SteamImage appid={row.appid} kind={kind} />
			<span>{label}</span>
		</div>
	);
	return (
		<div className="ugi-overlay right" onClick={onClose}>
			<div className="ugi-drawer" onClick={(e) => e.stopPropagation()}>
				<div className="ugi-drawer-head">
					<div>
						<h2>{row.name}</h2>
						<span className="ugi-muted">{launcherName(row.launcher)}</span>
					</div>
					<button className="ugi-btn secondary" onClick={onClose}>✕</button>
				</div>
				<div className="ugi-imgs">
					{tile('grid', t('image.grid'))}
					{tile('wide', t('image.wide'))}
					{tile('logo', t('image.logo'))}
					{tile('hero', t('image.hero'))}
					{tile('icon', t('image.icon'))}
				</div>
				<p className="ugi-muted">{status || (missingNow.length ? t('detail.missing', { n: missingNow.length }) : t('detail.complete'))}</p>
				<div className="ugi-kv">
					{t('detail.launcher')}: <code>{launcherName(row.launcher)}</code>
					<br />
					{t('detail.command')}: <code>{row.launch_options ?? ''}</code>
				</div>
				<div className="ugi-foot left">
					<button className="ugi-btn primary" onClick={() => launchShortcut(row.appid)}>{t('detail.play')}</button>
					<button className="ugi-btn secondary" disabled={busy} onClick={autoPick}>{t('auto.button')}</button>
					<button className="ugi-btn danger" onClick={remove}>{t('detail.remove')}</button>
				</div>
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
