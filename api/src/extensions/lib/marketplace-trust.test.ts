import { APP_EXTENSION_TYPES, EXTENSION_TYPES } from '@directus/extensions';
import { describe, expect, it, vi } from 'vitest';
import {
	isMarketplaceExtensionAllowed,
	resolveMarketplaceTrustMode,
	warnOnLegacyMarketplaceTrust,
} from './marketplace-trust.js';

describe('marketplace trust policy', () => {
	const appExtensionTypes = new Set<string>(APP_EXTENSION_TYPES);

	it.each([
		[undefined, 'app'],
		['app', 'app'],
		['sandbox', 'app'],
		['all', 'all'],
	] as const)('normalizes %s to %s', (configuredValue, expectedMode) => {
		expect(resolveMarketplaceTrustMode(configuredValue)).toBe(expectedMode);
	});

	it.each(['', 'trusted', true, 1])('rejects the unknown trust value %s', (configuredValue) => {
		expect(() => resolveMarketplaceTrustMode(configuredValue)).toThrow('Invalid MARKETPLACE_TRUST value');
	});

	it('warns only once for the legacy sandbox alias', () => {
		const logger = { warn: vi.fn() };

		warnOnLegacyMarketplaceTrust('app', logger);
		warnOnLegacyMarketplaceTrust('sandbox', logger);
		warnOnLegacyMarketplaceTrust('sandbox', logger);

		expect(logger.warn).toHaveBeenCalledOnce();

		expect(logger.warn).toHaveBeenCalledWith(
			'MARKETPLACE_TRUST=sandbox is deprecated and now behaves as MARKETPLACE_TRUST=app.',
		);
	});

	it.each(EXTENSION_TYPES)('allows only individual App extensions in app mode: %s', (type) => {
		expect(isMarketplaceExtensionAllowed({ type }, 'app')).toBe(appExtensionTypes.has(type));
	});

	it.each(EXTENSION_TYPES)('allows every supported extension type through registry reads in all mode: %s', (type) => {
		expect(isMarketplaceExtensionAllowed({ type }, 'all')).toBe(true);
	});

	it('does not interpret the registry sandbox compatibility flag as a manifest sandbox request', () => {
		expect(isMarketplaceExtensionAllowed({ type: 'bundle' }, 'all')).toBe(true);
	});
});
