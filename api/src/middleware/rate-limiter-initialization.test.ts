import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../rate-limiter.js';
import { closeRedisClient } from '../redis/index.js';
import { validateEnv } from '../utils/validate-env.js';
import { closeGlobalRateLimiter, initializeGlobalRateLimiter } from './rate-limiter-global.js';
import { closeRateLimiter, initializeRateLimiter } from './rate-limiter-ip.js';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, unknown>,
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => mockEnv),
}));

vi.mock('../rate-limiter.js', () => ({
	createRateLimiter: vi.fn(() => ({ consume: vi.fn() })),
}));

vi.mock('../utils/validate-env.js', () => ({
	validateEnv: vi.fn(),
}));

vi.mock('../redis/index.js', () => ({
	closeRedisClient: vi.fn(),
}));

describe('rate limiter initialization', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	});

	it('has no configuration or client creation side effects on import', () => {
		expect(validateEnv).not.toHaveBeenCalled();
		expect(createRateLimiter).not.toHaveBeenCalled();
	});

	it('creates enabled rate limiters only during explicit initialization', () => {
		Object.assign(mockEnv, {
			RATE_LIMITER_ENABLED: true,
			RATE_LIMITER_DURATION: 1,
			RATE_LIMITER_POINTS: 10,
			RATE_LIMITER_GLOBAL_ENABLED: true,
			RATE_LIMITER_GLOBAL_DURATION: 1,
			RATE_LIMITER_GLOBAL_POINTS: 100,
		});

		initializeRateLimiter();
		initializeGlobalRateLimiter();

		expect(createRateLimiter).toHaveBeenNthCalledWith(1, 'RATE_LIMITER');
		expect(createRateLimiter).toHaveBeenNthCalledWith(2, 'RATE_LIMITER_GLOBAL');
	});

	it('throws invalid global configuration instead of exiting the process', () => {
		Object.assign(mockEnv, {
			RATE_LIMITER_ENABLED: false,
			RATE_LIMITER_GLOBAL_ENABLED: true,
		});

		expect(() => initializeGlobalRateLimiter()).toThrow(
			'The IP based rate limiter needs to be enabled when using the global rate limiter.',
		);
	});

	it('closes Redis clients and resets initialized rate limiters', async () => {
		const ipClient = {};
		const globalClient = {};

		Object.assign(mockEnv, {
			RATE_LIMITER_ENABLED: true,
			RATE_LIMITER_DURATION: 1,
			RATE_LIMITER_POINTS: 10,
			RATE_LIMITER_GLOBAL_ENABLED: true,
			RATE_LIMITER_GLOBAL_DURATION: 1,
			RATE_LIMITER_GLOBAL_POINTS: 100,
		});

		vi.mocked(createRateLimiter)
			.mockReturnValueOnce({ client: ipClient } as any)
			.mockReturnValueOnce({ client: globalClient } as any);

		initializeRateLimiter();
		initializeGlobalRateLimiter();

		await closeRateLimiter();
		await closeGlobalRateLimiter();

		expect(closeRedisClient).toHaveBeenCalledWith(ipClient);
		expect(closeRedisClient).toHaveBeenCalledWith(globalClient);
	});
});
