import type { SchemaOverview } from '@directus/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSchemaCache } from '../cache.js';
import { getSchema } from './get-schema.js';

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => ({ CACHE_SCHEMA: true })),
}));

vi.mock('../cache.js', () => ({
	getSchemaCache: vi.fn(),
	setSchemaCache: vi.fn(),
}));

describe('getSchema', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns an available cached schema at the retry limit', async () => {
		const cachedSchema = { collections: {}, relations: [] } as SchemaOverview;
		vi.mocked(getSchemaCache).mockResolvedValue(cachedSchema);

		await expect(getSchema(undefined, 3)).resolves.toBe(cachedSchema);
	});

	it('rejects at the retry limit when the schema cache is empty', async () => {
		vi.mocked(getSchemaCache).mockResolvedValue(null);

		await expect(getSchema(undefined, 3)).rejects.toThrow('Failed to get Schema information: hit infinite loop');
	});
});
