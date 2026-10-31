import type { MouseEvent } from 'react';

// Props for a window's dark backdrop: a click on it closes the window. Only a click that also started
// on the backdrop: selecting text in a field and letting go outside the window doesn't close it.
export function backdrop(close?: () => void) {
	let pressed: EventTarget | null = null;
	return {
		onMouseDown: (e: MouseEvent) => {
			pressed = e.target;
		},
		onClick: (e: MouseEvent) => {
			if (close && pressed === e.currentTarget && e.target === e.currentTarget) close();
			pressed = null;
		},
	};
}
