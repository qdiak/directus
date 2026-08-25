import { GraphQLSchema } from 'graphql';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bus: {
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
}));

vi.mock('@directus/env', () => ({ useEnv: () => ({ GRAPHQL_SCHEMA_CACHE_CAPACITY: 10 }) }));
vi.mock('../../bus/index.js', () => ({ useBus: () => mocks.bus }));

const { cache, closeGraphqlSchemaCache, initializeGraphqlSchemaCache } = await import('./schema-cache.js');

beforeEach(() => {
	mocks.bus.subscribe.mockResolvedValue(undefined);
	mocks.bus.unsubscribe.mockResolvedValue(undefined);
});

afterEach(async () => {
	await closeGraphqlSchemaCache().catch(() => undefined);
	vi.clearAllMocks();
});

test('deduplicates concurrent initialization and resets ownership on close', async () => {
	await Promise.all([initializeGraphqlSchemaCache(), initializeGraphqlSchemaCache()]);

	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(1);
	cache.set('schema', new GraphQLSchema({}));

	await closeGraphqlSchemaCache();

	expect(mocks.bus.unsubscribe).toHaveBeenCalledTimes(1);
	expect(cache.size).toBe(0);

	await initializeGraphqlSchemaCache();
	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(2);
});

test('allows initialization retry after a subscription failure', async () => {
	mocks.bus.subscribe.mockRejectedValueOnce(new Error('subscription failed'));

	await expect(initializeGraphqlSchemaCache()).rejects.toThrow('subscription failed');
	await expect(initializeGraphqlSchemaCache()).resolves.toBeUndefined();

	expect(mocks.bus.subscribe).toHaveBeenCalledTimes(2);
});
