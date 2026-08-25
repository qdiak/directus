import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('knex', async () => {
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const knex = require('knex');

	return {
		default: knex,
	};
});

const fixtureRoot = await mkdtemp(join(tmpdir(), 'directus-embedded-'));
const extensionsPath = join(fixtureRoot, 'extensions');
const migrationsPath = join(fixtureRoot, 'migrations');
const storagePath = join(fixtureRoot, 'uploads');

await Promise.all([
	mkdir(extensionsPath, { recursive: true }),
	mkdir(migrationsPath, { recursive: true }),
	mkdir(storagePath, { recursive: true }),
]);

Object.assign(process.env, {
	AUTH_PROVIDERS: '',
	CACHE_AUTO_PURGE: 'false',
	CACHE_ENABLED: 'false',
	DB_CLIENT: 'sqlite3',
	DB_FILENAME: join(fixtureRoot, 'directus.sqlite'),
	EMAIL_SENDMAIL_PATH: '/usr/bin/true',
	EMAIL_TRANSPORT: 'sendmail',
	KEY: 'embedded-integration-key',
	MIGRATIONS_PATH: migrationsPath,
	PRESSURE_LIMITER_ENABLED: 'false',
	PUBLIC_URL: 'http://localhost/directus',
	RATE_LIMITER_ENABLED: 'false',
	RATE_LIMITER_GLOBAL_ENABLED: 'false',
	SECRET: 'embedded-integration-secret',
	SERVE_APP: 'false',
	STORAGE_LOCAL_ROOT: storagePath,
	STORAGE_LOCATIONS: 'local',
	TELEMETRY: 'false',
	WEBSOCKETS_ENABLED: 'false',
});

const [{ default: getDatabase }, { default: runMigrations }, { default: installDatabase }] = await Promise.all([
	import('./database/index.js'),
	import('./database/migrations/run.js'),
	import('./database/seeds/run.js'),
]);

const { closeRuntimeResources } = await import('./runtime/close-runtime-resources.js');
const { createEmbeddedApp } = await import('./embedded.js');
const { ExtensionManager } = await import('./extensions/manager.js');

const internalOperations = vi
	.spyOn(ExtensionManager.prototype as any, 'registerInternalOperations')
	.mockResolvedValue(undefined);

const options = {
	extensionsPath,
	extensions: { schedule: false, watch: false },
	websockets: false,
	signalHandling: false,
} as const;

beforeAll(async () => {
	const database = getDatabase();

	await installDatabase(database);
	await runMigrations(database, 'latest', false);
	await closeRuntimeResources();
}, 60_000);

afterAll(async () => {
	await closeRuntimeResources().catch(() => undefined);
	internalOperations.mockRestore();
	await rm(fixtureRoot, { recursive: true, force: true });
});

describe.sequential('embedded Directus SQLite runtime', () => {
	it('serves health, closes idempotently, and recreates without owning a listener', async () => {
		const first = await createEmbeddedApp(options);

		expect(first.middleware).toBeTypeOf('function');
		await expect(first.health()).resolves.toMatchObject({ status: expect.not.stringMatching(/^error$/) });

		await Promise.all([first.close(), first.close()]);
		await expect(first.health()).resolves.toEqual({ status: 'error' });

		const second = await createEmbeddedApp(options);
		await expect(second.health()).resolves.toMatchObject({ status: expect.not.stringMatching(/^error$/) });
		await second.close();
	}, 60_000);
});
