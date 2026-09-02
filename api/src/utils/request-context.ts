import type { Accountability, SchemaOverview } from '@directus/types';
import type { Request } from 'express';
import type { Knex } from 'knex';
import getDatabase from '../database/index.js';
import { authenticateRequest, extractTokenFromRequest } from './request-auth.js';
import { applyRequestPermissions } from './request-permissions.js';
import { getRequestSchema } from './request-schema.js';

export type AuthenticatedRequestContext = {
	accountability: Accountability;
	database: Knex;
	schema: SchemaOverview;
};

/**
 * Creates the authenticated core context shared by HTTP middleware and trusted
 * embedded consumers. Callers may add host-specific services without changing
 * authentication or permission semantics.
 */
export async function createAuthenticatedRequestContext(req: Request): Promise<AuthenticatedRequestContext> {
	const token = extractTokenFromRequest(req);
	req.token = token;

	const accountability = await authenticateRequest(req, token);
	const schema = await getRequestSchema();
	await applyRequestPermissions(accountability, schema);

	return {
		accountability,
		database: getDatabase(),
		schema,
	};
}

export { applyRequestPermissions } from './request-permissions.js';
export { authenticateRequest, extractTokenFromRequest } from './request-auth.js';
export { getRequestSchema } from './request-schema.js';
