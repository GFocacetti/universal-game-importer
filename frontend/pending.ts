import { SyncPlan } from 'importer';

// A review list waiting to be shown by the UGI page (e.g. after clicking the new-games notice)
let pending: SyncPlan | null = null;

export function setPendingReview(plan: SyncPlan) {
	pending = plan;
}

export function takePendingReview(): SyncPlan | null {
	const plan = pending;
	pending = null;
	return plan;
}
