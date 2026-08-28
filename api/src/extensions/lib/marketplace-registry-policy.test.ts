import type { ExtensionType } from '@directus/extensions';
import type { RegistryDescribeResponse, RegistryListResponse } from '@directus/extensions-registry';
import { describe, expect, it, vi } from 'vitest';
import {
	filterMarketplaceRegistryDetail,
	filterMarketplaceRegistryList,
	listMarketplaceRegistry,
} from './marketplace-registry-policy.js';
import type { MarketplaceTrustMode } from './marketplace-trust.js';

const createSummary = (id: string, type: ExtensionType, sandbox: boolean): RegistryListResponse['data'][number] => ({
	id,
	name: id,
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

const createList = (data: RegistryListResponse['data']): RegistryListResponse => ({
	meta: { filter_count: data.length },
	data,
});

const createDetail = (
	id: string,
	versions: Array<{ id: string; type: ExtensionType; bundled?: Array<{ name: string; type: string }> }>,
): RegistryDescribeResponse => ({
	data: {
		id,
		name: id,
		description: null,
		total_downloads: 0,
		downloads: null,
		verified: true,
		readme: null,
		type: versions[0]!.type,
		license: null,
		versions: versions.map((version) => ({
			id: version.id,
			version: '1.0.0',
			verified: true,
			type: version.type,
			host_version: '^10.10.8',
			publish_date: '2026-08-27T00:00:00.000Z',
			unpacked_size: 1,
			file_count: 1,
			url_bugs: null,
			url_homepage: null,
			url_repository: null,
			license: null,
			publisher: {
				id: 'publisher-id',
				username: 'publisher',
				verified: true,
				github_name: null,
				github_avatar_url: null,
			},
			bundled: version.bundled ?? [],
			maintainers: null,
		})),
	},
});

describe('marketplace registry policy', () => {
	const summaries = [
		createSummary('app', 'interface', true),
		createSummary('trusted-api', 'endpoint', false),
		createSummary('sandboxed-api', 'hook', true),
		createSummary('trusted-hybrid', 'operation', false),
		createSummary('trusted-bundle', 'bundle', false),
	];

	it.each([
		['app', ['app']],
		['all', ['app', 'trusted-api', 'sandboxed-api', 'trusted-hybrid', 'trusted-bundle']],
	] as const)('filters list results in %s mode', (mode, expectedIds) => {
		const result = filterMarketplaceRegistryList(createList(summaries), mode);

		expect(result.data.map(({ id }) => id)).toEqual(expectedIds);
		expect(result.meta.filter_count).toBe(expectedIds.length);
	});

	it('filters before applying pagination and preserves the allowed total', async () => {
		const registryData = Array.from({ length: 240 }, (_, index) =>
			index % 2 === 0
				? createSummary(`api-${index / 2}`, 'endpoint', false)
				: createSummary(`app-${(index - 1) / 2}`, 'interface', false),
		);

		const list = vi.fn(async (query: { limit?: number; offset?: number }) => ({
			meta: { filter_count: registryData.length },
			data: registryData.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? registryData.length)),
		}));

		const result = await listMarketplaceRegistry({ limit: 10, offset: 10 }, {}, 'app', list);

		expect(list).toHaveBeenCalledTimes(3);
		expect(result.meta.filter_count).toBe(120);
		expect(result.data.map(({ id }) => id)).toEqual(Array.from({ length: 10 }, (_, index) => `app-${index + 10}`));
	});

	it.each([
		['app', createSummary('extension', 'interface', true), true],
		['app', createSummary('extension', 'endpoint', false), false],
		['all', createSummary('extension', 'endpoint', false), true],
		['all', createSummary('extension', 'endpoint', true), true],
	] as Array<[MarketplaceTrustMode, RegistryListResponse['data'][number], boolean]>)(
		'applies the same policy to detail in %s mode for $summary.type sandbox=$summary.sandbox',
		(mode, summary, allowed) => {
			const detail = createDetail('extension', [{ id: 'version', type: summary.type }]);

			expect(filterMarketplaceRegistryDetail(detail, summary, mode) !== null).toBe(allowed);
		},
	);

	it('keeps a sandbox-compatible App-only bundle visible in all mode', () => {
		const summary = createSummary('extension', 'bundle', true);

		const detail = createDetail('extension', [
			{
				id: 'app-only-bundle',
				type: 'bundle',
				bundled: [
					{ name: 'interface', type: 'interface' },
					{ name: 'display', type: 'display' },
				],
			},
		]);

		expect(filterMarketplaceRegistryDetail(detail, summary, 'all')?.data.versions).toHaveLength(1);
	});

	it('removes versions whose type or bundled entries violate the selected policy', () => {
		const summary = createSummary('extension', 'bundle', false);

		const detail = createDetail('extension', [
			{ id: 'allowed', type: 'bundle', bundled: [{ name: 'endpoint', type: 'endpoint' }] },
			{ id: 'invalid-entry', type: 'bundle', bundled: [{ name: 'unknown', type: 'unknown' }] },
		]);

		const result = filterMarketplaceRegistryDetail(detail, summary, 'all');

		expect(result?.data.versions.map(({ id }) => id)).toEqual(['allowed']);
	});

	it('hides detail when the summary does not identify the requested extension', () => {
		const detail = createDetail('extension', [{ id: 'version', type: 'interface' }]);

		expect(filterMarketplaceRegistryDetail(detail, undefined, 'all')).toBeNull();
		expect(filterMarketplaceRegistryDetail(detail, createSummary('other', 'interface', true), 'all')).toBeNull();
	});
});
