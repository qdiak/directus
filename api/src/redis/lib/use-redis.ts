import { Redis } from 'ioredis';
import { createRedis } from './create-redis.js';

/**
 * Memoization cache for useRedis
 *
 * @see {@link useRedis}
 */
export const _cache: { redis: Redis | undefined } = {
	redis: undefined,
};

export const trackedRedisDuplicates = new Set<Redis>();

/**
 * Access the globally shared Redis instance
 * Creates new Redis instance on first invocation
 *
 * @returns Globally shared Redis instance
 */
export const useRedis = () => {
	if (_cache.redis) return _cache.redis;

	const redis = createRedis();
	const duplicate = redis.duplicate.bind(redis);

	redis.duplicate = ((...args: Parameters<Redis['duplicate']>) => {
		const child = duplicate(...args);
		trackedRedisDuplicates.add(child);
		child.once('end', () => trackedRedisDuplicates.delete(child));
		return child;
	}) as Redis['duplicate'];

	_cache.redis = redis;

	return _cache.redis;
};

export const closeRedisClient = async (client: Redis): Promise<void> => {
	try {
		if (client.status !== 'end') await client.quit();
	} finally {
		client.disconnect();
	}
};

export const closeRedis = async (): Promise<void> => {
	const redis = _cache.redis;
	const clients = [...trackedRedisDuplicates, ...(redis ? [redis] : [])];

	_cache.redis = undefined;
	trackedRedisDuplicates.clear();

	const results = await Promise.allSettled(clients.map((client) => closeRedisClient(client)));
	const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close Redis clients');
	}
};
