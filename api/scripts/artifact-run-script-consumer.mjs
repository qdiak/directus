/* eslint-env es6 */
/* eslint-disable no-console */
/* global globalThis */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = pathToFileURL(require.resolve('quantum_directus_api'));
const { default: operation } = await import(new URL('./operations/exec/index.js', packageRoot));

const loggerCalls = [];

const logger = {
	info: (value) => loggerCalls.push(['info', value]),
	warn: (value) => loggerCalls.push(['warn', value]),
	error: (value) => loggerCalls.push(['error', value]),
	trace: (value) => loggerCalls.push(['trace', value]),
	debug: (value) => loggerCalls.push(['debug', value]),
};

const hostEnvKey = 'RUN_SCRIPT_ARTIFACT_HOST_ENV';
const previousHostEnv = process.env[hostEnvKey];
process.env[hostEnvKey] = 'host-visible';

const input = {
	nested: { value: 'original' },
	$env: { RUN_SCRIPT_ARTIFACT_ALLOWED_ENV: 'allow-listed' },
};

const outputKey = Symbol.for('directus.artifact.run-script.output');

try {
	const syncResult = await operation.handler(
		{
			code: `
				module.exports = function (data) {
					data.nested.value = 'script-mutated';
					console.info('packed trusted script');

					return {
						inputValue: data.nested.value,
						localEnv: process.env.RUN_SCRIPT_ARTIFACT_ALLOWED_ENV,
						hostEnv: globalThis.process.env.RUN_SCRIPT_ARTIFACT_HOST_ENV,
					};
				};
			`,
		},
		{ data: input, logger },
	);

	assert.deepEqual(syncResult, {
		inputValue: 'script-mutated',
		localEnv: 'allow-listed',
		hostEnv: 'host-visible',
	});

	assert.deepEqual(input, {
		nested: { value: 'original' },
		$env: { RUN_SCRIPT_ARTIFACT_ALLOWED_ENV: 'allow-listed' },
	});

	assert.deepEqual(loggerCalls, [['info', 'packed trusted script']]);

	const asyncResult = await operation.handler(
		{
			code: `
				module.exports = async function (data) {
					const { posix } = await import('node:path');
					const output = {
						joined: posix.join(data.parts[0], data.parts[1]),
						nested: { value: 'original-output' },
					};

					globalThis[Symbol.for('directus.artifact.run-script.output')] = output;
					return output;
				};
			`,
		},
		{ data: { parts: ['packed', 'module'] }, logger },
	);

	const scriptOutput = globalThis[outputKey];
	assert.deepEqual(asyncResult, { joined: 'packed/module', nested: { value: 'original-output' } });
	assert.notStrictEqual(asyncResult, scriptOutput, 'the returned value must cross a structuredClone boundary');

	asyncResult.nested.value = 'consumer-mutated';
	assert.equal(scriptOutput.nested.value, 'original-output');

	console.log(
		`run-script-artifact=ok runtime=${
			process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`
		}`,
	);
} finally {
	delete globalThis[outputKey];

	if (previousHostEnv === undefined) delete process.env[hostEnvKey];
	else process.env[hostEnvKey] = previousHostEnv;
}
