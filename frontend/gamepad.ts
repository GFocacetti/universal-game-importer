// Controller navigation for UGI's own layers in Big Picture.
// Steam moves its gamepad focus only between its own components; UGI's page, gallery and dialogs are
// plain HTML. Steam sends every controller button to the element it has focused as a "vgp_onbuttondown"
// event; while a UGI layer is on screen the event is caught first and handled here: the D-pad moves a
// highlight between the clickable elements of the topmost layer, A clicks (on a text field it opens
// Steam's on-screen keyboard), B closes the topmost dialog.

import { gamepadWindow } from 'location';

// Button codes of Steam's gamepad events
const OK = 1;
const CANCEL = 2;
const BUMPER_LEFT = 5;
const BUMPER_RIGHT = 6;
const UP = 9;
const DOWN = 10;
const LEFT = 11;
const RIGHT = 12;

const FOCUS = 'ugi-pad';
const NATIVE = 'button, input, select, textarea, summary, a[href]';
const watched = new WeakSet<Document>();

// Steam's on-screen keyboard of the Big Picture window
const keyboard = (): any => gamepadWindow()?.VirtualKeyboardManager;
const keyboardShown = (): boolean => Boolean(keyboard()?.IsShowingVirtualKeyboard?.Value);

// Focuses a text field and opens the on-screen keyboard on it, as Steam does for its own fields
function typeInto(field: HTMLElement) {
	field.focus();
	const ref = keyboard()?.CreateVirtualKeyboardRef?.({});
	ref?.SetAsCurrentVirtualKeyboardTarget?.();
	ref?.ShowVirtualKeyboard?.();
}

// On screen: hidden elements have no box (offsetParent can't be used, Big Picture's pages are fixed-position)
const visible = (el: Element): boolean => {
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0 && el.ownerDocument.defaultView!.getComputedStyle(el).visibility !== 'hidden';
};

// The topmost UGI layer: an open dialog, the gallery, else the UGI page
function activeLayer(doc: Document): HTMLElement | null {
	const overlays = [...doc.querySelectorAll<HTMLElement>('.ugi-overlay')].filter(visible);
	if (overlays.length) return overlays[overlays.length - 1]!;
	return [...doc.querySelectorAll<HTMLElement>('.ugi-root')].find(visible) ?? null;
}

// data-ugi-pad: a stop for the D-pad without an action (rows of a list, so it scrolls)
const clickable = (el: Element, win: Window): boolean =>
	(el.matches(NATIVE) && !(el as HTMLButtonElement).disabled) || el.hasAttribute('data-ugi-pad') || win.getComputedStyle(el).cursor === 'pointer';

// The clickable elements of a layer; an element inside another clickable one (a checkbox in its label) is left out
function targets(layer: HTMLElement): HTMLElement[] {
	const win = layer.ownerDocument.defaultView!;
	const found: HTMLElement[] = [];
	const walk = (el: Element) => {
		for (const child of el.children) {
			if (clickable(child, win) && visible(child)) found.push(child as HTMLElement);
			else walk(child);
		}
	};
	walk(layer);
	return found;
}

