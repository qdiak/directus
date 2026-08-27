import { EXTENSION_PKG_KEY, ExtensionManifest, type ExtensionType } from '@directus/extensions';
import { describe, expect, it } from 'vitest';
import { assertMarketplaceManifestAllowed } from './marketplace-manifest-policy.js';
import { SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE, type MarketplaceTrustMode } from './marketplace-trust.js';

const createRawManifest = (type: ExtensionType): Record<string, any> => {
	const common = { host: '^10.10.8', type };
	let options: Record<string, unknown>;

	if (type === 'bundle') {
		options = {
			...common,
			path: { app: 'dist/app.js', api: 'dist/api.js' },
			entries: [{ type: 'interface', name: 'bundle-interface', source: 'src/interface.ts' }],
		};
	} else if (type === 'operation') {
		options = {
			...common,
			path: { app: 'dist/app.js', api: 'dist/api.js' },
			source: { app: 'src/app.ts', api: 'src/api.ts' },
		};
	} else {
		options = { ...common, path: 'dist/index.js', source: 'src/index.ts' };
	}

	return {
		name: `directus-extension-${type}`,
		version: '1.0.0',
		[EXTENSION_PKG_KEY]: options,
	};
};

const assertAllowed = (rawManifest: Record<string, any>, mode: MarketplaceTrustMode) => {
	const manifest = ExtensionManifest.parse(rawManifest);
	assertMarketplaceManifestAllowed(manifest, rawManifest, mode);
};

describe('marketplace manifest policy', () => {
	it.each([
		['app', 'interface', true],
		['app', 'endpoint', false],
		['app', 'operation', false],
		['app', 'bundle', false],
		['all', 'interface', true],
		['all', 'endpoint', true],
		['all', 'operation', true],
		['all', 'bundle', true],
	] as Array<[MarketplaceTrustMode, ExtensionType, boolean]>)(
		'applies %s mode to a non-sandboxed %s manifest',
		(mode, type, allowed) => {
			const rawManifest = createRawManifest(type);

			if (allowed) {
				expect(() => assertAllowed(rawManifest, mode)).not.toThrow();
			} else {
				expect(() => assertAllowed(rawManifest, mode)).toThrow(`Marketplace extension type "${type}" is not allowed`);
			}
		},
	);

	it('rejects a sandboxed API manifest even in all mode', () => {
		const rawManifest = createRawManifest('endpoint');
		rawManifest[EXTENSION_PKG_KEY].sandbox = { enabled: true, requestedScopes: {} };

		expect(() => assertAllowed(rawManifest, 'all')).toThrow(SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE);
	});

	it('rejects a sandbox marker on a bundle', () => {
		const rawManifest = createRawManifest('bundle');
		rawManifest[EXTENSION_PKG_KEY].sandbox = { enabled: true, requestedScopes: {} };

		expect(ExtensionManifest.parse(rawManifest)[EXTENSION_PKG_KEY]).toHaveProperty('sandbox.enabled', true);
		expect(() => assertAllowed(rawManifest, 'all')).toThrow(SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE);
	});

	it('rejects a sandbox marker on a bundle API entry', () => {
		const rawManifest = createRawManifest('bundle');
		rawManifest[EXTENSION_PKG_KEY].entries[0] = {
			type: 'endpoint',
			name: 'bundle-endpoint',
			source: 'src/endpoint.ts',
			sandbox: { enabled: true, requestedScopes: {} },
		};

		expect(ExtensionManifest.parse(rawManifest)[EXTENSION_PKG_KEY]).toHaveProperty('entries.0.sandbox.enabled', true);
		expect(() => assertAllowed(rawManifest, 'all')).toThrow(SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE);
	});

	it('rejects disallowed bundle entry types', () => {
		const rawManifest = createRawManifest('bundle');
		rawManifest[EXTENSION_PKG_KEY].entries[0].type = 'bundle';

		expect(() => assertAllowed(rawManifest, 'all')).toThrow();
	});
});
