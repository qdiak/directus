/* eslint-env es6 */
/* eslint-disable no-console */
// A tiszta packed consumer Node 18/22 és Bun alatt TS loader nélkül fut.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const role = process.env['SCHEMA_SYNC_ROLE'];
const namespace = process.env['SCHEMA_SYNC_NAMESPACE'] || `packed-schema-${process.pid}-${Date.now()}`;

if (!role) {
	const children = [];

	try {
		const builder = worker('builder', children);
		const waiters = [worker('waiter', children), worker('waiter', children)];
		await builder.until('locked');
		for (const waiter of waiters) waiter.child.send('start');
		await Promise.all(waiters.map((waiter) => waiter.until('subscribed')));
		builder.child.send('publish');
		await Promise.all(waiters.map((waiter) => waiter.until('cached')));
		builder.child.send('invalidate');
		await builder.until('invalidated');
		for (const waiter of waiters) waiter.child.send('check');
		await Promise.all(waiters.map((waiter) => waiter.until('cleared')));
		for (const child of children) child.send('close');

		await Promise.all(
			children.map(
				(child) =>
					new Promise((resolve, reject) => {
						child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`))));
					}),
			),
		);

		console.log('schema-sync=ok processes=3 redis=real auto-purge=false');
	} finally {
		for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
	}
} else {
	Object.assign(process.env, {
		CACHE_NAMESPACE: namespace,
		CACHE_STORE: 'redis',
		CACHE_AUTO_PURGE: 'false',
		CACHE_ENABLED: 'false',
		CACHE_SCHEMA_SYNC_TIMEOUT: '5000',
		REDIS_ENABLED: 'true',
		REDIS: `redis://127.0.0.1:${process.env['DIRECTUS_SCHEMA_SYNC_REDIS_PORT']}`,
		DB_CLIENT: 'sqlite3',
		DB_FILENAME: ':memory:',
		TELEMETRY: 'false',
		LOG_LEVEL: 'error',
	});

	const require = createRequire(import.meta.url);
	const root = pathToFileURL(require.resolve('quantum_directus_api'));
	const cache = await import(new URL('./cache.js', root));
	const { useBus, closeBus } = await import(new URL('./bus/index.js', root));
	const { useLock, closeLock } = await import(new URL('./lock/index.js', root));
	const { closeRedis } = await import(new URL('./redis/index.js', root));
	const { getSchema } = await import(new URL('./utils/get-schema.js', root));
	const bus = useBus();
	const lock = useLock();
	await cache.initializeCache();
	let schema;

	process.on('message', (command) => {
		void handle(command).catch((error) => {
			process.send({ error: error.stack });
			process.exitCode = 1;
		});
	});

	if (role === 'builder') {
		assert.equal(await lock.increment('schemaCache--preparing'), 1);
		process.send({ state: 'locked' });
	}

	const handle = async (command) => {
		if (command === 'start') {
			const subscribe = bus.subscribe.bind(bus);

			bus.subscribe = async (channel, callback) => {
				await subscribe(channel, callback);
				if (channel === 'schemaCache--done') process.send({ state: 'subscribed' });
			};

			schema = await getSchema();
			assert.equal(schema.collections.fixture.fields.id.field, 'id');
			assert.equal(await cache.getSchemaCache(), schema);
			assert.ok(Object.isFrozen(schema.collections.fixture.fields.id));
			process.send({ state: 'cached' });
		} else if (command === 'publish') {
			// A fixture a DB-inspekciót helyettesíti; a lock, bus és waiter valódi.
			schema = { collections: { fixture: { fields: { id: { field: 'id' } } } }, relations: [] };
			await cache.setSchemaCache(schema);
			await bus.publish('schemaCache--done', { schema });
			await lock.delete('schemaCache--preparing');
		} else if (command === 'invalidate') {
			await cache.clearSystemCache();
			process.send({ state: 'invalidated' });
		} else if (command === 'check') {
			const deadline = Date.now() + 5000;

			while (await cache.getCache().localSchemaCache.get('hash')) {
				assert.ok(Date.now() < deadline, 'Redis schemaChanged must clear the process-local hash');
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			assert.equal(await cache.getSchemaCache(), undefined);
			process.send({ state: 'cleared' });
		} else if (command === 'close') {
			await cache.closeCache();
			await closeBus();
			await closeLock();
			await closeRedis();
			process.disconnect();
		}
	};
}

function worker(workerRole, children) {
	const child = fork(fileURLToPath(import.meta.url), [], {
		env: { ...process.env, SCHEMA_SYNC_ROLE: workerRole, SCHEMA_SYNC_NAMESPACE: namespace },
		stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
	});

	children.push(child);
	const received = new Set();
	const listeners = new Set();
	let failure;

	child.on('message', (message) => {
		if (message.error) failure = new Error(message.error);
		else received.add(message.state);
		for (const check of listeners) check();
	});

	child.on('exit', (code) => {
		if (code !== 0) failure = new Error(`Schema worker failed: ${code}`);
		for (const check of listeners) check();
	});

	return {
		child,
		until(state) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${workerRole}:${state}`)), 20_000);

				function finish(error) {
					clearTimeout(timer);
					listeners.delete(check);
					if (error) reject(error);
					else resolve();
				}

				function check() {
					if (failure) finish(failure);
					else if (received.has(state)) finish();
				}

				listeners.add(check);
				check();
			});
		},
	};
}
