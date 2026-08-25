import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bus: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
	env: {
		CACHE_AUTO_PURGE: true,
		CACHE_STORE: 'memory',
	},
}));

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));
vi.mock('./bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('./logger.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
vi.mock('./redis/index.js', () => ({ redisConfigAvailable: () => true }));

const { closeCache, initializeCache } = await import('./cache.js');

beforeEach(() => {
	mocks.bus.subscribe.mockResolvedValue(undefined);
	mocks.bus.unsubscribe.mockResolvedValue(undefined);
});

afterEach(async () => {
	await closeCache().catch(() => undefined);
	vi.clearAllMocks();
});

test('deduplicates concurrent initialization and can subscribe again after close', async () => {
	await Promise.all([initializeCache(), initializeCache()]);

	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(1);

	await closeCache();
	expect(mocks.bus.unsubscribe).toHaveBeenCalledTimes(1);

	await initializeCache();
	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(2);
});

test('allows initialization retry after a subscription failure', async () => {
	mocks.bus.subscribe.mockRejectedValueOnce(new Error('subscription failed'));

	await expect(initializeCache()).rejects.toThrow('subscription failed');
	await expect(initializeCache()).resolves.toBeUndefined();

	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(2);
});
