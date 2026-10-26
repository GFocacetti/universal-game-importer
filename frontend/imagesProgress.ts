// Games whose images are downloaded in the background after an import: their covers in the UGI page
// show it, and reload once Steam has written the new images
export type ImagesProgress = {
	// Still to do, in order (the first one is being downloaded)
	pending: number[];
	// Bumped a moment after each game is done, so the covers load again
	round: number;
};

let current: ImagesProgress = { pending: [], round: 0 };
const listeners = new Set<(progress: ImagesProgress) => void>();

function publish(next: ImagesProgress) {
	current = next;
	listeners.forEach((listener) => listener(current));
}

export function startImages(appids: number[]) {
	publish({ ...current, pending: [...current.pending, ...appids.filter((id) => !current.pending.includes(id))] });
}

export function finishImages(appid: number) {
	if (!current.pending.includes(appid)) return;
	publish({ ...current, pending: current.pending.filter((id) => id !== appid) });
	// Steam writes the images in the background: reload the covers once they are there
	for (const ms of [2000, 5000]) setTimeout(() => publish({ ...current, round: current.round + 1 }), ms);
}

// Calls the listener now and on every change; returns the function that stops watching
export function watchImages(listener: (progress: ImagesProgress) => void): () => void {
	listeners.add(listener);
	listener(current);
	return () => {
		listeners.delete(listener);
	};
}
