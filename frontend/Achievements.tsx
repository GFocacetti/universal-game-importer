// Achievements on the library page of imported games, in the column beside the player, as Steam
// shows them: count and bar, its rosette for a perfect game, the latest unlocked; the full
// list opens in a window
import { callable, toaster } from '@steambrew/client';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { importedKeyFor, loadState, unquote } from 'backend';
import { backdrop } from 'backdrop';
import { watchGamepad } from 'gamepad';
import { epicSandbox, xboxTitleId } from 'gameInfo';
import { bigPicture } from 'location';
import { Pressable } from 'Pressable';
import { t, uiLocale } from 'i18n';
import { themeStyle, UGI_CSS } from 'theme';
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
type Result = { source?: 'gog' | 'xbox' | 'epic'; items: Achievement[]; signed_out?: boolean; fetched?: number };

// OpenXBL's free key allows 150 requests an hour: an Xbox game is asked again after 10 minutes at most
const XBOX_RECHECK = 10 * 60 * 1000;

const SOURCE_TEXT = { gog: 'ach.sourceGog', xbox: 'ach.sourceXbox', epic: 'ach.sourceEpic' } as const;

// What the backend needs besides the game's id: Xbox title id and OpenXBL key, Epic namespace
async function extra(state: UgiState, id: string): Promise<Record<string, string>> {
	const [launcher, gameId = ''] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
	if (launcher === 'xbox' && state.settings.xbl_key) return { title: await xboxTitleId(gameId), key: state.settings.xbl_key };
	if (launcher === 'epic') return { sandbox: await epicSandbox(gameId, state.settings.launchers?.epic?.path ?? '') };
	return {};
}

