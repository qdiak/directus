import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Request } from 'express';
import { isEqual } from 'lodash-es';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { getAccountabilityForToken } from './get-accountability-for-token.js';
import { getIPFromReq } from './get-ip-from-req.js';

/**
 * Extracts the request access token with the same RFC6750 and session-cookie
 * semantics used by Directus HTTP middleware.
 */
export function extractTokenFromRequest(req: Request): string | null {
	const env = useEnv();
	let token: string | null = null;

	if (req.query && req.query['access_token']) {
		token = req.query['access_token'] as string;
	}

	if (req.headers && req.headers.authorization) {
		const parts = req.headers.authorization.split(' ');

		if (parts.length === 2 && parts[0]!.toLowerCase() === 'bearer') {
			if (token !== null) {
				throw new InvalidPayloadError({
					reason: 'The request uses more than one method for including an access token',
				});
			}

			token = parts[1]!;
		}
	}

	if (req.cookies && req.cookies[env['SESSION_COOKIE_NAME'] as string] && token === null) {
		token = req.cookies[env['SESSION_COOKIE_NAME'] as string];
	}

	return token;
}

/**
 * Resolves request accountability, including the public authenticate filter
 * extension point, before falling back to Directus token authentication.
 */
export async function authenticateRequest(req: Request, token: string | null): Promise<Accountability> {
	const defaultAccountability: Accountability = {
		user: null,
		role: null,
		admin: false,
		app: false,
		ip: getIPFromReq(req),
	};

	const userAgent = req.get('user-agent')?.substring(0, 1024);
	if (userAgent) defaultAccountability.userAgent = userAgent;

	const origin = req.get('origin');
	if (origin) defaultAccountability.origin = origin;

	const database = getDatabase();

	const customAccountability = await emitter.emitFilter(
		'authenticate',
		defaultAccountability,
		{ req },
		{
			database,
			schema: null,
			accountability: null,
		},
	);

	if (customAccountability && isEqual(customAccountability, defaultAccountability) === false) {
		return customAccountability;
	}

	return getAccountabilityForToken(token, defaultAccountability);
}
