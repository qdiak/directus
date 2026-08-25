import { describe, expect, it, vi } from 'vitest';
import { setLifecycleState } from '../lifecycle.js';
import { ServerService } from './server.js';

const { getCache, getDatabase } = vi.hoisted(() => ({
	getCache: vi.fn(),
	getDatabase: vi.fn(),
}));

vi.mock('../database/index.js', () => ({
	default: getDatabase,
	hasDatabaseConnection: vi.fn(),
}));

vi.mock('../cache.js', () => ({
	getCache,
}));

describe('ServerService lifecycle health', () => {
	it.each(['starting', 'closing', 'closed', 'failed'] as const)(
		'returns error in %s state without creating dependency handles',
		async (state) => {
			setLifecycleState(state);

			await expect(ServerService.prototype.health.call({})).resolves.toEqual({ status: 'error' });
			expect(getDatabase).not.toHaveBeenCalled();
			expect(getCache).not.toHaveBeenCalled();
		},
	);
});
