import { useEnv } from '@directus/env';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { _cache, closeRedis, trackedRedisDuplicates, useRedis } from './use-redis.js';

vi.mock('ioredis');
vi.mock('../../utils/get-config-from-env.js');
vi.mock('@directus/env');

let mockRedis: Redis;

const createMockRedis = (): Redis =>
	({
		disconnect: vi.fn(),
		duplicate: vi.fn(),
		once: vi.fn(),
		quit: vi.fn().mockResolvedValue('OK'),
		status: 'ready',
	}) as unknown as Redis;

beforeEach(() => {
	mockRedis = createMockRedis();
	vi.mocked(Redis).mockReturnValue(mockRedis);
	vi.mocked(useEnv).mockReturnValue({});
});

afterEach(() => {
	_cache.redis = undefined;
	trackedRedisDuplicates.clear();
});

describe('useRedis', () => {
	test('Returns cached redis connection if exists', () => {
		_cache.redis = mockRedis;

		const redis = useRedis();

		expect(redis).toBe(mockRedis);
		expect(getConfigFromEnv).not.toHaveBeenCalled();
	});

	test('Creates new Redis instance with string env if exists', () => {
		const redis = useRedis();

		expect(redis).toBe(mockRedis);
	});

	test('tracks public duplicate clients and closes all owned Redis handles', async () => {
		const duplicate = createMockRedis();

		vi.mocked(mockRedis.duplicate).mockReturnValue(duplicate);

		const redis = useRedis();
		redis.duplicate();

		expect(trackedRedisDuplicates).toContain(duplicate);

		await closeRedis();

		expect(duplicate.quit).toHaveBeenCalledOnce();
		expect(duplicate.disconnect).toHaveBeenCalledOnce();
		expect(mockRedis.quit).toHaveBeenCalledOnce();
		expect(mockRedis.disconnect).toHaveBeenCalledOnce();
		expect(_cache.redis).toBeUndefined();
		expect(trackedRedisDuplicates).toHaveLength(0);
	});
});
