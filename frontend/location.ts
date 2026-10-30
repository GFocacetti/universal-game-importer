import { Router } from '@steambrew/client';

// Where the main Steam window is. Other views (like the store) are drawn above Steam's window:
// UGI layers are only shown over the library or the UGI page. Read through window: when Steam starts
// in Big Picture the main window's manager doesn't exist yet, and naming it directly would throw.
export const mainWindowPath = (): string => (window as any).MainWindowBrowserManager?.m_lastLocation?.pathname ?? '';

// Steam's UI mode: 4 is Big Picture (the gamepad UI), 7 the desktop
const GAMEPAD_MODE = 4;
let uiMode = 7;
try {
	SteamClient.UI.RegisterForUIModeChanged((mode: number) => {
		uiMode = mode;
	});
} catch {}

export function bigPicture(): boolean {
	return uiMode === GAMEPAD_MODE;
}

// The Big Picture window, while it is open
export function gamepadWindow(): any {
	return bigPicture() ? (Router as any)?.WindowStore?.GamepadUIMainWindowInstance : undefined;
}

export function gamepadDocument(): Document | undefined {
	return gamepadWindow()?.BrowserWindow?.document;
}

export function libraryVisible(): boolean {
	try {
		const gamepad = gamepadWindow();
		// Big Picture keeps its own history; when it can't be read the layer stays open
		const path = gamepad ? (gamepad.m_history?.location?.pathname ?? '/library') : mainWindowPath();
		return path.startsWith('/library') || path.startsWith('/ugi');
	} catch {
		return false;
	}
}

export async function waitForLibrary() {
	while (!libraryVisible()) await new Promise((r) => setTimeout(r, 3000));
}
