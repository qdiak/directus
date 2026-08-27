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

export default defineOperationApi<Options>({
	id: 'exec',
	handler: async ({ code }, { data, logger }) => {
		const module = { exports: {} as unknown };
		const inputData = structuredClone(data);
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
