import type { Accountability, SchemaOverview } from '@directus/types';
import { getPermissions } from './get-permissions.js';

/** Adds schema-derived Directus permissions to an authenticated accountability. */
export async function applyRequestPermissions(
	accountability: Accountability,
	schema: SchemaOverview,
): Promise<Accountability> {
	accountability.permissions = await getPermissions(accountability, schema);
	return accountability;
}
