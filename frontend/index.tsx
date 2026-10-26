import { definePlugin, IconsModule, routerHook } from '@steambrew/client';
import React from 'react';
import TestPanel from 'TestPanel';
import UgiPage from 'UgiPage';
import { initLanguage } from 'i18n';
import { setupLibraryMenu, UGI_ROUTE } from 'menu';
import { patchLibraryContextMenu } from 'contextMenu';

declare global {
	interface Window {
		__ugi_route_registered__?: boolean;
		__ugi_context_menu__?: { unpatch: () => void };
	}
}

export default definePlugin(async () => {
	await initLanguage();
	if (!window.__ugi_route_registered__) {
		window.__ugi_route_registered__ = true;
		routerHook.addRoute(UGI_ROUTE, UgiPage, { exact: true });
	}
	setupLibraryMenu();
	if (!window.__ugi_context_menu__) window.__ugi_context_menu__ = patchLibraryContextMenu();

	return {
		title: 'UGI – Universal Game Importer',
		icon: <IconsModule.Settings />,
		content: <TestPanel />,
	};
});
