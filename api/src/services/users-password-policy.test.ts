import type { SchemaOverview } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.js';
import { UsersService } from './users.js';

const testSchema = {
	collections: {},
	relations: [],
} as SchemaOverview;

describe('UsersService password policy', () => {
	let database: Knex;
	let service: UsersService;

	beforeAll(() => {
		database = knex.default({ client: MockClient });
		service = new UsersService({ knex: database, schema: testSchema });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await database.destroy();
	});

	it('supports regular expression literals with flags', async () => {
		vi.spyOn(SettingsService.prototype, 'readSingleton').mockResolvedValue({
			auth_password_policy: '/^strong$/i',
		});

		await expect((service as any).checkPasswordPolicy(['STRONG'])).resolves.toBeUndefined();
	});

	it('does not expose a rejected password in validation error extensions', async () => {
		const rejectedPassword = 'super-secret-password';

		vi.spyOn(SettingsService.prototype, 'readSingleton').mockResolvedValue({
			auth_password_policy: '/^allowed$/',
		});

		const error = await (service as any).checkPasswordPolicy([rejectedPassword]).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(Error);
		expect(JSON.stringify(error)).not.toContain(rejectedPassword);
	});
});
