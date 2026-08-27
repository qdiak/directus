import { createError } from '@directus/errors';
import { APP_EXTENSION_TYPES, EXTENSION_TYPES, type ExtensionType } from '@directus/extensions';
import { isIn } from '@directus/utils';

export type MarketplaceTrustMode = 'app' | 'all';
export const SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE = 'Sandboxed API extensions are not supported.';
export const SandboxedApiExtensionsUnsupportedError = createError(
	'SANDBOXED_API_EXTENSIONS_UNSUPPORTED',
	SANDBOXED_API_EXTENSIONS_UNSUPPORTED_MESSAGE,
	400,
);

type MarketplaceExtensionPolicyInput = {
	type: unknown;
};

type WarningLogger = {
	warn: (message: string) => unknown;
};

let legacySandboxWarningEmitted = false;

export function resolveMarketplaceTrustMode(value: unknown): MarketplaceTrustMode {
	if (value === undefined || value === 'app' || value === 'sandbox') return 'app';
	if (value === 'all') return 'all';

	throw new Error(`Invalid MARKETPLACE_TRUST value "${String(value)}". Expected one of: app, all, sandbox.`);
}

export function warnOnLegacyMarketplaceTrust(value: unknown, logger: WarningLogger): void {
	if (value !== 'sandbox' || legacySandboxWarningEmitted) return;

	logger.warn('MARKETPLACE_TRUST=sandbox is deprecated and now behaves as MARKETPLACE_TRUST=app.');
	legacySandboxWarningEmitted = true;
}

export function isMarketplaceExtensionAllowed(
	extension: MarketplaceExtensionPolicyInput,
	mode: MarketplaceTrustMode,
): boolean {
	if (!isMarketplaceExtensionType(extension.type)) return false;

	const isAppExtension = isIn(extension.type, APP_EXTENSION_TYPES);

	if (mode === 'app') return isAppExtension;

	// A registry `sandbox` flag azt jelzi, hogy a csomag sandbox-kompatibilis,
	// nem azt, hogy a kiválasztott artifact sandboxot kér. A biztonsági döntést
	// ezért csak a letöltött nyers manifest autoritatív ellenőrzése hozhatja meg.
	return true;
}

export function isMarketplaceExtensionType(value: unknown): value is ExtensionType {
	return typeof value === 'string' && isIn(value, EXTENSION_TYPES);
}
