/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = pathToFileURL(require.resolve('quantum_directus_api'));
const { default: operation } = await import(new URL('./operations/exec/index.js', packageRoot));

const result = await operation.handler(
	{
		code: `
			module.exports = async function (data) {
				return { result: data.greeting + ', packed sandbox' };
			}
		`,
	},
	{
		data: { greeting: 'Hello' },
		env: {
			FLOWS_RUN_SCRIPT_MAX_MEMORY: 8,
			FLOWS_RUN_SCRIPT_TIMEOUT: 10_000,
		},
	},
);

assert.deepEqual(result, { result: 'Hello, packed sandbox' });
console.log(`sandbox-artifact=ok runtime=node-${process.versions.node}`);
