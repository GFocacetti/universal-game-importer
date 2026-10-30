// In Big Picture, UGI's blocks on the game page join Steam's own controller navigation: the D-pad
// reaches what is wrapped here and A presses it. On the desktop the wrapped element stays as it is.
import { Focusable } from '@steambrew/client';
import React, { cloneElement, createContext, forwardRef, isValidElement, useContext, useEffect, useRef, useState } from 'react';

// True inside the blocks drawn in Big Picture's game page
export const GamepadMode = createContext(false);

export const useGamepad = () => useContext(GamepadMode);

// onPress: what A (or a click) does; without it the element is reachable only so the page scrolls
// to it (text). The wrapper does the pressing, so the element's own click handler is left out.
// onFocus: when the D-pad reaches it. ring: the focus ring even without an action.
export function Pressable({ onPress, onFocus, block, ring, children }: { onPress?: () => void; onFocus?: () => void; block?: boolean; ring?: boolean; children: React.ReactElement }) {
	if (!useGamepad()) return children;
	const inner = onPress && isValidElement<{ onClick?: unknown }>(children) ? cloneElement(children, { onClick: undefined }) : children;
	return (
		// Steam's navigation skips an element that does nothing: text gets an empty action, and no
		// focus ring (it is only a stop for scrolling)
		<Focusable className={block ? 'ugi-pad-block' : 'ugi-pad-inline'} onActivate={onPress ?? (() => {})} onClick={onPress} onFocus={onFocus} noFocusRing={!onPress && !ring}>
			{inner}
		</Focusable>
	);
}

// A part of the page reached as a single stop. With enterable, A goes into it (its links become
// reachable) and B, or moving out with the D-pad, comes back out.
export function Group({ enterable, children }: { enterable?: boolean; children: React.ReactNode }) {
	const pad = useGamepad();
	const [inside, setInside] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (inside) box.current?.querySelector<HTMLElement>('.ugi-pad-inline, .ugi-pad-block')?.focus();
	}, [inside]);
	if (!pad) return <>{children}</>;
	const leave = (e: CustomEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setInside(false);
		box.current?.focus();
	};
	return (
		<Focusable
			ref={box}
			className="ugi-pad-block"
			onActivate={inside ? undefined : enterable ? () => setInside(true) : () => {}}
			onCancel={inside ? leave : undefined}
			onBlur={(e: React.FocusEvent) => {
				if (!box.current?.contains(e.relatedTarget as Node | null)) setInside(false);
			}}
		>
			<GamepadMode.Provider value={inside}>{children}</GamepadMode.Provider>
		</Focusable>
	);
}

// A row (the trailer and screenshot thumbnails): left and right move along it, up and down leave it
export const Row = forwardRef<HTMLDivElement, { className: string; children: React.ReactNode }>(({ className, children }, ref) => {
	if (!useGamepad())
		return (
			<div className={className} ref={ref}>
				{children}
			</div>
		);
	return (
		<Focusable className={className} ref={ref} flow-children="horizontal">
			{children}
		</Focusable>
	);
});
