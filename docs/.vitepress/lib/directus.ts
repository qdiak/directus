import { createDirectus, rest } from '@directus/sdk';
import type { Schema } from '../types/schema.js';

export const client = createDirectus<Schema>('https://marketing.directus.app').with(rest());

// A release gate nem függhet a marketing API elérhetőségétől vagy pillanatnyi
// tartalmától. A normál docs build továbbra is élő adatot használ, a CI viszont
// a repositoryban lévő statikus dokumentációt determinisztikusan ellenőrzi.
export const skipRemoteDocsData = process.env['DOCS_SKIP_REMOTE_DATA'] === 'true';
