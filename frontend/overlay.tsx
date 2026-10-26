import React from 'react';
import { createRoot } from 'react-dom/client';
import { loadState } from 'backend';
import { themeStyle, UGI_CSS } from 'theme';

// The main Steam window document, once it exists
export function mainDocument(): Document | undefined {
	let doc: Document | undefined;
	(window as any).g_PopupManager?.m_mapPopups?.forEach?.((popup: any) => {
		if (!doc && String(popup?.m_strName ?? '').startsWith('SP Desktop')) doc = popup?.m_popup?.document;
	});
	return doc;
}

// Steam can take minutes to open its main window on a cold start (login, updates)
export async function waitForMainDocument(timeoutMs = 10 * 60 * 1000): Promise<Document | undefined> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const doc = mainDocument();
		if (doc?.body) return doc;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return undefined;
}

// Mounts a themed UGI layer over Steam in the given window; `render` gets a close function
export async function mountOverlay(doc: Document, render: (close: () => void) => React.ReactNode, onClosed?: () => void, layout: 'full' | 'toast' = 'full') {
	const theme = (await loadState()).settings.theme ?? 'steam';
	const host = doc.createElement('div');
	if (layout === 'full') Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999' });
	else Object.assign(host.style, { position: 'fixed', right: '18px', bottom: '18px', zIndex: '9999' });
	Object.entries(themeStyle(theme)).forEach(([k, v]) => host.style.setProperty(k, v));
	doc.body.appendChild(host);
	const root = createRoot(host);
	let closed = false;
	const close = () => {
		closed = true;
		root.unmount();
		host.remove();
		onClosed?.();
	};
	root.render(
		<div style={{ position: layout === 'full' ? 'absolute' : 'relative', inset: 0, fontFamily: 'var(--ugi-font)', color: 'var(--ugi-text)' }}>
			<style>{UGI_CSS}</style>
			{render(close)}
		</div>,
	);
	// Still on screen? (Steam may replace its main window while starting up)
	const isAlive = () => !closed && host.isConnected && (layout !== 'full' || mainDocument() === doc);
	return Object.assign(close, { isAlive, dispose: () => { closed = true; try { root.unmount(); } catch {} host.remove(); } });
}
