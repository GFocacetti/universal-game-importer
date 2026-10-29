// "Achievements" section on the library page of imported games, below the game information:
// progress, the latest unlocked, and the full list on request
import { callable } from '@steambrew/client';
import React, { useEffect, useState } from 'react';
import { importedKeyFor, loadState, unquote } from 'backend';
import { epicSandbox, xboxTitleId } from 'gameInfo';
import { t, uiLocale } from 'i18n';
import { UgiState } from 'types';

const readAchievements = callable<[{ a_id: string; b_lang: string; c_extra: string }], string>('ugi_achievements');
const savedLoad = callable<[{ a_key: string }], string>('ugi_info_load');
const savedSave = callable<[{ a_key: string; b_json: string }], boolean>('ugi_info_save');

export type Achievement = {
	id: string;
	name: string;
	description?: string;
	image?: string;
	image_locked?: string;
	secret: boolean;
	unlocked: boolean;
	rarity?: number;
	time?: string;
	gamerscore?: number;
};
type Result = { source?: 'gog' | 'xbox' | 'epic'; items: Achievement[]; signed_out?: boolean };

const SOURCE_TEXT = { gog: 'ach.sourceGog', xbox: 'ach.sourceXbox', epic: 'ach.sourceEpic' } as const;

// What the backend needs besides the game's id: Xbox title id and OpenXBL key, Epic namespace
async function extra(state: UgiState, id: string): Promise<Record<string, string>> {
	const [launcher, gameId = ''] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
	if (launcher === 'xbox' && state.settings.xbl_key) return { title: await xboxTitleId(gameId), key: state.settings.xbl_key };
	if (launcher === 'epic') return { sandbox: await epicSandbox(gameId, state.settings.launchers?.epic?.path ?? '') };
	return {};
}

export const ACHIEVEMENTS_CSS = `
.ugi-ach-bar { height: 6px; margin: 4px 0 12px; background: rgba(255,255,255,.08); border-radius: 3px; overflow: hidden; }
.ugi-ach-bar i { display: block; height: 100%; background: linear-gradient(90deg, #47bfff, #1a44c2); }
.ugi-ach-count { color: #c6d4df; font-size: 13px; }
.ugi-ach-recent { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.ugi-ach-recent img { width: 48px; height: 48px; border-radius: 3px; display: block; }
.ugi-ach-toggle { color: #66c0f4; font-size: 13px; cursor: pointer; }
.ugi-ach-toggle:hover { color: #ffffff; }
.ugi-ach-list { margin-top: 10px; }
.ugi-ach-item { display: flex; gap: 12px; align-items: center; padding: 8px; border-top: 1px solid rgba(255,255,255,.05); }
.ugi-ach-item img, .ugi-ach-item .ugi-ach-blank { width: 56px; height: 56px; flex: none; border-radius: 3px; background: rgba(255,255,255,.06); }
.ugi-ach-item.locked img { filter: grayscale(1); opacity: .5; }
.ugi-ach-item.hidden { cursor: pointer; }
.ugi-ach-text { flex: 1; min-width: 0; }
.ugi-ach-text b { display: block; color: #ffffff; font-weight: 400; }
.ugi-ach-item.locked .ugi-ach-text b { color: #acb2b8; }
.ugi-ach-text span { color: #8f98a0; font-size: 13px; }
.ugi-ach-side { flex: none; text-align: right; color: #8f98a0; font-size: 12px; }
.ugi-ach-side .rare { color: #e4ae39; }
`;

// Kept for the session: the launchers' files change only while playing
const cache = new Map<string, Promise<Result>>();

const language = () => (uiLocale() === 'it' ? 'it-IT' : 'en-US');
// Saved beside the game information, shown while the launcher is read again
const savedKey = (id: string) => `achievements_${id}_${language()}`;

// (kept here too once read or saved)
const savedMemory = new Map<string, Result | null>();

async function saved(id: string): Promise<Result | null> {
	const key = savedKey(id);
	if (savedMemory.has(key)) return savedMemory.get(key)!;
	let result: Result | null = null;
	try {
		result = JSON.parse(unquote(await savedLoad({ a_key: key })) || 'null') as Result | null;
	} catch {}
	if (!result || !Array.isArray(result.items) || !result.items.length) result = null;
	savedMemory.set(key, result);
	return result;
}

