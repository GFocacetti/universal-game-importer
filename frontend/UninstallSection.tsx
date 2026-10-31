import React, { useEffect, useState } from 'react';
import { loadState } from 'backend';
import { t } from 'i18n';
import { Backup, CancelFlag, deleteBackup, exportBackup, listBackups, openBackupFolder, pickBackup, readBackup, removalSummary, removeEverything, restoreBackup } from 'maintenance';
import { backdrop } from 'backdrop';

// "Backup and uninstall": a .zip backup of everything UGI keeps, and the removal of all it did
// before the plugin is uninstalled. Both changes are confirmed first.

// "1 game" / "3 games"
const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => (n === 1 ? t(one) : t(many, { n }));

type Confirm = { title: string; text: string; lines: string[]; button: string; danger?: boolean; run: () => Promise<void> };

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
	return (
		<div className="ugi-overlay" {...backdrop(onClose)}>
			<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
				<h2>{confirm.title}</h2>
				<p>{confirm.text}</p>
				{confirm.lines.length > 0 && <ul className="ugi-muted">{confirm.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
				<div className="ugi-foot">
					<button className="ugi-btn secondary" onClick={onClose}>{t('common.cancel')}</button>
					<button
						className={`ugi-btn ${confirm.danger ? 'danger' : 'primary'}`}
						onClick={() => {
							onClose();
							confirm.run();
						}}
					>
						{confirm.button}
					</button>
				</div>
			</div>
		</div>
	);
}

export default function UninstallSection({ onChanged }: { onChanged: () => void }) {
	const [backups, setBackups] = useState<{ dir: string; files: Backup[] }>({ dir: '', files: [] });
	const [busy, setBusy] = useState('');
	const [result, setResult] = useState('');
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	// Set while a backup is being made: "Stop" cancels it
	const [backupFlag, setBackupFlag] = useState<CancelFlag | null>(null);

	const refresh = () => listBackups().then(setBackups).catch(() => {});
	useEffect(() => {
		refresh();
	}, []);

	// The error message with what went wrong, so it can be told apart (and reported)
	const failed = (reason?: string) => {
		const detail = (reason ?? '').replace(/^error:\s*/i, '').trim();
		return detail ? `${t('maint.error')} ${t('maint.reason', { reason: detail })}` : t('maint.error');
	};

	const run = async (label: string, job: () => Promise<string>) => {
		setBusy(label);
		setResult('');
		try {
			setResult(await job());
		} catch (err) {
			console.error('[UGI]', err);
			setResult(failed(err instanceof Error ? err.message : String(err)));
		}
		setBusy('');
		refresh();
		onChanged();
	};

	const create = () =>
		run(t('maint.backupBusy'), async () => {
			const flag: CancelFlag = { cancel: false };
			setBackupFlag(flag);
			try {
				const out = await exportBackup(flag);
				return out.cancelled ? t('maint.backupCancelled') : out.path ? t('maint.backupDone', { path: out.path }) : failed(out.error);
			} finally {
				setBackupFlag(null);
			}
		});

	const askDelete = (backup: Backup) =>
		setConfirm({
			title: t('maint.deleteTitle'),
			text: t('maint.deleteText', { name: backup.name }),
			lines: [],
			button: t('maint.deleteButton'),
			danger: true,
			run: () => run(t('maint.deleteBusy'), async () => ((await deleteBackup(backup.path)) ? t('maint.deleteDone', { name: backup.name }) : t('maint.error'))),
		});

	const askRestore = (backup: Backup) =>
		run(t('maint.reading'), async () => {
			const content = await readBackup(backup.path);
			if (!content) return t('maint.notBackup');
			setConfirm({
				title: t('maint.restoreTitle'),
				text: t('maint.restoreText', { name: backup.name }),
				lines: [
					count(Object.keys(content.imported ?? {}).length, 'maint.restoreGamesOne', 'maint.restoreGames'),
					t('maint.restoreSettings'),
					t('maint.restoreImages'),
				],
				button: t('maint.restoreButton'),
				run: () =>
					run(t('maint.restoreBusy'), async () => {
						const out = await restoreBackup(content, (step) => setBusy(t(`maint.step.${step}` as any)));
						return t('maint.restoreDone', { games: out.games, files: out.files });
					}),
			});
			return '';
		});

	const askRemove = async () => {
		const summary = await removalSummary(await loadState());
		setConfirm({
			title: t('maint.removeTitle'),
			text: t('maint.removeText'),
			lines: [
				count(summary.games, 'maint.removeGamesOne', 'maint.removeGames'),
				t('maint.removeCollections'),
				count(summary.apps, 'maint.removeSteamOne', 'maint.removeSteam'),
				t('maint.removeFiles'),
				t('maint.removeSettings'),
			],
			button: t('maint.removeButton'),
			danger: true,
			run: () =>
				run(t('maint.removeBusy'), async () => {
					const out = await removeEverything((step) => setBusy(t(`maint.step.${step}` as any)));
					return t('maint.removeDone', { games: out.games, apps: out.apps });
				}),
		});
	};

	return (
		<>
			{busy && (
				<div className="ugi-card">
					<div className="ugi-row-between">
						<strong>{busy}</strong>
						<span className="ugi-row-between" style={{ gap: 12 }}>
							{backupFlag && <button className="ugi-btn secondary" onClick={() => (backupFlag.cancel = true)}>{t('maint.stop')}</button>}
							<div className="ugi-spinner" />
						</span>
					</div>
				</div>
			)}
			{result && <div className="ugi-card">{result}</div>}
			<div className="ugi-card">
				<h3>{t('maint.backupTitle')}</h3>
				<p className="ugi-muted">{t('maint.backupText')}</p>
				<div className="ugi-row-between">
					<button className="ugi-btn primary" disabled={!!busy} onClick={create}>{t('maint.backupButton')}</button>
					{backups.dir && <span className="ugi-link" onClick={() => openBackupFolder(backups.dir)}>{t('maint.openFolder')}</span>}
				</div>
				<div className="ugi-row-between">
					<h4>{t('maint.listTitle')}</h4>
					<span className="ugi-link" onClick={async () => { const picked = await pickBackup(); if (picked) askRestore(picked); }}>{t('maint.pick')}</span>
				</div>
				{backups.files.length === 0 && <p className="ugi-muted">{t('maint.none', { dir: backups.dir })}</p>}
				{backups.files.map((backup) => (
					<div key={backup.path} className="ugi-row-between" style={{ padding: '6px 0' }}>
						<span>{backup.name}</span>
						<span className="ugi-row-between" style={{ gap: 8 }}>
							<button className="ugi-btn secondary" disabled={!!busy} onClick={() => askRestore(backup)}>{t('maint.restoreButton')}</button>
							<button className="ugi-btn danger" disabled={!!busy} onClick={() => askDelete(backup)}>{t('maint.deleteButton')}</button>
						</span>
					</div>
				))}
			</div>
			<div className="ugi-card">
				<h3>{t('maint.removeHeading')}</h3>
				<p className="ugi-muted">{t('maint.removeIntro')}</p>
				<button className="ugi-btn danger" disabled={!!busy} onClick={askRemove}>{t('maint.removeButton')}</button>
			</div>
			{confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
		</>
	);
}
