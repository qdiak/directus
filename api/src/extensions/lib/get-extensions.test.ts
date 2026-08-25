import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExtensions } from './get-extensions.js';

const { resolveFsExtensions, resolveModuleExtensions } = vi.hoisted(() => ({
	resolveFsExtensions: vi.fn().mockResolvedValue(new Map()),
	resolveModuleExtensions: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => ({ PACKAGE_FILE_LOCATION: '/app/package.json' })),
}));

vi.mock('@directus/extensions/node', () => ({
	resolveFsExtensions,
	resolveModuleExtensions,
}));

describe('getExtensions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses one explicit path for local and registry discovery', async () => {
		await getExtensions({ extensionsPath: '/app/extensions' });

		expect(resolveFsExtensions).toHaveBeenNthCalledWith(1, '/app/extensions');
		expect(resolveFsExtensions).toHaveBeenNthCalledWith(2, '/app/extensions/.registry');
		expect(resolveModuleExtensions).toHaveBeenCalledWith('/app/package.json');
	});
});
