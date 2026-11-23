// The Collections section: a cover frame for every game of a Steam collection (a console's, for
// example). The launchers' collections are left out: their frame is set in the Launchers section.
import React, { useState } from 'react';
import { t } from 'i18n';
import { FrameWindow, frameLabel } from 'FrameWindow';
import { collectionGames, FRAME_SOURCES, saveCollectionFrame } from 'frames';
import { LAUNCHER_NAMES } from 'steamApps';
import { UgiState } from 'types';

declare const collectionStore: { userCollections?: Iterable<{ id: string; displayName: string }> };

// Steam's own lists that aren't collections the user made (uncategorized games, soundtracks...)
const isSystem = (id: string) => id === 'uncategorized' || id.startsWith('type-');

function steamCollections(state: UgiState): { id: string; name: string }[] {
	const launchers = new Set(
		Object.entries(state.collections ?? {})
			.filter(([launcher]) => launcher !== 'manual')
			.map(([, info]) => info.collection_id)
			.filter(Boolean),
	);
	try {
		return [...(collectionStore.userCollections ?? [])]
			.filter((c) => !isSystem(c.id) && !launchers.has(c.id))
			.map((c) => ({ id: c.id, name: c.displayName }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

// The templates first shown for a collection: the platform its name speaks of ("Switch 2" -> Nintendo
// Switch 2, "Ps5" -> PlayStation 5), the longest name that matches; else Steam's
const BRANDS = /^(nintendo|sony|microsoft|sega|atari|snk)\s+/i;
function guessSource(name: string): string {
	const text = name.toLowerCase();
	let best = 'steam';
	let length = 0;
	for (const [id, source] of Object.entries(FRAME_SOURCES)) {
		const full = (source.name ?? LAUNCHER_NAMES[id] ?? id).toLowerCase();
		// The full name, without the brand, and the short id (ps5, n64, gba...)
		for (const candidate of [full, full.replace(BRANDS, ''), id.toLowerCase()]) {
			if (candidate.length > length && candidate.length > 1 && new RegExp(`(^|[^a-z0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text)) {
				best = id;
				length = candidate.length;
			}
		}
	}
	return best;
}

export function CollectionsSection({ state, onChanged }: { state: UgiState; onChanged: () => void }) {
	const [framing, setFraming] = useState<{ id: string; name: string } | null>(null);
	const list = steamCollections(state);

	return (
		<>
			<div className="ugi-card ugi-launcher-help">
				<div>{t('collections.help')}</div>
			</div>
			{!list.length && <p className="ugi-muted">{t('collections.empty')}</p>}
			<div className="ugi-lgrid">
				{list.map((c) => {
					const n = collectionGames(c.id).length;
					const frame = state.collection_frames?.[c.id]?.frame;
					return (
						<div key={c.id} className="ugi-card ugi-lrow">
							<div>
								<h3>{c.name}</h3>
								<div className="ugi-muted">{n === 1 ? t('collections.gamesOne') : t('collections.games', { n })}</div>
							</div>
							<div className="ugi-opts">
								<button className="ugi-btn secondary ugi-frame-launcher" onClick={() => setFraming(c)}>
									{t('frame.title')}: {frameLabel(frame ?? { kind: 'none' })}
								</button>
							</div>
						</div>
					);
				})}
			</div>
			{framing && (
				<FrameWindow
					title={framing.name}
					value={state.collection_frames?.[framing.id]?.frame}
					source={guessSource(framing.name)}
					onSave={async (choice, progress) => {
						await saveCollectionFrame(framing.id, choice, progress);
						onChanged();
					}}
					onClose={() => setFraming(null)}
				/>
			)}
		</>
	);
}
