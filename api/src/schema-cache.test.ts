import type { SchemaOverview } from '@directus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		CACHE_ENABLED: false,
		CACHE_STORE: 'memory',
		CACHE_SCHEMA_FREEZE_ENABLED: true,
		CACHE_SYSTEM_TTL: '100ms',
		CACHE_NAMESPACE: 'schema-cache-test',
	},
	bus: { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));
vi.mock('./bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('./redis/index.js', () => ({ redisConfigAvailable: () => false }));
vi.mock('./logger.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

const { setSchemaCache, getSchemaCache, clearSystemCache, closeCache, getCache } = await import('./cache.js');

function schema(): SchemaOverview {
	return {
		collections: { sample: { fields: { value: { validation: { nested: ['original'] } } } } },
		relations: [{ meta: { nested: ['relation'] } }],
	} as unknown as SchemaOverview;
}

beforeEach(() => {
	mocks.env.CACHE_SCHEMA_FREEZE_ENABLED = true;
	mocks.bus.publish.mockResolvedValue(undefined);
	mocks.bus.unsubscribe.mockResolvedValue(undefined);
	vi.useFakeTimers();
});

afterEach(async () => {
	await closeCache();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('schema cache ownership', () => {
	it('reuses one deeply frozen object without storing the schema in Keyv', async () => {
		const input = schema();
		await setSchemaCache(input);
		expect(await getSchemaCache()).toBe(input);
		expect(await getSchemaCache()).toBe(input);
		expect(await getCache().localSchemaCache.get('schema')).toBeUndefined();
		const field = input.collections.sample!.fields.value!;

		expect(() => {
			field.validation = null;
		}).toThrow(TypeError);

		expect(() => {
			input.relations.push({} as any);
		}).toThrow(TypeError);

		expect(() => {
			(field.validation as any).nested.push('changed');
		}).toThrow(TypeError);
	});

	it('also freezes children of a previously shallow-frozen root', async () => {
		const input = Object.freeze(schema());
		await setSchemaCache(input);
		expect(Object.isFrozen(input.collections.sample!.fields)).toBe(true);
	});

	it('returns independent mutable clones when freezing is disabled', async () => {
		mocks.env.CACHE_SCHEMA_FREEZE_ENABLED = false;
		await setSchemaCache(schema());
		const first = (await getSchemaCache())!;
		const second = (await getSchemaCache())!;
		first.collections.sample!.fields.value!.validation = null;
		first.relations.length = 0;
		expect(second.collections.sample!.fields.value!.validation).toEqual({ nested: ['original'] });
		expect(second.relations).toHaveLength(1);
		expect(first).not.toBe(second);
	});

	it('expires the schema with the hash TTL', async () => {
		await setSchemaCache(schema());
		await vi.advanceTimersByTimeAsync(101);
		expect(await getSchemaCache()).toBeUndefined();
	});

	it('rejects a stale local schema when the shared hash changes', async () => {
		await setSchemaCache(schema());
		await getCache().sharedSchemaCache.set('hash', 'another-process-schema');
		expect(await getSchemaCache()).toBeUndefined();
	});

	it('does not resurrect a schema when invalidation races with a Redis write', async () => {
		const { sharedSchemaCache } = getCache();
		let release!: () => void;

		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});

		const originalSet = sharedSchemaCache.set.bind(sharedSchemaCache);

		const write = vi.spyOn(sharedSchemaCache, 'set').mockImplementationOnce(async (key, value) => {
			await pending;
			return originalSet(key, value);
		});

		const storing = setSchemaCache(schema());
		await clearSystemCache({ forced: true });
		release();
		await storing;
		expect(await getSchemaCache()).toBeUndefined();
		write.mockRestore();
	});

	it('clears the schema and permits a clean cache restart', async () => {
		const first = schema();
		await setSchemaCache(first);
		await clearSystemCache({ forced: true });
		expect(await getSchemaCache()).toBeUndefined();
		await setSchemaCache(schema());
		await closeCache();
		expect(await getSchemaCache()).toBeUndefined();
		const restarted = schema();
		await setSchemaCache(restarted);
		expect(await getSchemaCache()).toBe(restarted);
		expect(await getSchemaCache()).not.toBe(first);
	});
});