// The nearest target in the given direction. The ones in line with the current one come first (they
// overlap it across the move: a small icon under a wide button, the far end of the same row); the
// others only when there is none, the gap beside them counting. Centres only settle ties.
function nearest(from: HTMLElement, list: HTMLElement[], dir: number): HTMLElement | undefined {
	const a = from.getBoundingClientRect();
	const ax = a.left + a.width / 2;
	const ay = a.top + a.height / 2;
	let best: HTMLElement | undefined;
	let bestScore = Infinity;
	for (const el of list) {
		if (el === from) continue;
		const b = el.getBoundingClientRect();
		const bx = b.left + b.width / 2;
		const by = b.top + b.height / 2;
		const along = dir === UP ? a.top - b.bottom : dir === DOWN ? b.top - a.bottom : dir === LEFT ? a.left - b.right : b.left - a.right;
		const vertical = dir === UP || dir === DOWN;
		const gap = vertical ? Math.max(0, b.left - a.right, a.left - b.right) : Math.max(0, b.top - a.bottom, a.top - b.bottom);
		const centres = vertical ? Math.abs(bx - ax) : Math.abs(by - ay);
		// Only elements beyond the current one's edge (a little overlap is allowed)
		if (along < -4) continue;
		const score = (gap > 0 ? 100000 : 0) + Math.max(along, 0) + gap * 3 + centres * 0.1;
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	if (bestScore < 100000 || (dir !== LEFT && dir !== RIGHT)) return best;
	return wrapped(from, list, dir === RIGHT) ?? best;
}

// The first element of the first row of the section shown beside the side menu (UGI's page; the
// gallery's image types), whichever section of the menu the highlight is on; the only one of that
// row may sit far right (a switch)
function sectionTop(layer: HTMLElement, list: HTMLElement[], from: HTMLElement): HTMLElement | undefined {
	const area = layer.querySelector('.ugi-content') ?? from.closest('.ugi-win-body');
	const edge = from.getBoundingClientRect().right - 4;
	const found = list
		.filter((el) => !el.classList.contains('ugi-nav') && (!area || area.contains(el)) && el.getBoundingClientRect().left >= edge)
		.map((el) => ({ el, r: el.getBoundingClientRect() }));
	if (!found.length) return undefined;
	const top = found.reduce((a, b) => (b.r.top < a.r.top ? b : a));
	// The first row: what overlaps the topmost element vertically
	return found.filter(({ r }) => r.top < top.r.bottom && r.bottom > top.r.top).sort((x, y) => x.r.left - y.r.left)[0]?.el;
}

// Nothing more on the row: right goes on to the first element of the next row down, left back to the
// last of the row above, as when reading (within the same group: covers of the grid, chips of the toolbar)
function wrapped(from: HTMLElement, list: HTMLElement[], forward: boolean): HTMLElement | undefined {
	const a = from.getBoundingClientRect();
	const group = from.parentElement;
	const ay = a.top + a.height / 2;
	const rows = list
		.filter((el) => el !== from && group?.contains(el))
		.map((el) => ({ el, r: el.getBoundingClientRect() }))
		.filter(({ r }) => (forward ? r.top >= ay : r.bottom <= ay));
	if (!rows.length) return undefined;
	// The closest row: the elements overlapping the nearest one vertically
	const edge = forward ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.bottom));
	const row = rows.filter(({ r }) => (forward ? r.top <= edge + r.height / 2 : r.bottom >= edge - r.height / 2));
	row.sort((x, y) => (forward ? x.r.left - y.r.left : y.r.right - x.r.right));
	return row[0]?.el;
}

// The highlighted element, also kept here: React rewrites the class of an element whose look
// changes when pressed (a switch), and the highlight class goes with it
let focused: HTMLElement | null = null;

function setFocus(doc: Document, el: HTMLElement) {
	doc.querySelectorAll(`.${FOCUS}`).forEach((old) => old.classList.remove(FOCUS));
	el.classList.add(FOCUS);
	focused = el;
	// The whole card it belongs to comes into view when it fits (the switch of a launcher's card at
	// the bottom), then the element itself in any case
	el.closest('.ugi-card')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	const active = doc.activeElement as HTMLElement | null;
	if (active && active !== el && active.matches('input, textarea')) active.blur();
}

// Sets a select's value the way a user choice would, so React sees the change
function choose(select: HTMLSelectElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')?.set;
	setter?.call(select, value);
	select.dispatchEvent(new (select.ownerDocument.defaultView!.Event)('change', { bubbles: true }));
}

// The browser's own drop-down list can't be opened from code: the options are shown in a list of UGI's,
// under the select. The list is a layer like a dialog: the D-pad moves in it, A picks, B closes it.
function openPicker(doc: Document, layer: HTMLElement, select: HTMLSelectElement) {
	const backdrop = doc.createElement('div');
	backdrop.className = 'ugi-overlay ugi-picker';
	const list = doc.createElement('div');
	list.className = 'ugi-picker-list';
	const r = select.getBoundingClientRect();
	const below = doc.documentElement.clientHeight - r.bottom;
	Object.assign(list.style, { left: `${r.left}px`, minWidth: `${r.width}px` });
	// Below the select, or above it when there is more room there
	if (below >= r.top) Object.assign(list.style, { top: `${r.bottom + 4}px`, maxHeight: `${below - 16}px` });
	else Object.assign(list.style, { bottom: `${doc.documentElement.clientHeight - r.top + 4}px`, maxHeight: `${r.top - 16}px` });
	const close = () => {
		backdrop.remove();
		setFocus(doc, select);
	};
	let selected: HTMLElement | undefined;
	for (const option of select.options) {
		const item = doc.createElement('div');
		item.className = 'ugi-picker-item';
		item.textContent = option.textContent;
		if (option.value === select.value) {
			item.classList.add('on');
			selected = item;
		}
		item.addEventListener('click', () => {
			close();
			if (option.value !== select.value) choose(select, option.value);
		});
		list.append(item);
	}
	// Clicks stay in the list: the dialog underneath would take a click on its backdrop as "close"
	backdrop.addEventListener('click', (e) => {
		e.stopPropagation();
		if (e.target === backdrop) close();
	});
	backdrop.append(list);
	layer.append(backdrop);
	setFocus(doc, selected ?? (list.firstElementChild as HTMLElement));
}

