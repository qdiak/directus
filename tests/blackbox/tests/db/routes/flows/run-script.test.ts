import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { spawn, type ChildProcess } from 'child_process';
import getPort from 'get-port';
import type { Knex } from 'knex';
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const envVariable = 'RUN_SCRIPT_BLACKBOX_ENV';

describe('Run Script flow operation', () => {
	const databases = new Map<Vendor, Knex>();
	const directusInstances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Env>;

	beforeAll(async () => {
		const connections = [];

		for (const vendor of vendors) {
			databases.set(vendor, knex(config.knexConfig[vendor]!));

			const env = cloneDeep(config.envs);
			const serverPort = await getPort();

			env[vendor]!.PORT = String(serverPort);
			env[vendor]!['FLOWS_ENV_ALLOW_LIST'] = envVariable;
			env[vendor]![envVariable] = `allowed-${vendor}`;

			const server = spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: env[vendor] });

			directusInstances[vendor] = server;
			envs[vendor] = env;
			connections.push(awaitDirectusConnection(serverPort));
		}

		await Promise.all(connections);
	}, 180_000);

	afterAll(async () => {
		const cleanupErrors: unknown[] = [];

		for (const vendor of databases.keys()) {
			try {
				await stopDirectus(directusInstances[vendor]);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}

		for (const database of databases.values()) {
			try {
				await database.destroy();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}

		if (cleanupErrors.length > 0) {
			throw new AggregateError(cleanupErrors, 'Run Script blackbox teardown encountered errors');
		}
	});

	it.each(vendors)('%s executes trusted sync and async scripts through an active manual Flow', async (vendor) => {
		const env = envs[vendor];
		const database = databases.get(vendor)!;
		const flowIds: string[] = [];
		const flowNamePrefix = `CU-86cba9d0w-${vendor}-${randomUUID()}`;

		try {
			const syncFlowId = await createManualRunScriptFlow(
				vendor,
				env,
				`${flowNamePrefix} sync trusted Run Script`,
				`const resolvedTemplate = '{{ $trigger.body.templateValue }}';
module.exports = function (data) {
	return {
		mode: 'sync',
		inputValue: data.$trigger.body.inputValue,
		resolvedTemplate,
		envValue: process.env.${envVariable},
	};
};`,
				flowIds,
			);

			const syncResponse = await request(getUrl(vendor, env))
				.post(`/flows/trigger/${syncFlowId}`)
				.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
				.send({ collection: 'tests_flow_data', inputValue: 42, templateValue: 'template-resolved' });

			expect(syncResponse.status).toBe(200);

			expect(syncResponse.body).toEqual({
				mode: 'sync',
				inputValue: 42,
				resolvedTemplate: 'template-resolved',
				envValue: `allowed-${vendor}`,
			});

			const asyncFlowId = await createManualRunScriptFlow(
				vendor,
				env,
				`${flowNamePrefix} async trusted Run Script`,
				`module.exports = async function (data) {
	const moduleName = 'node:path';
	const { posix } = await import(moduleName);
	await Promise.resolve();
	return {
		mode: 'async',
		joined: posix.join(...data.$trigger.body.pathParts),
		envValue: process.env.${envVariable},
	};
};`,
				flowIds,
			);

			const asyncResponse = await request(getUrl(vendor, env))
				.post(`/flows/trigger/${asyncFlowId}`)
				.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
				.send({ collection: 'tests_flow_data', pathParts: ['trusted', 'module'] });

			expect(asyncResponse.status).toBe(200);

			expect(asyncResponse.body).toEqual({
				mode: 'async',
				joined: 'trusted/module',
				envValue: `allowed-${vendor}`,
			});
		} finally {
			await removeTestFlows(vendor, env, database, flowIds);
		}
	});
});

async function createManualRunScriptFlow(
	vendor: Vendor,
	env: Env,
	name: string,
	code: string,
	flowIds: string[],
): Promise<string> {
	const flowResponse = await request(getUrl(vendor, env))
		.post('/flows')
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.query({ fields: ['id'] })
		.send({
			name,
			icon: 'bolt',
			status: 'active',
			accountability: 'all',
			trigger: 'manual',
			options: { collections: ['tests_flow_data'] },
		});

	expect(flowResponse.status).toBe(200);
	const flowId = flowResponse.body.data.id as string;
	flowIds.push(flowId);

	const operationResponse = await request(getUrl(vendor, env))
		.patch(`/flows/${flowId}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send({
			operation: {
				flow: flowId,
				key: 'run_script',
				name,
				position_x: 19,
				position_y: 1,
				type: 'exec',
				options: { code },
			},
		});

	expect(operationResponse.status).toBe(200);

	return flowId;
}

async function removeTestFlows(vendor: Vendor, env: Env, database: Knex, flowIds: string[]): Promise<void> {
	if (flowIds.length === 0) return;

	const operations = await database('directus_operations').select('id').whereIn('flow', flowIds);
	const operationIds = operations.map(({ id }) => String(id));
	const itemIds = [...flowIds, ...operationIds];
	const cleanupErrors: unknown[] = [];

	for (const flowId of flowIds) {
		try {
			await request(getUrl(vendor, env))
				.delete(`/flows/${flowId}`)
				.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);
		} catch (error) {
			cleanupErrors.push(error);
		}

		try {
			// Az adatbázis-takarítás szándékosan mindig lefut: egy megszakadt HTTP-kérés vagy
			// összeomlott tesztpéldány sem hagyhat Flow-, operation- vagy auditmaradványt.
			await database('directus_flows').where('id', flowId).update({ operation: null });
			await database('directus_operations').where('flow', flowId).update({ resolve: null, reject: null });
			await database('directus_operations').where('flow', flowId).delete();
			await database('directus_flows').where('id', flowId).delete();
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	const activities = await database('directus_activity')
		.select('id')
		.whereIn('collection', ['directus_flows', 'directus_operations'])
		.whereIn('item', itemIds);

	const activityIds = activities.map(({ id }) => id);

	await database('directus_revisions')
		.whereIn('activity', activityIds)
		.orWhere((builder) => {
			builder.whereIn('collection', ['directus_flows', 'directus_operations']).whereIn('item', itemIds);
		})
		.delete();

	if (activityIds.length > 0) {
		await database('directus_activity').whereIn('id', activityIds).delete();
	}

	expect(await database('directus_flows').whereIn('id', flowIds)).toHaveLength(0);
	expect(await database('directus_operations').whereIn('id', operationIds)).toHaveLength(0);

	expect(
		await database('directus_activity')
			.whereIn('collection', ['directus_flows', 'directus_operations'])
			.whereIn('item', itemIds),
	).toHaveLength(0);

	expect(
		await database('directus_revisions')
			.whereIn('collection', ['directus_flows', 'directus_operations'])
			.whereIn('item', itemIds),
	).toHaveLength(0);

	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'Run Script blackbox cleanup encountered errors');
	}
}

async function stopDirectus(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null || server.signalCode !== null) return;

	server.kill();

	if (await waitForExit(server, 5_000)) return;

	server.kill('SIGKILL');

	if (!(await waitForExit(server, 5_000))) {
		throw new Error(`Directus blackbox process ${server.pid ?? 'unknown'} did not exit after SIGKILL.`);
	}
}

function waitForExit(server: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve(true);

	return new Promise((resolve) => {
		const onExit = () => {
			clearTimeout(timeout);
			resolve(true);
		};

		const timeout = setTimeout(() => {
			server.off('exit', onExit);
			resolve(false);
		}, timeoutMs);

		timeout.unref();
		server.once('exit', onExit);
	});
}