function load(state: UgiState, id: string): Promise<Result> {
	const lang = language();
	const key = `${id}|${lang}`;
	if (!cache.has(key)) {
		const request = extra(state, id)
			.then((more) => readAchievements({ a_id: id, b_lang: lang, c_extra: JSON.stringify(more) }))
			.then((raw) => {
				const parsed = JSON.parse(unquote(raw)) as Result;
				const result = { source: parsed.source, items: Array.isArray(parsed.items) ? parsed.items : [], signed_out: parsed.signed_out === true };
				if (result.items.length) {
					savedMemory.set(savedKey(id), result);
					savedSave({ a_key: savedKey(id), b_json: JSON.stringify(result) }).catch(() => false);
				}
				return result;
			})
			.catch(() => ({ items: [] }));
		cache.set(key, request);
		// A game played since gets read again next time
		setTimeout(() => cache.delete(key), 60_000);
	}
	return cache.get(key)!;
}

const date = (iso: string) => new Date(iso).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'long', year: 'numeric' });

// Unlocked first, most recent on top; then the locked ones, the most common first
function sorted(items: Achievement[]): Achievement[] {
	return [...items].sort((a, b) => {
		if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
		if (a.unlocked) return (b.time ?? '').localeCompare(a.time ?? '');
		return (b.rarity ?? 0) - (a.rarity ?? 0);
	});
}

function Item({ item }: { item: Achievement }) {
	const [revealed, setRevealed] = useState(false);
	const hidden = item.secret && !item.unlocked && !revealed;
	const image = item.unlocked ? item.image : item.image_locked ?? item.image;
	return (
		<div className={`ugi-ach-item${item.unlocked ? '' : ' locked'}${hidden ? ' hidden' : ''}`} onClick={hidden ? () => setRevealed(true) : undefined}>
			{image && !hidden ? <img src={image} /> : <div className="ugi-ach-blank" />}
			<div className="ugi-ach-text">
				<b>{hidden ? t('ach.secret') : item.name}</b>
				<span>{hidden ? t('ach.reveal') : item.description}</span>
			</div>
			<div className="ugi-ach-side">
				{item.unlocked && item.time && <div>{t('ach.unlockedOn', { date: date(item.time) })}</div>}
				{item.rarity !== undefined && item.rarity !== null && (
					<div className={item.rarity < 10 ? 'rare' : ''}>{t('ach.rarity', { p: item.rarity.toLocaleString(uiLocale(), { maximumFractionDigits: 1 }) })}</div>
				)}
				{!!item.gamerscore && <div>{item.gamerscore} G</div>}
			</div>
		</div>
	);
}

// ready: the launcher is read only once the page's information is there; until then, the saved ones
export function AchievementsBlock({ appid, ready }: { appid: number; ready: boolean }) {
	const [result, setResult] = useState<Result | undefined>(undefined);
	const [all, setAll] = useState(false);

	useEffect(() => {
		let alive = true;
		(async () => {
			const state = await loadState();
			const key = importedKeyFor(state, appid);
			if (!key) return;
			if (!ready) {
				const found = await saved(key);
				if (alive && found) setResult((now) => now ?? found);
				return;
			}
			const found = await load(state, key);
			// Nothing read (offline, launcher closed): the saved ones stay
			if (alive) setResult((now) => (found.items.length || !now ? found : now));
		})().catch(() => {});
		return () => {
			alive = false;
		};
	}, [appid, ready]);

	if (!result?.items.length) return null;
	const items = sorted(result.items);
	const got = items.filter((a) => a.unlocked).length;
	const percent = Math.round((got / items.length) * 100);
	const recent = items.filter((a) => a.unlocked && a.image).slice(0, 10);
	return (
		<div className="ugi-info">
			<style>{ACHIEVEMENTS_CSS}</style>
			<h2 className="first">{t('ach.title')}</h2>
			<div className="ugi-ach-count">{result.signed_out ? t('ach.signedOut', { n: items.length }) : t('ach.progress', { got, n: items.length, p: percent })}</div>
			<div className="ugi-ach-bar">
				<i style={{ width: `${percent}%` }} />
			</div>
			{recent.length > 0 && (
				<div className="ugi-ach-recent">
					{recent.map((a) => (
						<img key={a.id} src={a.image} title={`${a.name}${a.description ? `\n${a.description}` : ''}`} />
					))}
				</div>
			)}
			<span className="ugi-ach-toggle" onClick={() => setAll(!all)}>
				{all ? t('ach.showLess') : t('ach.showAll', { n: items.length })}
			</span>
			{all && (
				<div className="ugi-ach-list">
					{items.map((a) => (
						<Item key={a.id} item={a} />
					))}
				</div>
			)}
			{result.source && <div className="ugi-info-source">{t(SOURCE_TEXT[result.source])}</div>}
		</div>
	);
}
