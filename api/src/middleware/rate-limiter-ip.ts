import { useEnv } from '@directus/env';
import { HitRateLimitError } from '@directus/errors';
import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createRateLimiter } from '../rate-limiter.js';
import { closeRedisClient } from '../redis/index.js';
import asyncHandler from '../utils/async-handler.js';
import { getIPFromReq } from '../utils/get-ip-from-req.js';
import { validateEnv } from '../utils/validate-env.js';

const passThrough: RequestHandler = (_req, _res, next) => next();
let checkRateLimit: RequestHandler = passThrough;

export let rateLimiter: RateLimiterRedis | RateLimiterMemory | undefined;

export function initializeRateLimiter(): void {
	const env = useEnv();
	checkRateLimit = passThrough;
	rateLimiter = undefined;

	if (env['RATE_LIMITER_ENABLED'] !== true) return;

	validateEnv(['RATE_LIMITER_STORE', 'RATE_LIMITER_DURATION', 'RATE_LIMITER_POINTS']);

	const limiter = createRateLimiter('RATE_LIMITER');
	rateLimiter = limiter;

	checkRateLimit = asyncHandler(async (req, res, next) => {
		const ip = getIPFromReq(req);

		if (ip) {
			try {
				await limiter.consume(ip, 1);
			} catch (rateLimiterRes: any) {
				if (rateLimiterRes instanceof Error) throw rateLimiterRes;

				res.set('Retry-After', String(Math.round(rateLimiterRes.msBeforeNext / 1000)));
				throw new HitRateLimitError({
					limit: +(env['RATE_LIMITER_POINTS'] as string),
					reset: new Date(Date.now() + rateLimiterRes.msBeforeNext),
				});
			}
		}

		next();
	});
}

const rateLimitHandler: RequestHandler = (req, res, next) => checkRateLimit(req, res, next);

export default rateLimitHandler;

export async function closeRateLimiter(): Promise<void> {
	const activeRateLimiter = rateLimiter;
	checkRateLimit = passThrough;
	rateLimiter = undefined;

	if (activeRateLimiter && 'client' in activeRateLimiter) {
		await closeRedisClient(activeRateLimiter.client as Redis);
	}
}
