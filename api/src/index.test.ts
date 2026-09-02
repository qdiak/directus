import type { Request } from 'express';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from './index.js';
import { ItemsService, ServerService, createApp, createEmbeddedApp, getSchema } from './index.js';
import type { EmbeddedDirectusApp, EmbeddedDirectusRequestContext, EmbeddedProgrammaticHook } from './index.js';

describe('quantum_directus_api root exports', () => {
	it('keeps the Backend V1 public API surface available through aggregate exports', () => {
		expect(createApp).toBeTypeOf('function');
		expect(createEmbeddedApp).toBeTypeOf('function');
		expect(getSchema).toBeTypeOf('function');
		expect(ItemsService).toBeTypeOf('function');
		expect(ServerService).toBeTypeOf('function');
	});

	it('exports the embedded request-context contract from the package root', () => {
		expectTypeOf<EmbeddedDirectusApp['createRequestContext']>().parameter(0).toEqualTypeOf<Request>();

		expectTypeOf<EmbeddedDirectusApp['createRequestContext']>().returns.toEqualTypeOf<
			Promise<EmbeddedDirectusRequestContext>
		>();
	});

	it('exports the public programmatic hook contract without exposing the extension manager', () => {
		expectTypeOf<EmbeddedProgrammaticHook>().toMatchTypeOf<{
			name: string;
			config: (...args: any[]) => void;
		}>();

		expect('ExtensionManager' in api).toBe(false);
	});
});
