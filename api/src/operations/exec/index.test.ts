import { afterEach, describe, expect, it, vi } from 'vitest';
import config from './index.js';

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	trace: vi.fn(),
	debug: vi.fn(),
};

const runScript = (code: string, data: Record<string, unknown> = {}) =>
	config.handler({ code }, { data, logger } as any);

afterEach(() => {
	vi.clearAllMocks();
	delete (globalThis as Record<string, unknown>)['__directusRunScriptOutput'];
});

describe('Run Script operation', () => {
	it('returns a synchronous primitive result', async () => {
		await expect(runScript(`module.exports = function () { return 42; };`)).resolves.toBe(42);
	});

	it('returns a synchronous function result', async () => {
		await expect(
			runScript(
				`module.exports = function (data) {
					return { result: data.greeting + ', I ran synchronously' };
				};`,
				{ greeting: 'Hello' },
			),
		).resolves.toEqual({ result: 'Hello, I ran synchronously' });
	});

	it('returns an asynchronous function result', async () => {
		await expect(
			runScript(
				`module.exports = async function (data) {
					return { result: data.greeting + ', I ran asynchronously' };
				};`,
				{ greeting: 'Hello' },
			),
		).resolves.toEqual({ result: 'Hello, I ran asynchronously' });
	});

	it('passes a structured clone of the input to the exported function', async () => {
		const data = { nested: { value: 'before' } };

		await expect(
			runScript(
				`module.exports = function (data) {
					data.nested.value = 'inside';
					return data;
				};`,
				data,
			),
		).resolves.toEqual({ nested: { value: 'inside' } });

		expect(data).toEqual({ nested: { value: 'before' } });
	});

	it('normalizes adapter-backed records before crossing the structured clone boundary', async () => {
		const headers = new Proxy({ authorization: 'Bearer test-token', 'content-type': 'application/json' }, {});
		const request = { headers };
		const data = { $trigger: request, $last: request };

		await expect(
			runScript(
				`module.exports = function (data) {
					data.$trigger.headers.authorization = 'changed';
					return {
						authorization: data.$trigger.headers.authorization,
						sameRequest: data.$trigger === data.$last,
					};
				};`,
				data,
			),
		).resolves.toEqual({ authorization: 'changed', sameRequest: true });

		expect(headers.authorization).toBe('Bearer test-token');
	});

	it('returns a structured clone of the exported function result', async () => {
		const result = await runScript(`module.exports = function () {
			const output = { nested: { value: 'before' } };
			globalThis.__directusRunScriptOutput = output;
			return output;
		};`);

		const hostReference = (globalThis as Record<string, any>)['__directusRunScriptOutput'];
		hostReference.nested.value = 'after';

		expect(result).toEqual({ nested: { value: 'before' } });
	});

	it('exposes data.$env through the local process convenience object', async () => {
		const data = { $env: { EXAMPLE: 'allowed' } };

		await expect(
			runScript(
				`module.exports = function (data) {
					process.env.EXAMPLE = 'changed';
					return { processEnv: process.env.EXAMPLE, dataEnv: data.$env.EXAMPLE };
				};`,
				data,
			),
		).resolves.toEqual({ processEnv: 'changed', dataEnv: 'changed' });

		expect(data).toEqual({ $env: { EXAMPLE: 'allowed' } });
	});

	it('uses an empty process.env object when data.$env is absent', async () => {
		await expect(runScript(`module.exports = function () { return Object.keys(process.env); };`)).resolves.toEqual([]);
	});

	it.each([
		['log', 'info'],
		['info', 'info'],
		['warn', 'warn'],
		['error', 'error'],
		['trace', 'trace'],
		['debug', 'debug'],
	] as const)('forwards console.%s calls to logger.%s', async (consoleMethod, loggerMethod) => {
		await runScript(`module.exports = function () {
			console.${consoleMethod}('first', 'second');
		};`);

		expect(logger[loggerMethod]).toHaveBeenCalledWith(['first', 'second']);
	});

	it('unwraps a single console argument', async () => {
		await runScript(`module.exports = function () { console.info({ value: 1 }); };`);

		expect(logger.info).toHaveBeenCalledWith({ value: 1 });
	});

	it('does not replace the host console', async () => {
		const hostConsole = globalThis.console;

		await runScript(`module.exports = function () { console.info('local'); };`);

		expect(globalThis.console).toBe(hostConsole);
	});

	it('rejects direct CommonJS require usage', async () => {
		await expect(runScript(`const fs = require('node:fs');`)).rejects.toThrow('require is not defined');
	});

	it('rejects static import syntax', async () => {
		await expect(runScript(`import { readFileSync } from 'node:fs';`)).rejects.toThrow(
			'Cannot use import statement outside a module',
		);
	});

	it('allows access to host globals', async () => {
		await expect(
			runScript(`module.exports = function () {
				return { runtime: globalThis.process.release.name };
			};`),
		).resolves.toEqual({ runtime: 'node' });
	});

	it('rejects syntax errors', async () => {
		await expect(runScript(`module.exports = function () {`)).rejects.toThrow(SyntaxError);
	});

	it('rejects errors thrown while initializing the module', async () => {
		await expect(runScript(`throw new Error('setup failed');`)).rejects.toThrow('setup failed');
	});

	it('rejects a non-function module.exports value', async () => {
		await expect(runScript(`module.exports = false;`)).rejects.toThrow('module.exports is not a function');
	});

	it('rejects errors thrown by the exported function', async () => {
		await expect(runScript(`module.exports = function () { throw new Error('execution failed'); };`)).rejects.toThrow(
			'execution failed',
		);
	});
});
