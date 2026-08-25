import type { SchemaOverview } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { Issuer } from 'openid-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenIDAuthDriver } from './openid.js';

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => ({
		EMAIL_TEMPLATES_PATH: './templates',
		PUBLIC_URL: 'http://localhost:8055',
	})),
}));

describe('OpenIDAuthDriver initialization', () => {
	let database: Knex;

	beforeAll(() => {
		database = knex.default({ client: MockClient });
	});

	afterAll(async () => {
		await database.destroy();
	});

	it('awaits discovery and preserves its failure cause', async () => {
		const discoveryError = new Error('provider unavailable');

		vi.spyOn(Issuer, 'discover').mockRejectedValue(discoveryError);

		const driver = new OpenIDAuthDriver(
			{ knex: database, schema: { collections: {}, relations: [] } as SchemaOverview },
			{
				provider: 'example',
				issuerUrl: 'https://identity.example.test',
				clientId: 'client-id',
				clientSecret: 'client-secret',
			},
		);

		const error = await driver.initialize().catch((error: unknown) => error);

		expect(error).toMatchObject({
			message: '[OpenID] Failed to fetch provider config',
			cause: discoveryError,
		});
	});
});
