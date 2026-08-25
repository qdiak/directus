import { useEnv } from '@directus/env';
import { HitRateLimitError } from '@directus/errors';
import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createRateLimiter } from '../rate-limiter.js';
import { closeRedisClient } from '../redis/index.js';
import asyncHandler from '../utils/async-handler.js';
import { validateEnv } from '../utils/validate-env.js';

const RATE_LIMITER_GLOBAL_KEY = 'global-rate-limit';

const passThrough: RequestHandler = (_req, _res, next) => next();
let checkRateLimit: RequestHandler = passThrough;

export let rateLimiterGlobal: RateLimiterRedis | RateLimiterMemory | undefined;

export function initializeGlobalRateLimiter(): void {
	const env = useEnv();
	checkRateLimit = passThrough;
	rateLimiterGlobal = undefined;

	if (env['RATE_LIMITER_GLOBAL_ENABLED'] !== true) return;

	validateEnv(['RATE_LIMITER_GLOBAL_STORE', 'RATE_LIMITER_GLOBAL_DURATION', 'RATE_LIMITER_GLOBAL_POINTS']);
	validateConfiguration(env);

	const limiter = createRateLimiter('RATE_LIMITER_GLOBAL');
	rateLimiterGlobal = limiter;

	checkRateLimit = asyncHandler(async (_req, res, next) => {
		try {
			await limiter.consume(RATE_LIMITER_GLOBAL_KEY, 1);
		} catch (rateLimiterRes: any) {
			if (rateLimiterRes instanceof Error) throw rateLimiterRes;

			res.set('Retry-After', String(Math.round(rateLimiterRes.msBeforeNext / 1000)));
			throw new HitRateLimitError({
				limit: +(env['RATE_LIMITER_GLOBAL_POINTS'] as string),
				reset: new Date(Date.now() + rateLimiterRes.msBeforeNext),
			});
		}

		next();
	});
}

const globalRateLimitHandler: RequestHandler = (req, res, next) => checkRateLimit(req, res, next);

export default globalRateLimitHandler;

export async function closeGlobalRateLimiter(): Promise<void> {
	const activeRateLimiter = rateLimiterGlobal;
	checkRateLimit = passThrough;
	rateLimiterGlobal = undefined;

	if (activeRateLimiter && 'client' in activeRateLimiter) {
		await closeRedisClient(activeRateLimiter.client as Redis);
	}
}

function validateConfiguration(env: Record<string, unknown>) {
	if (env['RATE_LIMITER_ENABLED'] !== true) {
		throw new Error(`The IP based rate limiter needs to be enabled when using the global rate limiter.`);
	}

	const globalPointsPerSec =
		Number(env['RATE_LIMITER_GLOBAL_POINTS']) / Math.max(Number(env['RATE_LIMITER_GLOBAL_DURATION']), 1);

	const regularPointsPerSec = Number(env['RATE_LIMITER_POINTS']) / Math.max(Number(env['RATE_LIMITER_DURATION']), 1);

	if (globalPointsPerSec <= regularPointsPerSec) {
		throw new Error(`The global rate limiter needs to allow more requests per second than the IP based rate limiter.`);
	}
}
