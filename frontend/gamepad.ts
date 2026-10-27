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

const clickable = (el: Element, win: Window): boolean =>
	(el.matches(NATIVE) && !(el as HTMLButtonElement).disabled) || win.getComputedStyle(el).cursor === 'pointer';

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

// The nearest target in the given direction, favouring the ones in line with the current one
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
		const across = dir === UP || dir === DOWN ? Math.abs(bx - ax) : Math.abs(by - ay);
		// Only elements beyond the current one's edge (a little overlap is allowed)
		if (along < -4) continue;
		const score = Math.max(along, 0) + across * 3;
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	return best;
}

function setFocus(doc: Document, el: HTMLElement) {
	doc.querySelectorAll(`.${FOCUS}`).forEach((old) => old.classList.remove(FOCUS));
	el.classList.add(FOCUS);
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
	let current = doc.querySelector<HTMLElement>(`.${FOCUS}`);
	if (current && !list.includes(current)) current = null;
	let handled = true;

	switch (button) {
		case UP:
		case DOWN:
		case LEFT:
		case RIGHT: {
			// First press: start from the selected section, else the first element
			const next = current ? nearest(current, list, button) : (list.find((el) => el.classList.contains('on')) ?? list[0]);
			if (next) setFocus(doc, next);
			break;
		}
		case OK:
			if (!current) {
				if (list[0]) setFocus(doc, list[0]);
			} else if (current.matches('input:not([type=checkbox]):not([type=radio]), textarea')) typeInto(current);
			else if (current.tagName === 'SELECT') openPicker(doc, layer, current as HTMLSelectElement);
			else current.click();
			break;
		case CANCEL: {
			const active = doc.activeElement as HTMLElement | null;
			if (active?.matches('input, textarea')) active.blur();
			// The dialog's backdrop closes it, like a click outside; on the page itself B goes back as usual
			else if (layer.classList.contains('ugi-overlay')) layer.click();
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
