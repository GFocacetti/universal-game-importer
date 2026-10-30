import { Millennium, Navigation } from '@steambrew/client';
import { t } from 'i18n';

// Adds "UGI" to Steam's LIBRARY menu, at the end below Downloads, after a line like
// the one Steam draws above Downloads.
// The menu items are a fixed list inside Steam's code, so the entry is added to the menu window's DOM.
const MARK = 'ugi-library-menu-item';
const LINE = 'ugi-library-menu-line';
export const UGI_ROUTE = '/ugi';

function inject(popup: any) {
	const doc: Document | undefined = popup?.m_popup?.document;
	if (!doc || doc.querySelector(`.${MARK}`)) return;
	const items = [...doc.querySelectorAll<HTMLElement>('.MenuItem')];
	const last = items[items.length - 1];
	if (!last) return;
	doc.querySelector('.' + LINE)?.remove();
	const item = items[0]!.cloneNode(true) as HTMLElement;
	item.classList.add(MARK);
	item.textContent = t('menu.item');
	item.addEventListener('click', () => {
		Navigation.Navigate(UGI_ROUTE);
		try {
			popup.m_popup.SteamClient?.Window?.HideWindow?.();
		} catch {}
	});
	// Steam's line: an element of its own before Downloads, or a border on Downloads itself
	const steamLine = last.previousElementSibling;
	let line: HTMLElement;
	if (steamLine && !steamLine.classList.contains('MenuItem')) {
		line = steamLine.cloneNode(true) as HTMLElement;
	} else {
		line = doc.createElement('div');
		const style = doc.defaultView?.getComputedStyle(last);
		line.style.borderTop = style && style.borderTopWidth !== '0px' ? style.borderTop : '1px solid rgba(255,255,255,.15)';
		line.style.margin = '4px 0';
	}
	line.classList.add(LINE);
	last.after(line);
	line.after(item);
}

function watch(popup: any) {
	const title = String(popup?.m_strTitle ?? popup?.m_strName ?? '');
	if (!title.includes('Library Supernav')) return;
	inject(popup);
	// Steam may re-render the menu: put the entry back when it disappears
	const body = popup?.m_popup?.document?.body;
	if (body) new MutationObserver(() => inject(popup)).observe(body, { childList: true, subtree: true });
}

export function setupLibraryMenu() {
	Millennium.AddWindowCreateHook?.(watch);
	// The menu window may already exist when the plugin loads
	const popups = (window as any).g_PopupManager?.m_mapPopups;
	popups?.forEach?.((popup: any) => watch(popup));
}
