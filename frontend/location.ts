// Where the main Steam window is. Other views (like the store) are drawn above Steam's window:
// UGI layers are only shown over the library or the UGI page.
declare const MainWindowBrowserManager: { m_lastLocation?: { pathname?: string } } | undefined;

export function libraryVisible(): boolean {
	try {
		const path = MainWindowBrowserManager?.m_lastLocation?.pathname ?? '';
		return path.startsWith('/library') || path.startsWith('/ugi');
	} catch {
		return false;
	}
}

export async function waitForLibrary() {
	while (!libraryVisible()) await new Promise((r) => setTimeout(r, 3000));
}
