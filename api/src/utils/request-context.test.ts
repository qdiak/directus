import { useEnv } from '@directus/env';
import type { Accountability, SchemaOverview } from '@directus/types';
import type { Request } from 'express';
import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { getAccountabilityForToken } from './get-accountability-for-token.js';
import { getPermissions } from './get-permissions.js';
import { getSchema } from './get-schema.js';
import {
	applyRequestPermissions,
	authenticateRequest,
	createAuthenticatedRequestContext,
	extractTokenFromRequest,
} from './request-context.js';

vi.mock('@directus/env', () => ({ useEnv: vi.fn() }));
vi.mock('../database/index.js', () => ({ default: vi.fn() }));
vi.mock('./get-accountability-for-token.js', () => ({ getAccountabilityForToken: vi.fn() }));
vi.mock('./get-ip-from-req.js', () => ({ getIPFromReq: vi.fn(() => '127.0.0.1') }));
vi.mock('./get-permissions.js', () => ({ getPermissions: vi.fn() }));
vi.mock('./get-schema.js', () => ({ getSchema: vi.fn() }));

const database = {} as Knex;
const schema = { collections: {}, relations: [] } as unknown as SchemaOverview;
const permissions = [{ collection: 'articles', action: 'read' }] as const;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useEnv).mockReturnValue({ SESSION_COOKIE_NAME: 'directus_session_token' });
	vi.mocked(getDatabase).mockReturnValue(database);
	vi.mocked(getSchema).mockResolvedValue(schema);
	vi.mocked(getPermissions).mockResolvedValue([...permissions]);
	vi.mocked(getAccountabilityForToken).mockImplementation(async (_token, accountability) => accountability!);
	vi.spyOn(emitter, 'emitFilter').mockImplementation(async (_event, payload) => payload);
});

function request(overrides: Partial<Request> = {}): Request {
	return {
		cookies: {},
		get: vi.fn((name: string) => {
			if (name === 'user-agent') return 'test-agent';
			if (name === 'origin') return 'https://example.test';
			return undefined;
		}),
		headers: {},
		query: {},
		...overrides,
	} as unknown as Request;
}

describe('request context primitives', () => {
	it('extracts query, bearer, and session tokens with HTTP precedence', () => {
		expect(extractTokenFromRequest(request({ query: { access_token: 'query-token' } }))).toBe('query-token');

		expect(extractTokenFromRequest(request({ headers: { authorization: 'Bearer bearer-token' } }))).toBe(
			'bearer-token',
		);

		expect(extractTokenFromRequest(request({ cookies: { directus_session_token: 'session-token' } }))).toBe(
			'session-token',
		);
	});

	it('preserves request metadata and the authenticate filter extension point', async () => {
		const req = request();
		const customAccountability = { admin: true, app: true, role: 'custom-role', user: 'custom-user' };

		vi.spyOn(emitter, 'emitFilter').mockResolvedValue(customAccountability);

		await expect(authenticateRequest(req, null)).resolves.toBe(customAccountability);

		expect(emitter.emitFilter).toHaveBeenCalledWith(
			'authenticate',
			expect.objectContaining({
				admin: false,
				app: false,
				ip: '127.0.0.1',
				origin: 'https://example.test',
				user: null,
				userAgent: 'test-agent',
			}),
			{ req },
			{ accountability: null, database, schema: null },
		);

		expect(getAccountabilityForToken).not.toHaveBeenCalled();
	});

	it('creates fail-closed anonymous context and applies schema-derived permissions', async () => {
		const req = request();

		const context = await createAuthenticatedRequestContext(req);

		expect(req.token).toBeNull();

		expect(getAccountabilityForToken).toHaveBeenCalledWith(
			null,
			expect.objectContaining({ admin: false, app: false, role: null, user: null }),
		);

		expect(context).toEqual({
			accountability: expect.objectContaining({ admin: false, app: false, permissions: [...permissions] }),
			database,
			schema,
		});
	});

	it('mutates and returns the same accountability when permissions are resolved', async () => {
		const accountability = { admin: false, app: false, role: null, user: null } satisfies Accountability;

		await expect(applyRequestPermissions(accountability, schema)).resolves.toBe(accountability);

		expect(accountability.permissions).toEqual(permissions);
	});
});
