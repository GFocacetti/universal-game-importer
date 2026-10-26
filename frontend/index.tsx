import { callable, definePlugin, DialogButton, IconsModule, Navigation, routerHook } from '@steambrew/client';
import React from 'react';
import UgiPage from 'UgiPage';
import { initLanguage, setLanguage, t } from 'i18n';
import { setupLibraryMenu, UGI_ROUTE } from 'menu';
import { patchLibraryContextMenu } from 'contextMenu';
import { loadState } from 'backend';
import { mainDocument, waitForMainDocument } from 'overlay';
import { startPeriodicCheck } from 'checker';
import { startGameInfo } from 'GameInfoSection';

declare global {
	interface Window {
		__ugi_route_registered__?: boolean;
		__ugi_context_menu__?: { unpatch: () => void };
		__ugi_started__?: boolean;
		__ugi_game_info__?: boolean;
	}
}

// Millennium's plugin settings panel: just a way into the UGI page
function PluginPanel() {
	return (
		<div style={{ padding: '8px 0' }}>
			<p>{t('panel.text')}</p>
			<DialogButton onClick={() => Navigation.Navigate(UGI_ROUTE)}>{t('panel.open')}</DialogButton>
		</div>
	);
}

const ugiLog = callable<[{ a_message: string }], boolean>('ugi_log');
// Startup trace (best effort: the backend may not answer yet)
const trace = (msg: string) => {
	console.log('[UGI]', msg);
	ugiLog({ a_message: msg }).catch(() => {});
};

// Right after Steam starts the backend may not answer yet (a call can even hang): retry with a timeout
async function loadStateWhenReady() {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			trace(`loading state, attempt ${attempt + 1}`);
			return await Promise.race([
				loadState(),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
			]);
		} catch {
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
	return loadState();
}

async function waitForStableMainWindow() {
	let last = mainDocument();
	let stableFor = 0;
	for (let i = 0; i < 120 && stableFor < 5; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		const now = mainDocument();
		stableFor = now && now === last ? stableFor + 1 : 0;
		last = now;
	}
}

async function onStartup() {
	trace('startup: waiting for the main window');
	const doc = await waitForMainDocument();
	trace(`startup: main window ${doc ? 'found' : 'not found'}`);
	const state = await loadStateWhenReady();
	setLanguage(state.settings.language);
	trace(`startup: state loaded, onboarded=${state.onboarded}`);
	if (!state.onboarded && doc) {
		// Steam replaces its first window a few seconds after startup: wait for the final one,
		// then open the UGI page, where the setup is shown
		await waitForStableMainWindow();
		Navigation.Navigate(UGI_ROUTE);
		trace('startup: UGI page opened for the setup');
	}
	startPeriodicCheck().catch((err) => console.error('[UGI] periodic check failed', err));
}

export default definePlugin(async () => {
	await initLanguage();
	if (!window.__ugi_route_registered__) {
		window.__ugi_route_registered__ = true;
		routerHook.addRoute(UGI_ROUTE, UgiPage, { exact: true });
	}
	setupLibraryMenu();
	if (!window.__ugi_context_menu__) window.__ugi_context_menu__ = patchLibraryContextMenu();
	if (!window.__ugi_game_info__) {
		window.__ugi_game_info__ = true;
		startGameInfo();
	}
	if (!window.__ugi_started__) {
		window.__ugi_started__ = true;
		onStartup().catch((err) => console.error('[UGI] startup failed', err));
	}

	return {
		title: 'UGI – Universal Game Importer',
		icon: <IconsModule.Settings />,
		content: <PluginPanel />,
	};
});
