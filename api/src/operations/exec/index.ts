import { defineOperationApi } from '@directus/extensions';

type Options = {
	code: string;
};

/**
 * A helper for making the logs prettier.
 * The logger prints arrays with their indices but this looks "bad" when you have only one argument.
 */
function unpackArgs(args: any[]) {
	return args.length === 1 ? args[0] : args;
}

function normalizeCloneableRecords(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);

	if (Array.isArray(value)) {
		const normalized = new Array(value.length);
		seen.set(value, normalized);
		value.forEach((item, index) => (normalized[index] = normalizeCloneableRecords(item, seen)));
		return normalized;
	}

	if (value instanceof Map) {
		const normalized = new Map();
		seen.set(value, normalized);

		for (const [key, item] of value) {
			normalized.set(normalizeCloneableRecords(key, seen), normalizeCloneableRecords(item, seen));
		}

		return normalized;
	}

	if (value instanceof Set) {
		const normalized = new Set();
		seen.set(value, normalized);

		for (const item of value) {
			normalized.add(normalizeCloneableRecords(item, seen));
		}

		return normalized;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;

	const normalized: Record<string, unknown> = {};
	seen.set(value, normalized);

	for (const [key, item] of Object.entries(value)) {
		normalized[key] = normalizeCloneableRecords(item, seen);
	}

	return normalized;
}

function cloneFlowInput(data: Record<string, unknown>): Record<string, unknown> {
	try {
		return structuredClone(data);
	} catch {
		// A Bun shared-host HTTP adapterének header rekordja kívülről sima objektum,
		// mégis elutasítja a structuredClone. A fallback csak az enumerable rekordhéjat
		// építi újra, így a Flow adata továbbra is a natív structuredClone határán másolódik.
		return structuredClone(normalizeCloneableRecords(data)) as Record<string, unknown>;
	}
}

export default defineOperationApi<Options>({
	id: 'exec',
	handler: async ({ code }, { data, logger }) => {
		const module = { exports: {} as unknown };
		const inputData = cloneFlowInput(data);
		const process = { env: inputData['$env'] ?? {} };

		const console = {
			log: (...args: any[]) => logger.info(unpackArgs(args)),
			info: (...args: any[]) => logger.info(unpackArgs(args)),
			warn: (...args: any[]) => logger.warn(unpackArgs(args)),
			error: (...args: any[]) => logger.error(unpackArgs(args)),
			trace: (...args: any[]) => logger.trace(unpackArgs(args)),
			debug: (...args: any[]) => logger.debug(unpackArgs(args)),
		};

		// Run Script code is fully trusted administrator code. The local process and console values
		// are convenience APIs, not isolation boundaries, so host globals remain accessible.
		const initializeModule = new Function('module', 'exports', 'process', 'console', code);
		initializeModule(module, module.exports, process, console);

		const exportedFunction = module.exports;

		if (typeof exportedFunction !== 'function') {
			throw new TypeError('module.exports is not a function');
		}

		return structuredClone(await exportedFunction(inputData));
	},
});
