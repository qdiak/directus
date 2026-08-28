import { useEnv } from '@directus/env';
import { APP_EXTENSION_TYPES, EXTENSION_TYPES, type ExtensionType } from '@directus/extensions';
import type { RegistryDescribeResponse, RegistryListResponse } from '@directus/extensions-registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionsService } from './extensions.js';

const { registryDescribe, registryList } = vi.hoisted(() => ({
	registryDescribe: vi.fn(),
	registryList: vi.fn(),
}));

vi.mock('@directus/extensions-registry', async () => ({
	...(await vi.importActual('@directus/extensions-registry')),
	describe: registryDescribe,
	list: registryList,
}));

const env = useEnv();
const originalMarketplaceTrust = env['MARKETPLACE_TRUST'];

afterEach(() => {
	env['MARKETPLACE_TRUST'] = originalMarketplaceTrust;
	registryDescribe.mockReset();
	registryList.mockReset();
});

const createService = () => {
	const service = Object.create(ExtensionsService.prototype) as ExtensionsService;

	const extensionsItemService = {
		createOne: vi.fn(),
		createMany: vi.fn(),
		deleteOne: vi.fn(),
		deleteByQuery: vi.fn(),
	};

	const extensionsManager = { install: vi.fn(), broadcastReloadNotification: vi.fn() };

	Object.assign(service, { extensionsItemService, extensionsManager });

	return { service, extensionsItemService, extensionsManager };
};

const preInstallResult = {
	extension: { data: { type: 'bundle' } },
	version: {
		id: 'version-id',
		bundled: [
			{ name: 'bundle-interface', type: 'interface' },
			{ name: 'bundle-endpoint', type: 'endpoint' },
		],
	},
};

const createRegistrySummary = (type: ExtensionType, sandbox: boolean): RegistryListResponse['data'][number] => ({
	id: 'extension-id',
	name: 'extension-id',
	description: null,
	total_downloads: 0,
	verified: true,
	type,
	last_updated: '2026-08-27T00:00:00.000Z',
	host_version: '^10.10.8',
	sandbox,
	license: null,
	publisher: { username: 'publisher', verified: true, github_name: null },
});

const createRegistryDetail = (
	type: ExtensionType,
	bundled: Array<{ name: string; type: ExtensionType }> = [],
): RegistryDescribeResponse =>
	({
		data: {
			id: 'extension-id',
			name: 'extension-id',
			type,
			versions: [{ id: 'version-id', type, bundled }],
		},
	}) as RegistryDescribeResponse;

const mockRegistryExtension = (
	type: ExtensionType,
	sandbox: boolean,
	bundled: Array<{ name: string; type: ExtensionType }> = [],
) => {
	registryDescribe.mockResolvedValue(createRegistryDetail(type, bundled));

	registryList.mockResolvedValue({
		meta: { filter_count: 1 },
		data: [createRegistrySummary(type, sandbox)],
	});
};

