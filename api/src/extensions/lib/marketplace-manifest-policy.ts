import { EXTENSION_PKG_KEY, type ExtensionManifest } from '@directus/extensions';
import {
	isMarketplaceExtensionAllowed,
	SandboxedApiExtensionsUnsupportedError,
	type MarketplaceTrustMode,
} from './marketplace-trust.js';

export function assertMarketplaceManifestAllowed(
	manifest: ExtensionManifest,
	rawManifest: Record<string, unknown>,
	mode: MarketplaceTrustMode,
): void {
	const extension = manifest[EXTENSION_PKG_KEY];
	const rawExtension = getRecord(rawManifest[EXTENSION_PKG_KEY]);

	if (isSandboxRequested(rawExtension?.['sandbox'])) {
		throw new SandboxedApiExtensionsUnsupportedError();
	}

	if (!isMarketplaceExtensionAllowed({ type: extension.type }, mode)) {
		throw new Error(`Marketplace extension type "${extension.type}" is not allowed in MARKETPLACE_TRUST=${mode} mode.`);
	}

	if (extension.type !== 'bundle') return;

	const rawEntries = Array.isArray(rawExtension?.['entries']) ? rawExtension['entries'] : [];

	for (const [index, entry] of extension.entries.entries()) {
		const rawEntry = getRecord(rawEntries[index]);

		if (('sandbox' in entry && entry.sandbox?.enabled) || isSandboxRequested(rawEntry?.['sandbox'])) {
			throw new SandboxedApiExtensionsUnsupportedError();
		}

		if (!isMarketplaceExtensionAllowed({ type: entry.type }, mode)) {
			throw new Error(
				`Marketplace bundle entry type "${entry.type}" is not allowed in MARKETPLACE_TRUST=${mode} mode.`,
			);
		}
	}
}

function isSandboxRequested(value: unknown): boolean {
	return value === true || getRecord(value)?.['enabled'] === true;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
