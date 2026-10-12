import type { SchemaOverview } from '@directus/types';
import express, { type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from '../services/users.js';
import router from './auth.js';

vi.mock('../auth/drivers/index.js', async () => {
	const { Router } = await import('express');

	return {
		createLocalAuthRouter: () => Router(),
		createLDAPAuthRouter: vi.fn(),
		createOAuth2AuthRouter: vi.fn(),
		createOpenIDAuthRouter: vi.fn(),
		createSAMLAuthRouter: vi.fn(),
	};
});

vi.mock('../utils/get-auth-providers.js', () => ({ getAuthProviders: () => [] }));
vi.mock('../services/authentication.js', () => ({ AuthenticationService: vi.fn() }));

vi.mock('../services/users.js', () => {
	const UsersService = vi.fn();
	UsersService.prototype.requestPasswordReset = vi.fn().mockResolvedValue(undefined);
	return { UsersService };
});

vi.mock('../middleware/respond.js', () => ({
	respond: (_req: Request, res: Response) => res.sendStatus(204),
}));

describe('POST /auth/password/request mail subject boundary', () => {
	const app = express();
	let server: ReturnType<typeof app.listen>;
	let url: string;

	beforeAll(async () => {
		app.use(express.json());

		app.use((req, _res, next) => {
			req.schema = { collections: {}, relations: [] } as SchemaOverview;
			next();
		});

		app.use('/auth', router);

		await new Promise<void>((resolve) => {
			server = app.listen(0, '127.0.0.1', resolve);
		});

		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/password/request`;
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});

	it.each([
		{ subject: 'Please transfer money' },
		{ subject: '<h1>Verify your bank account</h1>' },
		{ subject: 'Reset\r\nBcc: attacker@example.com' },
		{ subject: { nested: 'Injected subject' } },
		{},
	])('does not forward a subject from the HTTP body: %j', async (body) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Connection: 'close' },
			body: JSON.stringify({ email: 'user@example.com', ...body }),
		});

		expect(response.status).toBe(204);
		expect(UsersService.prototype.requestPasswordReset).toHaveBeenCalledTimes(1);
		expect(UsersService.prototype.requestPasswordReset).toHaveBeenCalledWith('user@example.com', null);
	});
});
