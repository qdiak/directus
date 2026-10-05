import type { SchemaOverview } from '@directus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		CACHE_SCHEMA: true,
		CACHE_SCHEMA_FREEZE_ENABLED: true,
		CACHE_SCHEMA_SYNC_TIMEOUT: 50,
		CACHE_SCHEMA_MAX_ITERATIONS: 100,
	},
	bus: { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
	lock: { increment: vi.fn(), delete: vi.fn() },
	overview: vi.fn(),
	database: { select: vi.fn(() => ({ from: vi.fn(async () => []) })) },
	getSchemaCache: vi.fn(),
	setSchemaCache: vi.fn(),
}));

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));
vi.mock('@directus/schema', () => ({ createInspector: () => ({ overview: mocks.overview }) }));
vi.mock('../database/index.js', () => ({ default: () => mocks.database }));
vi.mock('../bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('../lock/index.js', () => ({ useLock: () => mocks.lock }));
vi.mock('../logger.js', () => ({ useLogger: () => ({ trace: vi.fn(), warn: vi.fn() }) }));
vi.mock('../cache.js', () => ({ getSchemaCache: mocks.getSchemaCache, setSchemaCache: mocks.setSchemaCache }));

vi.mock('../services/relations.js', () => ({
	RelationsService: class {
		async readAll() {
			return [];
		}
	},
}));

vi.mock('./get-field-system-rows.js', () => ({ getSystemFieldRowsWithAuthProviders: () => [] }));

const { getSchema } = await import('./get-schema.js');

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	mocks.env.CACHE_SCHEMA = true;
	mocks.env.CACHE_SCHEMA_FREEZE_ENABLED = true;
	mocks.env.CACHE_SCHEMA_SYNC_TIMEOUT = 50;
	mocks.getSchemaCache.mockResolvedValue(undefined);
	mocks.setSchemaCache.mockResolvedValue(undefined);
	mocks.lock.increment.mockResolvedValue(2);
	mocks.lock.delete.mockResolvedValue(undefined);
	mocks.overview.mockResolvedValue({});
	mocks.database.select.mockReturnValue({ from: vi.fn(async () => []) });
	mocks.bus.publish.mockResolvedValue(undefined);
	mocks.bus.subscribe.mockResolvedValue(undefined);
	mocks.bus.unsubscribe.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

async function listener() {
	for (let turn = 0; turn < 10 && mocks.bus.subscribe.mock.calls.length === 0; turn++) await Promise.resolve();
	expect(mocks.bus.subscribe).toHaveBeenCalled();
	return mocks.bus.subscribe.mock.calls[0]![1] as (message: { schema?: SchemaOverview | null }) => Promise<void>;
}

describe('cross-process schema synchronization', () => {
	it('stores the received schema without another database build or lock attempt', async () => {
		const schema = { collections: {}, relations: [] } as SchemaOverview;
		const waiting = getSchema();

		await (
			await listener()
		)({ schema });

		expect(await waiting).toBe(schema);
		expect(mocks.setSchemaCache).toHaveBeenCalledWith(schema);
		expect(mocks.overview).not.toHaveBeenCalled();
		expect(mocks.lock.increment).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('returns a caller-owned clone on the waiting path with freezing disabled', async () => {
		mocks.env.CACHE_SCHEMA_FREEZE_ENABLED = false;
		const schema = { collections: {}, relations: [] } as SchemaOverview;
		const waiting = getSchema();

		await (
			await listener()
		)({ schema });

		expect(await waiting).toEqual(schema);
		expect(await waiting).not.toBe(schema);
	});

	it('retries a failed builder and releases the replacement build lock', async () => {
		mocks.lock.increment.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
		const waiting = getSchema();

		await (
			await listener()
		)({ schema: null });

		await expect(waiting).resolves.toEqual({ collections: {}, relations: [] });
		expect(mocks.bus.publish).toHaveBeenCalledWith('schemaCache--done', { schema: { collections: {}, relations: [] } });
		expect(mocks.lock.delete).toHaveBeenCalledWith('schemaCache--preparing');
	});

	it('bounds retries when no schema message arrives', async () => {
		const waiting = expect(getSchema()).rejects.toThrow('hit infinite loop');
		await vi.advanceTimersByTimeAsync(200);
		await waiting;
		expect(mocks.lock.increment).toHaveBeenCalledTimes(3);
		expect(mocks.bus.unsubscribe).toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('retries a subscription failure without leaving a timer', async () => {
		mocks.bus.subscribe.mockRejectedValueOnce(new Error('subscription unavailable'));
		mocks.lock.increment.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
		await expect(getSchema()).resolves.toEqual({ collections: {}, relations: [] });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects the waiting caller when storing the transferred schema fails', async () => {
		mocks.setSchemaCache.mockRejectedValue(new Error('cache unavailable'));
		const waiting = expect(getSchema()).rejects.toThrow('cache unavailable');

		await (
			await listener()
		)({ schema: { collections: {}, relations: [] } });

		await waiting;
		expect(vi.getTimerCount()).toBe(0);
	});

	it('releases the builder lock even when publishing fails', async () => {
		mocks.lock.increment.mockResolvedValue(1);
		mocks.bus.publish.mockRejectedValue(new Error('redis unavailable'));
		await expect(getSchema()).resolves.toEqual({ collections: {}, relations: [] });
		expect(mocks.lock.delete).toHaveBeenCalledWith('schemaCache--preparing');
	});

	it('publishes a failure and releases the lock when schema inspection fails', async () => {
		mocks.lock.increment.mockResolvedValue(1);
		mocks.overview.mockRejectedValue(new Error('inspection failed'));
		await expect(getSchema()).rejects.toThrow('inspection failed');
		expect(mocks.bus.publish).toHaveBeenCalledWith('schemaCache--done', { schema: null });
		expect(mocks.lock.delete).toHaveBeenCalledWith('schemaCache--preparing');
	});

	it('bypasses both the lock and cache at the retry limit', async () => {
		await expect(getSchema({ bypassCache: true }, 3)).resolves.toEqual({ collections: {}, relations: [] });
		expect(mocks.lock.increment).not.toHaveBeenCalled();
		expect(mocks.setSchemaCache).not.toHaveBeenCalled();
	});

	it('rejects an invalid synchronization timeout before acquiring a lock', async () => {
		mocks.env.CACHE_SCHEMA_SYNC_TIMEOUT = 0;
		await expect(getSchema()).rejects.toThrow('positive integer');
		expect(mocks.lock.increment).not.toHaveBeenCalled();
	});
});
