import { getLifecycleState } from '../lifecycle.js';

let embeddedRuntimeClaimed = false;

export type EmbeddedRuntimeLease = {
	release(): void;
};

export function claimEmbeddedRuntime(): EmbeddedRuntimeLease {
	if (embeddedRuntimeClaimed || getLifecycleState() !== 'closed') {
		throw new Error('A Directus runtime is already active in this process');
	}

	embeddedRuntimeClaimed = true;
	let released = false;

	return {
		release() {
			if (released) return;

			released = true;
			embeddedRuntimeClaimed = false;
		},
	};
}

export function assertNoEmbeddedRuntime(): void {
	if (embeddedRuntimeClaimed) {
		throw new Error('An embedded Directus runtime is already active in this process');
	}
}
