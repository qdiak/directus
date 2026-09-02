/* eslint-env es6 */
/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const fixtureRoot = await mkdtemp(join(tmpdir(), 'directus-packed-embedded-'));
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
	KEY: 'packed-embedded-key',
	MIGRATIONS_PATH: migrationsPath,
	PRESSURE_LIMITER_ENABLED: 'false',
	PUBLIC_URL: 'http://localhost/directus',
	RATE_LIMITER_ENABLED: 'false',
	RATE_LIMITER_GLOBAL_ENABLED: 'false',
	SECRET: 'packed-embedded-secret',
	SERVE_APP: 'false',
	STORAGE_LOCAL_ROOT: storagePath,
	STORAGE_LOCATIONS: 'local',
	TELEMETRY: 'false',
	WEBSOCKETS_ENABLED: 'false',
});

let closeRuntimeResources;
let activeHandle;

try {
	const require = createRequire(import.meta.url);
	const packageRoot = pathToFileURL(require.resolve('quantum_directus_api'));
	const api = await import('quantum_directus_api');

	assert.equal(typeof api.createEmbeddedApp, 'function', 'package root must export createEmbeddedApp');
	let authenticateFilterCalls = 0;

	const [{ default: getDatabase }, { default: runMigrations }, { default: installDatabase }, runtime] =
		await Promise.all([
			import(new URL('./database/index.js', packageRoot)),
			import(new URL('./database/migrations/run.js', packageRoot)),
			import(new URL('./database/seeds/run.js', packageRoot)),
			import(new URL('./runtime/close-runtime-resources.js', packageRoot)),
		]);

	closeRuntimeResources = runtime.closeRuntimeResources;
	const database = getDatabase();
	await installDatabase(database);
	await runMigrations(database, 'latest', false);
	await closeRuntimeResources();

	const options = {
		extensionsPath,
		extensions: {
			programmaticHooks: [
				{
					name: 'packed-authenticate-hook',
					config: ({ filter }) => {
						filter('authenticate', (accountability) => {
							authenticateFilterCalls++;
							return accountability;
						});
					},
				},
			],
			schedule: false,
			watch: false,
		},
		websockets: false,
		signalHandling: false,
	};

	activeHandle = await api.createEmbeddedApp(options);
	assert.equal(typeof activeHandle.middleware, 'function');
	assert.equal(typeof activeHandle.createRequestContext, 'function');
	assert.notEqual((await activeHandle.health()).status, 'error');

	const requestContext = await activeHandle.createRequestContext({
		cookies: {},
		get: () => undefined,
		headers: {},
		ip: '127.0.0.1',
		query: {},
	});

	assert.equal(requestContext.accountability.admin, false);
	assert.equal(requestContext.accountability.app, false);
	assert.equal(requestContext.accountability.user, null);
	assert.equal(typeof requestContext.database.select, 'function');
	assert.equal(typeof requestContext.getSchema, 'function');
	assert.equal(typeof requestContext.services.ItemsService, 'function');
	assert.equal(authenticateFilterCalls, 1, 'programmatic authenticate filter must run through the packed artifact');

	const firstClose = activeHandle.close();
	const secondClose = activeHandle.close();
	assert.equal(secondClose, firstClose, 'close must return the same in-flight promise');
	assert.throws(() => activeHandle.createRequestContext({}), /closing or closed/);
	await Promise.all([firstClose, secondClose]);
	activeHandle = undefined;

	assert.deepEqual(
		await api.createEmbeddedApp(options).then(async (handle) => {
			activeHandle = handle;
			const health = await handle.health();
			await handle.close();
			activeHandle = undefined;
			return { recreated: health.status !== 'error' };
		}),
		{ recreated: true },
	);

	console.log(
		`embedded-artifact=ok runtime=${
			process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`
		}`,
	);
} finally {
	await activeHandle?.close().catch(() => undefined);
	await closeRuntimeResources?.().catch(() => undefined);
	await rm(fixtureRoot, { recursive: true, force: true });
}
