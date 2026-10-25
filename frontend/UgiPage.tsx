import React, { useEffect, useState } from 'react';
import { loadState, saveState } from 'backend';
import { t } from 'i18n';
import { themeStyle, UGI_CSS } from 'theme';
import { UgiState } from 'types';

type Section = 'games' | 'launchers' | 'images' | 'settings';

const SECTIONS: { id: Section; label: () => string }[] = [
	{ id: 'games', label: () => t('nav.games') },
	{ id: 'launchers', label: () => t('nav.launchers') },
	{ id: 'images', label: () => t('nav.images') },
	{ id: 'settings', label: () => t('nav.settings') },
];

function ApiKeyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
	const [key, setKey] = useState('');
	const save = async () => {
		const state = await loadState();
		state.settings.sgdb_key = key.trim();
		await saveState(state);
		onSaved();
	};
	return (
		<div className="ugi-overlay" onClick={onClose}>
			<div className="ugi-dialog" onClick={(e) => e.stopPropagation()}>
				<h2>{t('apikey.title')}</h2>
				<p>{t('apikey.intro')}</p>
				<ol>
					<li>{t('apikey.step1')}</li>
					<li>{t('apikey.step2')}</li>
					<li>{t('apikey.step3')}</li>
					<li>{t('apikey.step4')}</li>
				</ol>
				<div className="ugi-field">
					<input value={key} placeholder={t('apikey.placeholder')} onChange={(e) => setKey(e.target.value)} />
				</div>
				<div className="ugi-foot">
					<button className="ugi-btn secondary" onClick={onClose}>{t('common.cancel')}</button>
					<button className="ugi-btn primary" disabled={!key.trim()} onClick={save}>{t('apikey.save')}</button>
				</div>
			</div>
		</div>
	);
}

export default function UgiPage() {
	const [state, setState] = useState<UgiState | null>(null);
	const [section, setSection] = useState<Section>('games');
	const [keyDialog, setKeyDialog] = useState(false);

	const reload = () => loadState().then(setState);
	useEffect(() => {
		reload();
	}, []);

	const theme = state?.settings.theme ?? 'steam';
	const gameCount = state ? Object.keys(state.imported).length : 0;

	return (
		<div className="ugi-root" style={themeStyle(theme) as React.CSSProperties}>
			<style>{UGI_CSS}</style>
			<nav className="ugi-side">
				<div className="ugi-brand">
					<div className="ugi-logo">UGI</div>
					<span>Universal<br />Game Importer</span>
				</div>
				{SECTIONS.map((s) => (
					<div key={s.id} className={`ugi-nav${section === s.id ? ' on' : ''}`} onClick={() => setSection(s.id)}>
						<span>{s.label()}</span>
						{s.id === 'games' && <small>{gameCount}</small>}
					</div>
				))}
			</nav>
			<section className="ugi-main">
				<div className="ugi-head">
					<h1>{SECTIONS.find((s) => s.id === section)?.label()}</h1>
					<span className="ugi-sp" />
					<span className="ugi-muted">{t('header.never')}</span>
					<button className="ugi-btn primary">{t('header.scan')}</button>
				</div>
				{state && !state.settings.sgdb_key && (
					<div className="ugi-apibar" onClick={() => setKeyDialog(true)}>
						<b>⚠</b> {t('apikey.missing')}
						<span className="go">{t('apikey.add')}</span>
					</div>
				)}
				<div className="ugi-content">
					<p className="ugi-muted">{t('placeholder.soon')}</p>
				</div>
			</section>
			{keyDialog && (
				<ApiKeyDialog
					onClose={() => setKeyDialog(false)}
					onSaved={() => {
						setKeyDialog(false);
						reload();
					}}
				/>
			)}
		</div>
	);
}