describe('ExtensionsService marketplace install cleanup', () => {
	const appExtensionTypes = new Set<ExtensionType>(APP_EXTENSION_TYPES);

	it.each(
		EXTENSION_TYPES.flatMap(
			(type) =>
				[
					['app', type, appExtensionTypes.has(type)],
					['all', type, true],
				] as const,
		),
	)('applies %s-mode install policy to non-sandboxed type=%s (allowed=%s)', async (mode, type, allowed) => {
		const { service, extensionsItemService, extensionsManager } = createService();

		env['MARKETPLACE_TRUST'] = mode;
		mockRegistryExtension(type, false);
		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => persistSettings());

		if (allowed) {
			await expect(service.install('extension-id', 'version-id')).resolves.toBeUndefined();
			expect(extensionsItemService.createOne).toHaveBeenCalledOnce();
			expect(extensionsManager.broadcastReloadNotification).toHaveBeenCalledOnce();
		} else {
			await expect(service.install('extension-id', 'version-id')).rejects.toThrow();
			expect(extensionsManager.install).not.toHaveBeenCalled();
			expect(extensionsItemService.createOne).not.toHaveBeenCalled();
		}
	});

	it.each(['hook', 'endpoint', 'operation', 'bundle'] as const)(
		'passes sandbox-compatible type=%s to the authoritative artifact gate in all mode',
		async (type) => {
			const { service, extensionsItemService, extensionsManager } = createService();

			env['MARKETPLACE_TRUST'] = 'all';
			mockRegistryExtension(type, true);
			extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => persistSettings());

			await expect(service.install('extension-id', 'version-id')).resolves.toBeUndefined();
			expect(extensionsManager.install).toHaveBeenCalledOnce();
			expect(extensionsItemService.createOne).toHaveBeenCalledOnce();
		},
	);

	it('allows a non-sandboxed mixed App/API bundle only in all mode', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		env['MARKETPLACE_TRUST'] = 'all';

		mockRegistryExtension('bundle', false, [
			{ name: 'bundle-interface', type: 'interface' },
			{ name: 'bundle-endpoint', type: 'endpoint' },
		]);

		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => persistSettings());

		await expect(service.install('extension-id', 'version-id')).resolves.toBeUndefined();
		expect(extensionsItemService.createOne).toHaveBeenCalledOnce();
		expect(extensionsItemService.createMany).toHaveBeenCalledOnce();
	});

	it('does not create settings when pre-install policy rejects the package', async () => {
		const { service, extensionsItemService } = createService();

		vi.spyOn(service as any, 'preInstall').mockRejectedValue(new Error('policy rejected'));

		await expect(service.install('extension-id', 'version-id')).rejects.toThrow('policy rejected');
		expect(extensionsItemService.createOne).not.toHaveBeenCalled();
	});

	it('does not create settings when artifact validation fails', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		vi.spyOn(service as any, 'preInstall').mockResolvedValue(preInstallResult);
		extensionsManager.install.mockRejectedValue(new Error('artifact rejected'));

		await expect(service.install('extension-id', 'version-id')).rejects.toThrow('artifact rejected');
		expect(extensionsItemService.createOne).not.toHaveBeenCalled();
	});

	it('does not delete an existing install when duplicate settings persistence fails', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		vi.spyOn(service as any, 'preInstall').mockResolvedValue(preInstallResult);
		extensionsItemService.createOne.mockRejectedValue(new Error('extension already installed'));
		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => persistSettings());

		await expect(service.install('extension-id', 'version-id')).rejects.toThrow('extension already installed');
		expect(extensionsItemService.deleteOne).not.toHaveBeenCalled();
		expect(extensionsManager.broadcastReloadNotification).not.toHaveBeenCalled();
	});

	it('removes root and bundled settings when activation fails after validation', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		vi.spyOn(service as any, 'preInstall').mockResolvedValue(preInstallResult);

		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => {
			await persistSettings();

			throw new Error('activation rejected');
		});

		await expect(service.install('extension-id', 'version-id')).rejects.toThrow('activation rejected');
		expect(extensionsItemService.createOne).toHaveBeenCalledOnce();
		expect(extensionsItemService.createMany).toHaveBeenCalledOnce();
		expect(extensionsItemService.deleteOne).toHaveBeenCalledWith('extension-id');
		expect(extensionsItemService.deleteByQuery).toHaveBeenCalledWith({ filter: { bundle: { _eq: 'extension-id' } } });
	});

	it('preserves the install and cleanup errors when rollback fails', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		vi.spyOn(service as any, 'preInstall').mockResolvedValue(preInstallResult);

		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => {
			await persistSettings();

			throw new Error('activation rejected');
		});

		extensionsItemService.deleteOne.mockRejectedValue(new Error('cleanup failed'));

		const error = await service.install('extension-id', 'version-id').catch((error: unknown) => error);

		expect(error).toBeInstanceOf(AggregateError);
		expect(error).toMatchObject({ errors: [new Error('activation rejected'), new Error('cleanup failed')] });
	});

	it('keeps the activated install when broadcasting the reload fails', async () => {
		const { service, extensionsItemService, extensionsManager } = createService();

		vi.spyOn(service as any, 'preInstall').mockResolvedValue(preInstallResult);

		extensionsManager.install.mockImplementation(async (_versionId, persistSettings) => {
			await persistSettings();
		});

		extensionsManager.broadcastReloadNotification.mockRejectedValue(new Error('broadcast failed'));

		await expect(service.install('extension-id', 'version-id')).rejects.toThrow('broadcast failed');
		expect(extensionsItemService.createOne).toHaveBeenCalledOnce();
		expect(extensionsItemService.createMany).toHaveBeenCalledOnce();
		expect(extensionsItemService.deleteOne).not.toHaveBeenCalled();
		expect(extensionsItemService.deleteByQuery).not.toHaveBeenCalled();
	});
});
