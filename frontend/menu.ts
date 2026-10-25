import { Millennium, Navigation } from '@steambrew/client';
import { t } from 'i18n';

// Adds a "UGI" entry to Steam's LIBRARY menu, right below the Library home entry.
// The menu items are a fixed list inside Steam's code, so the entry is added to the menu window's DOM.
const MARK = 'ugi-library-menu-item';
export const UGI_ROUTE = '/ugi';

function inject(popup: any) {
	const doc: Document | undefined = popup?.m_popup?.document;
	if (!doc || doc.querySelector(`.${MARK}`)) return;
	const home = doc.querySelector('.MenuItem');
	if (!home) return;
	const item = home.cloneNode(true) as HTMLElement;
	item.classList.add(MARK);
	item.textContent = t('menu.item');
	item.addEventListener('click', () => {
		Navigation.Navigate(UGI_ROUTE);
		try {
			popup.m_popup.SteamClient?.Window?.HideWindow?.();
		} catch {}
	});
	home.after(item);
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
