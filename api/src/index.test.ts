import { describe, expect, it } from 'vitest';
import { ItemsService, ServerService, createApp, createEmbeddedApp, getSchema } from './index.js';

describe('quantum_directus_api root exports', () => {
	it('keeps the Backend V1 public API surface available through aggregate exports', () => {
		expect(createApp).toBeTypeOf('function');
		expect(createEmbeddedApp).toBeTypeOf('function');
		expect(getSchema).toBeTypeOf('function');
		expect(ItemsService).toBeTypeOf('function');
		expect(ServerService).toBeTypeOf('function');
	});
});
