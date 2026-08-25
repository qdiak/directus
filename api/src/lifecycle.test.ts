import { beforeEach, describe, expect, it } from 'vitest';
import { SERVER_ONLINE, getLifecycleState, setLifecycleState } from './lifecycle.js';

describe('runtime lifecycle state', () => {
	beforeEach(() => {
		setLifecycleState('starting');
	});

	it('projects online state through the compatibility flag', () => {
		expect(getLifecycleState()).toBe('starting');
		expect(SERVER_ONLINE).toBe(false);

		setLifecycleState('online');

		expect(getLifecycleState()).toBe('online');
		expect(SERVER_ONLINE).toBe(true);
	});

	it.each(['closing', 'closed', 'failed'] as const)('marks %s state as offline', (state) => {
		setLifecycleState(state);

		expect(getLifecycleState()).toBe(state);
		expect(SERVER_ONLINE).toBe(false);
	});
});
