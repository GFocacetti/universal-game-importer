import { ManagedShortcut } from "types";

export function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((x): x is string => typeof x === 'string');
	}
	return [];
}

export function toManagedShortcutArray(value: unknown): ManagedShortcut[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map((item) => ({
			id: typeof item.id === 'string' ? item.id : '',
			name: typeof item.name === 'string' ? item.name : 'Unknown',
			enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
			icon: typeof item.icon === 'string' ? item.icon : null,
			source: typeof item.source === 'string' ? item.source : null,
		}))
		.filter((item) => item.id.length > 0);
}

export function safeJsonParse<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch (err) {
		console.error('Failed to parse backend JSON:', err, value);
		return fallback;
	}
}

export function formatTimestamp(value?: string | null): string {
	if (!value) return 'Never';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}
