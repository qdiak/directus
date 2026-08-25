import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExtensionsPath, validateExtensionsPath } from './get-extensions-path.js';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, unknown>,
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => mockEnv),
}));

describe('getExtensionsPath', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];

		Object.assign(mockEnv, {
			EXTENSIONS_PATH: '/default/extensions',
			TEMP_PATH: '/tmp/directus',
		});
	});

	it('preserves the standalone environment fallback', () => {
		expect(getExtensionsPath()).toBe('/default/extensions');

		mockEnv['EXTENSIONS_LOCATION'] = 'remote';

		expect(getExtensionsPath()).toBe('/tmp/directus/extensions');
	});

	it('accepts an explicit absolute path', () => {
		expect(getExtensionsPath('/app/extensions')).toBe('/app/extensions');
	});

	it('rejects a relative explicit path', () => {
		expect(() => getExtensionsPath('./extensions')).toThrow('Explicit extensions path must be absolute');
	});

	it('rejects an explicit path combined with remote extension storage', () => {
		mockEnv['EXTENSIONS_LOCATION'] = 'remote';

		expect(() => getExtensionsPath('/app/extensions')).toThrow(
			'Explicit extensions path cannot be combined with EXTENSIONS_LOCATION',
		);
	});
});

describe('validateExtensionsPath', () => {
	const temporaryPaths: string[] = [];

	afterEach(async () => {
		await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it('accepts a readable directory', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'directus-extensions-'));
		temporaryPaths.push(directory);

		await expect(validateExtensionsPath(directory)).resolves.toBeUndefined();
	});

	it('rejects missing paths and regular files', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'directus-extensions-'));
		const file = join(directory, 'not-a-directory');
		temporaryPaths.push(directory);
		await writeFile(file, 'not an extension directory');

		await expect(validateExtensionsPath(join(directory, 'missing'))).rejects.toThrow('Explicit extensions directory');

		await expect(validateExtensionsPath(file)).rejects.toThrow('Explicit extensions directory');
	});
});
