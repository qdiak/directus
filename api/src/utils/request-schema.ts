import type { SchemaOverview } from '@directus/types';
import { getSchema } from './get-schema.js';

/** Resolves the schema snapshot used by request permission evaluation. */
export async function getRequestSchema(): Promise<SchemaOverview> {
	return getSchema();
}
