import {
	list as listRegistry,
	type ListOptions,
	type ListQuery,
	type RegistryDescribeResponse,
	type RegistryListResponse,
} from '@directus/extensions-registry';
import { isMarketplaceExtensionAllowed, type MarketplaceTrustMode } from './marketplace-trust.js';

type RegistryExtensionSummary = RegistryListResponse['data'][number];
type RegistryList = (query: ListQuery, options?: ListOptions) => Promise<RegistryListResponse>;

const registryPageSize = 100;
const maximumRegistryResults = 10_000;

export async function listMarketplaceRegistry(
	query: ListQuery,
	options: ListOptions,
	mode: MarketplaceTrustMode,
	list: RegistryList = listRegistry,
): Promise<RegistryListResponse> {
	const requestedOffset = Math.max(query.offset ?? 0, 0);
	const requestedLimit = query.limit === undefined ? registryPageSize : Math.max(query.limit, 0);
	const data: RegistryListResponse['data'] = [];
	let firstPage: RegistryListResponse | undefined;
	let registryCount = 0;

	while (firstPage === undefined || data.length < registryCount) {
		const page = await list({ ...query, limit: registryPageSize, offset: data.length }, options);

		firstPage ??= page;
		registryCount = page.meta.filter_count;

		if (registryCount > maximumRegistryResults) {
			throw new Error(`Marketplace registry query returned more than ${maximumRegistryResults} results.`);
		}

		if (page.data.length === 0) break;
		data.push(...page.data);
	}

	const filtered = filterMarketplaceRegistryList({ meta: firstPage?.meta ?? { filter_count: 0 }, data }, mode);

	return {
		...filtered,
		data: filtered.data.slice(requestedOffset, requestedOffset + requestedLimit),
	};
}

export function filterMarketplaceRegistryList(
	payload: RegistryListResponse,
	mode: MarketplaceTrustMode,
): RegistryListResponse {
	const data = payload.data.filter((extension) => isMarketplaceExtensionAllowed(extension, mode));

	return {
		...payload,
		meta: { ...payload.meta, filter_count: data.length },
		data,
	};
}

export function filterMarketplaceRegistryDetail(
	payload: RegistryDescribeResponse,
	summary: RegistryExtensionSummary | undefined,
	mode: MarketplaceTrustMode,
): RegistryDescribeResponse | null {
	if (!summary || summary.id !== payload.data.id || !isMarketplaceExtensionAllowed(summary, mode)) return null;

	const versions = payload.data.versions.filter((version) => {
		if (!isMarketplaceExtensionAllowed({ type: version.type }, mode)) return false;

		return version.bundled.every((entry) => isMarketplaceExtensionAllowed({ type: entry.type }, mode));
	});

	if (versions.length === 0) return null;

	return {
		...payload,
		data: { ...payload.data, versions },
	};
}