function onButton(doc: Document, evt: Event) {
	const button = (evt as CustomEvent<{ button: number }>).detail?.button;
	const layer = activeLayer(doc);
	// While the on-screen keyboard is open the buttons are its own
	if (!layer || keyboardShown()) return;
	const list = targets(layer);
	if (!list.length) return;
	let current = doc.querySelector<HTMLElement>(`.${FOCUS}`) ?? (focused?.isConnected ? focused : null);
	if (current && !list.includes(current)) current = null;
	let handled = true;

	switch (button) {
		case UP:
		case DOWN:
		case LEFT:
		case RIGHT: {
			// First press: start from the selected section, else the first element. From a section in the
			// side menu, right goes to the top of that section; back in the side menu from the section,
			// the highlight lands on the section shown.
			const activeNav = list.find((el) => el.classList.contains('ugi-nav') && el.classList.contains('on'));
			let next = !current
				? (activeNav ?? list[0])
				: (button === RIGHT && current.classList.contains('ugi-nav') && sectionTop(layer, list, current)) || nearest(current, list, button);
			if (button === LEFT && current && !current.classList.contains('ugi-nav') && next?.classList.contains('ugi-nav') && activeNav) next = activeNav;
			if (next) setFocus(doc, next);
			break;
		}
		case OK:
			if (!current) {
				if (list[0]) setFocus(doc, list[0]);
			} else if (current.matches('input:not([type=checkbox]):not([type=radio]), textarea')) typeInto(current);
			else if (current.tagName === 'SELECT') openPicker(doc, layer, current as HTMLSelectElement);
			else {
				current.click();
				// Still highlighted once React has drawn the change
				const pressed = current;
				setTimeout(() => pressed.isConnected && focused === pressed && pressed.classList.add(FOCUS), 50);
			}
			break;
		case CANCEL: {
			const active = doc.activeElement as HTMLElement | null;
			if (active?.matches('input, textarea')) active.blur();
			// The dialog's backdrop closes it, like a click outside (it needs the press too, as from a
			// mouse); on the page itself B goes back as usual
			else if (layer.classList.contains('ugi-overlay')) {
				layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
				layer.click();
			}
			else handled = false;
			break;
		}
		case BUMPER_LEFT:
		case BUMPER_RIGHT: {
			// Previous / next section (or image type in the gallery)
			const tabs = list.filter((el) => el.classList.contains('ugi-nav'));
			const at = tabs.findIndex((el) => el.classList.contains('on'));
			const tab = tabs[at + (button === BUMPER_LEFT ? -1 : 1)];
			if (tab) {
				tab.click();
				doc.querySelectorAll(`.${FOCUS}`).forEach((old) => old.classList.remove(FOCUS));
				focused = null;
			}
			break;
		}
		default:
			handled = false;
	}
	if (handled) {
		evt.stopPropagation();
		evt.preventDefault();
	}
}

// Listens in the given window (Big Picture's); safe to call more than once
export function watchGamepad(doc: Document | undefined) {
	if (!doc || watched.has(doc)) return;
	watched.add(doc);
	doc.addEventListener('vgp_onbuttondown', (evt) => onButton(doc, evt), true);
	// The release of a handled button must not reach Steam either
	doc.addEventListener(
		'vgp_onbuttonup',
		(evt) => {
			const button = (evt as CustomEvent<{ button: number }>).detail?.button;
			if (activeLayer(doc) && !keyboardShown() && [OK, UP, DOWN, LEFT, RIGHT, BUMPER_LEFT, BUMPER_RIGHT].includes(button)) {
				evt.stopPropagation();
				evt.preventDefault();
			}
		},
		true,
	);
}
