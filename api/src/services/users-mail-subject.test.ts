import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { SchemaOverview } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stall } from '../utils/stall.js';
import { MailService } from './mail/index.js';
import { UsersService } from './users.js';

vi.mock('./mail/index.js', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockResolvedValue(undefined);
	return { MailService };
});

vi.mock('../utils/stall.js', () => ({ stall: vi.fn().mockResolvedValue(undefined) }));

const subjects = [
	undefined,
	null,
	'',
	'Please transfer money',
	'<h1>Verify your bank account</h1>',
	'Reset\r\nBcc: attacker@example.com',
	{ subject: 'Injected object' },
	['Injected array'],
];

const testSchema = { collections: {}, relations: [] } as SchemaOverview;

describe('UsersService authentication mail subjects', () => {
	let database: Knex;
	let service: UsersService;
	const env = useEnv();
	const originalSecret = env['SECRET'];
	const originalPublicUrl = env['PUBLIC_URL'];
	const originalResetUrlAllowList = env['PASSWORD_RESET_URL_ALLOW_LIST'];

	beforeAll(() => {
		env['SECRET'] = 'test-authentication-mail-secret';
		env['PUBLIC_URL'] = 'https://directus.example';
		env['PASSWORD_RESET_URL_ALLOW_LIST'] = 'https://directus.example/reset';
		database = knex.default({ client: MockClient });
		service = new UsersService({ knex: database, schema: testSchema });
	});

	beforeEach(() => {
		vi.mocked(MailService.prototype.send).mockResolvedValue(undefined);
		vi.mocked(stall).mockResolvedValue(undefined);

		vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValue({
			id: 'user-id',
			email: 'user@example.com',
			password: 'stored-password-hash',
			status: 'active',
			role: 'invite-role',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	afterAll(async () => {
		env['SECRET'] = originalSecret;
		env['PUBLIC_URL'] = originalPublicUrl;
		env['PASSWORD_RESET_URL_ALLOW_LIST'] = originalResetUrlAllowList;
		await database.destroy();
	});

	it.each(subjects.map((subject) => [subject]))(
		'uses the reset subject even when a legacy caller passes %j',
		async (subject) => {
			// Egy korábbi extension vagy JS-kliens a TypeScript contract szűkítése után is küldhet extra argumentumot.
			await Reflect.apply(service.requestPasswordReset, service, ['user@example.com', null, subject]);

			expect(MailService.prototype.send).toHaveBeenCalledTimes(1);

			expect(MailService.prototype.send).toHaveBeenCalledWith({
				to: 'user@example.com',
				subject: 'Password Reset Request',
				template: {
					name: 'password-reset-hu',
					data: {
						email: 'user@example.com',
						url: expect.stringMatching(/^https:\/\/directus\.example\/admin\/reset-password\?token=/),
					},
				},
			});

			expect(stall).toHaveBeenCalledWith(500, expect.any(Number));
		},
	);

	it.each(subjects.map((subject) => [subject]))(
		'uses the invitation subject even when a legacy caller passes %j',
		async (subject) => {
			vi.mocked((service as any).getUserByEmail).mockResolvedValueOnce({
				email: 'user@example.com',
				status: 'invited',
				role: 'invite-role',
			});

			await Reflect.apply(service.inviteUser, service, ['user@example.com', 'invite-role', null, subject]);

			expect(MailService.prototype.send).toHaveBeenCalledTimes(1);

			expect(MailService.prototype.send).toHaveBeenCalledWith({
				to: 'user@example.com',
				subject: "You've been invited",
				template: {
					name: 'user-invitation',
					data: {
						email: 'user@example.com',
						url: expect.stringMatching(/^https:\/\/directus\.example\/admin\/accept-invite\?token=/),
					},
				},
			});
		},
	);

	it('keeps the reset URL allow list and does not send mail for a rejected URL', async () => {
		await expect(service.requestPasswordReset('user@example.com', 'https://attacker.example/reset')).rejects.toThrow(
			InvalidPayloadError,
		);

		expect(MailService.prototype.send).not.toHaveBeenCalled();
	});

	it('does not send reset mail for an inactive user', async () => {
		vi.mocked((service as any).getUserByEmail).mockResolvedValueOnce({ status: 'suspended' });

		await expect(service.requestPasswordReset('user@example.com', null)).rejects.toThrow(ForbiddenError);
		expect(MailService.prototype.send).not.toHaveBeenCalled();
		expect(stall).toHaveBeenCalledWith(500, expect.any(Number));
	});
});
