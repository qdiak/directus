import { useEnv } from '@directus/env';
import { EXTENSION_PKG_KEY, ExtensionManifest } from '@directus/extensions';
import { getExtensionDefinition } from '@directus/extensions/node';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getFlowManager } from '../flows.js';
import { ExtensionManager } from './manager.js';

vi.mock('../bus/index.js', () => ({
	useBus: () => ({ publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }),
}));

vi.mock('../database/index.js', () => ({ default: vi.fn(() => ({})) }));

const env = useEnv();
const sandbox = { enabled: true, requestedScopes: {} };

const extensions = (['hook', 'endpoint', 'operation'] as const).map((type) => {
	const name = `sandboxed-${type}`;
	const splitPath = { app: 'dist/app.js', api: 'dist/api.js' };
	const splitSource = { app: 'src/app.ts', api: 'src/api.ts' };

	const manifest = ExtensionManifest.parse({
		name,
		version: '1.0.0',
		[EXTENSION_PKG_KEY]: {
			host: '^10.10.8',
			type,
			path: type === 'operation' ? splitPath : 'dist/index.js',
			source: type === 'operation' ? splitSource : 'src/index.ts',
			sandbox,
		},
	});

	return getExtensionDefinition(manifest, { path: `/extensions/${name}`, local: true });
});

const sandboxedBundles = (['bundle', 'entry'] as const).map((sandboxLocation) => {
	const name = `sandboxed-bundle-${sandboxLocation}`;

	const sandboxedEntry = {
		type: 'endpoint',
		name: 'nested-endpoint',
		source: 'src/endpoint.ts',
		...(sandboxLocation === 'entry' ? { sandbox } : {}),
	};

	const manifest = ExtensionManifest.parse({
		name,
		version: '1.0.0',
		[EXTENSION_PKG_KEY]: {
			host: '^10.10.8',
			type: 'bundle',
			path: { app: 'dist/app.js', api: 'dist/api.js' },
			entries: [sandboxedEntry],
			...(sandboxLocation === 'bundle' ? { sandbox } : {}),
		},
	});

	return getExtensionDefinition(manifest, { path: `/extensions/${name}`, local: true });
});

const useThrowingFailureStrategy = (manager: ExtensionManager) => {
	(manager as any).options = {
		schedule: false,
		watch: false,
		failureStrategy: (error: Error): never => {
			throw error;
		},
	};
};

describe('sandboxed API extensions', () => {
	it.each([false, true])('always block startup when EXTENSIONS_MUST_LOAD is %s', async (extensionsMustLoad) => {
		env['EXTENSIONS_MUST_LOAD'] = extensionsMustLoad;

		for (const extension of [...extensions, ...sandboxedBundles]) {
			const manager = new ExtensionManager();

			useThrowingFailureStrategy(manager);
			(manager as any).localExtensions.set(extension.name, extension);

			await expect((manager as any).registerApiExtensions()).rejects.toThrow(
				'Sandboxed API extensions are not supported.',
			);
		}
	});

	it('performs the sandbox preflight before registering any API extension', async () => {
		const manager = new ExtensionManager();
		const registerHookExtension = vi.spyOn(manager as any, 'registerHookExtension');

		useThrowingFailureStrategy(manager);
		(manager as any).localExtensions.set('sandboxed-hook', extensions[0]);

		(manager as any).localExtensions.set('regular-hook', {
			...extensions[0],
			name: 'regular-hook',
			sandbox: undefined,
		});

		(manager as any).extensionsSettings = [
			{ source: 'local', folder: 'sandboxed-hook', enabled: true },
			{ source: 'local', folder: 'regular-hook', enabled: true },
		];

		await expect((manager as any).registerApiExtensions()).rejects.toThrow(
			'Sandboxed API extensions are not supported.',
		);

		expect(registerHookExtension).not.toHaveBeenCalled();
	});

	it('imports, registers, and unregisters regular hook, endpoint, and operation modules', async () => {
		const testRoot = await mkdtemp(join(tmpdir(), 'directus-trusted-extensions-'));
		const manager = new ExtensionManager();
		const flowManager = getFlowManager();
		const operationId = 'trusted-operation-regression';

		try {
			const regularExtensions = await Promise.all(
				(
					[
						['hook', `export default ({ embed }) => embed('head', '<meta name="trusted-hook" />');`],
						[
							'endpoint',
							`export default (router) => router.get('/probe', (_request, response) => response.send('ok'));`,
						],
						['operation', `export default { id: '${operationId}', handler: async () => 'ok' };`],
					] as const
				).map(async ([type, source]) => {
					const name = `trusted-${type}`;
					const extensionPath = join(testRoot, name);
					const entrypoint = type === 'operation' ? 'dist/api.mjs' : 'dist/index.mjs';

					await mkdir(join(extensionPath, 'dist'), { recursive: true });
					await writeFile(join(extensionPath, entrypoint), source);

					const manifest = ExtensionManifest.parse({
						name,
						version: '1.0.0',
						[EXTENSION_PKG_KEY]: {
							host: '^10.10.8',
							type,
							path: type === 'operation' ? { app: 'dist/app.js', api: entrypoint } : entrypoint,
							source: type === 'operation' ? { app: 'src/app.ts', api: 'src/api.ts' } : 'src/index.ts',
						},
					});

					return getExtensionDefinition(manifest, { path: extensionPath, local: true });
				}),
			);

			useThrowingFailureStrategy(manager);

			for (const extension of regularExtensions) {
				(manager as any).localExtensions.set(extension.name, extension);
			}

			(manager as any).extensionsSettings = regularExtensions.map((extension) => ({
				source: 'local',
				folder: extension.name,
				enabled: true,
			}));

			await expect((manager as any).registerApiExtensions()).resolves.toBeUndefined();

			expect(manager.getEmbeds().head).toContain('trusted-hook');
			expect(manager.getEndpointRouter().stack).toHaveLength(1);
			expect((flowManager as any).operations.has(operationId)).toBe(true);
			expect((manager as any).unregisterFunctionMap.size).toBe(3);

			await (manager as any).unregisterApiExtensions();

			expect(manager.getEmbeds().head).not.toContain('trusted-hook');
			expect(manager.getEndpointRouter().stack).toHaveLength(0);
			expect((flowManager as any).operations.has(operationId)).toBe(false);
		} finally {
			await (manager as any).unregisterApiExtensions();
			await rm(testRoot, { recursive: true, force: true });
		}
	});

	it.each([false, true])(
		'keeps regular extension error handling when EXTENSIONS_MUST_LOAD is %s',
		(extensionsMustLoad) => {
			const manager = new ExtensionManager();
			const failureStrategy = vi.fn();

			env['EXTENSIONS_MUST_LOAD'] = extensionsMustLoad;
			(manager as any).options = { failureStrategy };

			(manager as any).handleExtensionError({
				error: new Error('regular failure'),
				reason: 'regular extension failed',
			});

			expect(failureStrategy).toHaveBeenCalledTimes(extensionsMustLoad ? 1 : 0);
		},
	);
});
