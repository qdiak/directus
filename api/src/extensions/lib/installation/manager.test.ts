import { useEnv } from '@directus/env';
import { EXTENSION_PKG_KEY } from '@directus/extensions';
import { exists } from 'fs-extra';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE,
	SandboxedApiExtensionsUnsupportedError,
} from '../marketplace-trust.js';
import { InstallationManager } from './manager.js';

const { download } = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock('@directus/extensions-registry', async () => ({
	...(await vi.importActual('@directus/extensions-registry')),
	download,
}));

const env = useEnv();
const originalTempPath = env['TEMP_PATH'];
const originalMarketplaceTrust = env['MARKETPLACE_TRUST'];
let testRoot: string;

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), 'directus-install-manager-'));
	env['TEMP_PATH'] = testRoot;
	env['MARKETPLACE_TRUST'] = 'all';
	download.mockReset();
});

afterEach(async () => {
	env['TEMP_PATH'] = originalTempPath;
	env['MARKETPLACE_TRUST'] = originalMarketplaceTrust;
	await rm(testRoot, { recursive: true, force: true });
});

describe('InstallationManager marketplace validation order', () => {
	it('persists settings after manifest validation and before moving the artifact', async () => {
		const versionId = 'trusted-version';
		const extensionPath = join(testRoot, 'extensions');
		const destination = join(extensionPath, '.registry', versionId);
		const manager = new InstallationManager(extensionPath);

		download.mockResolvedValue(await createExtensionTarball(createManifest('endpoint')));

		const persistSettings = vi.fn(async () => {
			expect(await exists(destination)).toBe(false);
		});

		await manager.install(versionId, persistSettings);

		expect(persistSettings).toHaveBeenCalledOnce();
		expect(await exists(join(destination, 'package.json'))).toBe(true);
		expect(await exists(join(testRoot, 'marketplace', versionId))).toBe(false);
	});

	it('does not replace an existing artifact when settings persistence rejects a duplicate', async () => {
		const versionId = 'existing-version';
		const extensionPath = join(testRoot, 'extensions');
		const destination = join(extensionPath, '.registry', versionId);
		const marker = join(destination, 'existing.txt');
		const manager = new InstallationManager(extensionPath);

		await mkdir(destination, { recursive: true });
		await writeFile(marker, 'keep-existing');
		download.mockResolvedValue(await createExtensionTarball(createManifest('endpoint')));
		const duplicateSettingsError = new Error('duplicate settings');

		const error = await manager
			.install(versionId, async () => Promise.reject(duplicateSettingsError))
			.catch((error: unknown) => error);

		expect(error).toBe(duplicateSettingsError);
		expect(await readFile(marker, 'utf8')).toBe('keep-existing');
		expect(await exists(join(destination, 'package.json'))).toBe(false);
	});

	it('rejects a sandboxed artifact before persisting settings', async () => {
		const versionId = 'sandboxed-version';
		const extensionPath = join(testRoot, 'extensions');
		const manager = new InstallationManager(extensionPath);
		const manifest = createManifest('endpoint');

		manifest[EXTENSION_PKG_KEY].sandbox = { enabled: true, requestedScopes: {} };
		download.mockResolvedValue(await createExtensionTarball(manifest));
		const persistSettings = vi.fn();

		const error = await manager.install(versionId, persistSettings).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(SandboxedApiExtensionsUnsupportedError);
		expect(error).toMatchObject({
			code: 'SANDBOXED_API_EXTENSIONS_UNSUPPORTED',
			message: SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE,
			status: 400,
		});

		expect(persistSettings).not.toHaveBeenCalled();
		expect(await exists(join(extensionPath, '.registry', versionId))).toBe(false);
		expect(await exists(join(testRoot, 'marketplace', versionId))).toBe(false);
	});
});

function createManifest(type: 'endpoint'): Record<string, any> {
	return {
		name: `directus-extension-${type}`,
		version: '1.0.0',
		[EXTENSION_PKG_KEY]: {
			host: '^10.10.8',
			type,
			path: 'dist/index.js',
			source: 'src/index.ts',
		},
	};
}

async function createExtensionTarball(manifest: Record<string, unknown>): Promise<ReadableStream> {
	const source = await mkdtemp(join(testRoot, 'tar-source-'));
	const packageDirectory = join(source, 'package');
	const tarball = join(source, 'extension.tgz');

	await mkdir(join(packageDirectory, 'dist'), { recursive: true });
	await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest));
	await writeFile(join(packageDirectory, 'dist', 'index.js'), 'export default () => undefined;');
	await tar.c({ cwd: source, file: tarball, gzip: true }, ['package']);

	return Readable.toWeb(createReadStream(tarball)) as ReadableStream;
}
