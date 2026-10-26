import React, { useMemo, useState } from 'react';
import { imageUrls, ImageKind } from 'steamApps';

// Shows the first URL that loads; falls back to a placeholder
export function SteamImage({ appid, kind, className, label }: { appid: number; kind: ImageKind; className?: string; label?: string }) {
	const urls = useMemo(() => imageUrls(appid, kind), [appid, kind]);
	const [index, setIndex] = useState(0);
	if (index >= urls.length) return <div className={`${className ?? ''} ugi-noimg`}>{label}</div>;
	return <img className={className} src={urls[index]} onError={() => setIndex(index + 1)} />;
}