export const ACHIEVEMENTS_CSS = `
.ugi-ach { margin-top: 14px; }
.ugi-ach-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.ugi-ach-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ugi-ach-rosette { flex: none; width: 28px; height: 28px; color: #1a9fff; }
.ugi-ach-meter { flex: 1; min-width: 0; }
.ugi-ach-count { color: #ffffff; font-size: 13px; }
.ugi-ach-count span { color: #8f98a0; }
.ugi-ach-bar { height: 8px; margin-top: 5px; background: rgba(255,255,255,.1); border-radius: 4px; overflow: hidden; }
.ugi-ach-bar i { display: block; height: 100%; background: #1a9fff; border-radius: 4px; }
.ugi-ach-note { color: #8f98a0; font-size: 12px; margin-bottom: 8px; }
.ugi-ach-recent { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-bottom: 8px; }
.ugi-ach-recent > * { aspect-ratio: 1; border-radius: 2px; overflow: hidden; }
.ugi-ach-recent img { width: 100%; height: 100%; display: block; object-fit: cover; }
.ugi-ach-recent img.locked { filter: grayscale(1); opacity: .5; }
.ugi-ach-recent img.secret { filter: grayscale(1) blur(4px); opacity: .5; }
.ugi-ach-recent > .ugi-ach-all-cell { grid-column: 6; }
.ugi-ach-all-cell > * { width: 100%; height: 100%; }
.ugi-ach-all { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 2px; background: rgba(255,255,255,.08); color: #66c0f4; font-size: 11px; line-height: 1.2; text-align: center; cursor: pointer; }
.ugi-ach-all b { font-size: 22px; font-weight: 300; line-height: 1; }
.ugi-ach-all:hover { background: rgba(102,192,244,.25); color: #ffffff; }
.ugi-ach-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.ugi-ach-actions > :last-child { flex: none; }
.ugi-ach-button { font: inherit; font-size: 12px; padding: 4px 10px; border: 0; border-radius: 2px; background: rgba(103,112,123,.25); color: #b8bcbf; cursor: pointer; }
.ugi-ach-button:hover { background: rgba(103,112,123,.45); color: #ffffff; }
.ugi-ach .ugi-info-source { flex: 1; min-width: 0; margin: 0; font-size: 10px; line-height: 1.3; }
.ugi-ach-win { width: 760px; color: #dcdedf; font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px; }
.ugi-ach-win header .ugi-ach-progress, .ugi-ach-win header .ugi-ach-note { flex: 1; margin: 0; }
.ugi-ach-win .ugi-win-pane { padding: 0 10px; }
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
	if (!result || !Array.isArray(result.items)) result = null;
	savedMemory.set(key, result);
	return result;
}

// Reads the launcher now (and saves what it got)
function fetchFresh(state: UgiState, id: string): Promise<Result> {
	const lang = language();
	return extra(state, id)
		.then((more) => readAchievements({ a_id: id, b_lang: lang, c_extra: JSON.stringify(more) }))
		.then((raw) => {
			const parsed = JSON.parse(unquote(raw)) as Result;
			const result = { source: parsed.source, items: Array.isArray(parsed.items) ? parsed.items : [], signed_out: parsed.signed_out === true, fetched: Date.now() };
			// An empty answer doesn't replace a saved list (launcher closed, offline)
			if (result.items.length || !savedMemory.get(savedKey(id))?.items.length) {
				savedMemory.set(savedKey(id), result);
				savedSave({ a_key: savedKey(id), b_json: JSON.stringify(result) }).catch(() => false);
			}
			return result;
		})
		.catch(() => ({ items: [] }));
}

function load(state: UgiState, id: string): Promise<Result> {
	const key = `${id}|${language()}`;
	if (!cache.has(key)) {
		const request = fetchFresh(state, id);
		cache.set(key, request);
		// A game played since gets read again next time
		setTimeout(() => cache.delete(key), 60_000);
	}
	return cache.get(key)!;
}

// Launchers whose achievements UGI reads
const WITH_ACHIEVEMENTS = ['gog', 'xbox', 'epic'];
const DAY = 24 * 60 * 60 * 1000;

// Every imported game's achievements read again once a day, one at a time, behind the library;
// opening a game's page reads them at once
export async function prefetchAchievements(state: UgiState) {
	for (const id of Object.keys(state.imported)) {
		if (!WITH_ACHIEVEMENTS.includes(id.slice(0, id.indexOf(':')))) continue;
		const last = await saved(id);
		if (last?.fetched && Date.now() - last.fetched < DAY) continue;
		await load(state, id);
		// OpenXBL's free key allows 150 requests an hour: Xbox games one every 30 seconds at most
		if (id.startsWith('xbox:') && state.settings.xbl_key) await new Promise((r) => setTimeout(r, 30_000));
	}
}

// ---------- Unlocked while playing ----------

// While an imported game runs, its achievements are read again now and then; each new one shows
// Steam's own notification. GOG comes from Galaxy's database, which has an unlock at once; Epic and
// Xbox from their services, less often (OpenXBL's free key allows 150 requests an hour).
const EVERY: Record<string, number> = { gog: 20_000, epic: 120_000, xbox: 300_000 };

declare const SteamUIStore: { RunningApps?: { appid: number }[] } | undefined;

function runningAppids(): Set<number> {
	try {
		return new Set((SteamUIStore?.RunningApps ?? []).map((a) => a.appid));
	} catch {
		return new Set();
	}
}

// Per running game: the achievements it had, and when to look again. known is false until a first
// answer came (a launcher that didn't answer at the start must not make everything look new).
type Watched = { name: string; unlocked: Set<string>; known: boolean; next: number };
const watched = new Map<string, Watched>();

function notify(item: Achievement, game: string) {
	toaster.toast({
		title: item.name,
		body: item.description ?? '',
		subtext: t('ach.toast', { game }),
		logo: item.image ? <img src={item.image} style={{ width: 48, height: 48, borderRadius: 3 }} /> : undefined,
		duration: 6000,
	});
}

async function check(state: UgiState, id: string, w: Watched) {
	const result = await fetchFresh(state, id);
	if (!result.items.length) return;
	for (const item of result.items) {
		if (!item.unlocked || w.unlocked.has(item.id)) continue;
		w.unlocked.add(item.id);
		if (w.known) notify(item, w.name);
	}
	w.known = true;
}

async function watchTick() {
	const state = await loadState();
	if (state.settings.achievement_toasts === false) {
		watched.clear();
		return;
	}
	const running = runningAppids();
	const now = Date.now();
	for (const [id, entry] of Object.entries(state.imported)) {
		const launcher = id.slice(0, id.indexOf(':'));
		const every = EVERY[launcher];
		if (!every) continue;
		const w = watched.get(id);
		if (!running.has(entry.appid)) {
			// Just closed: one last look, for what was unlocked right before quitting
			if (w) {
				watched.delete(id);
				await check(state, id, w);
			}
			continue;
		}
		if (!w) {
			const started: Watched = { name: entry.name, unlocked: new Set(), known: false, next: now + every };
			watched.set(id, started);
			await check(state, id, started);
		} else if (now >= w.next) {
			w.next = now + every;
			await check(state, id, w);
		}
	}
}

export function watchAchievements() {
	let busy = false;
	setInterval(() => {
		if (busy) return;
		busy = true;
		watchTick()
			.catch((err) => console.error('[UGI] achievements while playing', err))
			.finally(() => (busy = false));
	}, 10_000);
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
		<Pressable block ring onPress={hidden ? () => setRevealed(true) : undefined}>
		<div data-ugi-pad className={`ugi-ach-item${item.unlocked ? '' : ' locked'}${hidden ? ' hidden' : ''}`} onClick={hidden ? () => setRevealed(true) : undefined}>
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
		</Pressable>
	);
}

// The list in a window over Steam, in the window of the page (Big Picture's or the desktop's);
// in Big Picture the D-pad scrolls it and B closes it
function openList(doc: Document, result: Result, items: Achievement[]) {
	const host = doc.createElement('div');
	Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999' });
	doc.body.appendChild(host);
	const root = createRoot(host);
	const close = () => {
		root.unmount();
		host.remove();
	};
	loadState()
		.then((state) => Object.entries(themeStyle(state.settings.theme ?? 'steam')).forEach(([k, v]) => host.style.setProperty(k, v)))
		.catch(() => {});
	if (bigPicture()) watchGamepad(doc);
	root.render(
		<div style={{ position: 'absolute', inset: 0 }}>
			<style>{UGI_CSS + ACHIEVEMENTS_CSS}</style>
			<div className="ugi-overlay" {...backdrop(close)}>
				<div className="ugi-win ugi-ach-win" onClick={(e) => e.stopPropagation()}>
					<header>
						<h2>{t('ach.title')}</h2>
						<Progress result={result} items={items} />
						<button className="ugi-btn secondary" onClick={close}>✕</button>
					</header>
					<div className="ugi-win-pane">
						{items.map((a) => (
							<Item key={a.id} item={a} />
						))}
					</div>
				</div>
			</div>
		</div>,
	);
}

// Count and bar as in Steam's achievements panel; its rosette only with every achievement unlocked
function Progress({ result, items }: { result: Result; items: Achievement[] }) {
	const got = items.filter((a) => a.unlocked).length;
	const percent = Math.floor((got / items.length) * 100);
	if (result.signed_out) return <div className="ugi-ach-note">{t('ach.signedOut', { n: items.length })}</div>;
	return (
		<div className="ugi-ach-progress">
			{got === items.length && <Rosette />}
			<div className="ugi-ach-meter">
				<div className="ugi-ach-count">
					{t('ach.count', { got, n: items.length })} <span>({percent}%)</span>
				</div>
				<div className="ugi-ach-bar">
					<i style={{ width: `${percent}%` }} />
				</div>
			</div>
		</div>
	);
}

const Rosette = () => (
	<svg className="ugi-ach-rosette" viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 1l1.9 1.6 2.4-.5.9 2.3 2.3.9-.5 2.4L20.6 9.6l-1.6 1.9.5 2.4-2.3.9-.9 2.3-2.4-.5L12 18.2l-1.9-1.6-2.4.5-.9-2.3-2.3-.9.5-2.4L3.4 9.6 5 7.7l-.5-2.4 2.3-.9.9-2.3 2.4.5zm0 4.6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
		<path d="M8 17.6l-1.5 5.4 2.6-1.3 1.5 2.1 1.1-4.3zM16 17.6l1.5 5.4-2.6-1.3-1.5 2.1-1.1-4.3z" />
	</svg>
);

// The ones shown beside the player, the sixth place being "All": the latest unlocked when the
// launcher gives the time, else the rarest, else any; with fewer than five unlocked, the locked ones
// most players have follow
const PREVIEW = 5;
function preview(items: Achievement[]): Achievement[] {
	const unlocked = items
		.filter((a) => a.unlocked && a.image)
		.sort((a, b) => {
			if (!!a.time !== !!b.time) return a.time ? -1 : 1;
			if (a.time && b.time) return b.time.localeCompare(a.time);
			return (a.rarity ?? 101) - (b.rarity ?? 101);
		});
	const locked = items.filter((a) => !a.unlocked && (a.image_locked ?? a.image)).sort((a, b) => (b.rarity ?? -1) - (a.rarity ?? -1));
	return [...unlocked, ...locked].slice(0, PREVIEW);
}

function Thumb({ item }: { item: Achievement }) {
	const secret = item.secret && !item.unlocked;
	const title = secret ? t('ach.secret') : `${item.name}${item.description ? `\n${item.description}` : ''}`;
	const className = item.unlocked ? '' : secret ? 'locked secret' : 'locked';
	return <img className={className} src={item.unlocked ? item.image : item.image_locked ?? item.image} title={title} />;
}

// ready: the launcher is read only once the page's information is there; until then, the saved ones
export function AchievementsBlock({ appid, ready }: { appid: number; ready: boolean }) {
	const [result, setResult] = useState<Result | undefined>(undefined);
	const box = useRef<HTMLDivElement>(null);

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
			const last = await saved(key);
			if (last?.source === 'xbox' && last.fetched && Date.now() - last.fetched < XBOX_RECHECK) {
				if (alive) setResult((now) => now ?? last);
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
	const shown = preview(items);
	const open = () => box.current && openList(box.current.ownerDocument, result, items);
	return (
		<div className="ugi-ach" ref={box}>
			<style>{ACHIEVEMENTS_CSS}</style>
			<div className="ugi-ach-head">{t('ach.title')}</div>
			<Progress result={result} items={items} />
			<div className="ugi-ach-recent">
				{shown.map((a) => (
					<div key={a.id}>
						<Thumb item={a} />
					</div>
				))}
				{/* Always the sixth place */}
				<div className="ugi-ach-all-cell">
					<Pressable block onPress={open}>
						<div className="ugi-ach-all" onClick={open}>
							<b>+</b>
							{t('ach.all')}
						</div>
					</Pressable>
				</div>
			</div>
			<div className="ugi-ach-actions">
				{result.source && <div className="ugi-info-source">{t(SOURCE_TEXT[result.source])}</div>}
				<Pressable onPress={open}>
					<button className="ugi-ach-button" onClick={open}>
						{t('ach.showAll')}
					</button>
				</Pressable>
			</div>
		</div>
	);
}
