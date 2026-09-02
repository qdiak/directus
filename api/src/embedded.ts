import type { Accountability, SchemaOverview } from '@directus/types';
import type { HookConfig } from '@directus/extensions';
import type { Application, Request } from 'express';
import type { Knex } from 'knex';
import { isAbsolute, normalize } from 'node:path';
import { createManagedApp, type ManagedApp } from './app.js';
import { setLifecycleState } from './lifecycle.js';
import { closeManagedRuntime } from './runtime/close-managed-runtime.js';
import { claimEmbeddedRuntime } from './runtime/embedded-ownership.js';
import { ServerService } from './services/server.js';
import { createBootstrapError, throwOnBootstrapFailure } from './utils/bootstrap-failure.js';
import { getSchema } from './utils/get-schema.js';
import { createAuthenticatedRequestContext } from './utils/request-context.js';

/**
 * Directus-owned request context exposed to trusted embedded endpoint bridges.
 * Accountability always comes from Directus request authentication and schema-
 * derived permissions; consumers cannot inject an admin fallback.
 */
export type EmbeddedDirectusRequestContext = {
	accountability: Accountability;
	database: Knex;
	getSchema: typeof getSchema;
	schema: SchemaOverview;
	services: typeof import('./services/index.js');
};

/**
 * Trusted legacy hook registration owned by the embedding application. The
 * config receives the same registration and runtime context as a filesystem
 * hook extension, while Directus retains registration and teardown ownership.
 */
export type EmbeddedProgrammaticHook = Readonly<{
	name: string;
	config: HookConfig;
}>;

export type EmbeddedDirectusOptions = {
	extensionsPath: string;
	extensions: {
		programmaticHooks?: readonly EmbeddedProgrammaticHook[];
		schedule: false;
		watch: false;
	};
	websockets: false;
	signalHandling: false;
};

export type DirectusHealth = Record<string, unknown>;

/**
 * Lifecycle-owned embedded Directus handle. Request contexts are accepted only
 * while the runtime is online and are derived from Express-compatible requests.
 */
export type EmbeddedDirectusApp = {
	middleware: Application;
	createRequestContext(request: Request): Promise<EmbeddedDirectusRequestContext>;
	health(): Promise<DirectusHealth>;
	close(): Promise<void>;
};

export const EMBEDDED_CLOSE_TIMEOUT_MS = 30_000;

export async function createEmbeddedApp(options: EmbeddedDirectusOptions): Promise<EmbeddedDirectusApp> {
	validateEmbeddedOptions(options);
	const extensionsPath = normalize(options.extensionsPath);
	const programmaticHooks = snapshotProgrammaticHooks(options.extensions.programmaticHooks);

	const extensionOptions = Object.freeze({
		...(programmaticHooks.length > 0 ? { programmaticHooks } : {}),
		schedule: false,
		watch: false,
	});

	const lease = claimEmbeddedRuntime();
	setLifecycleState('starting');

	try {
		const managedApp = await createManagedApp(
			{
				extensionsPath,
				extensions: extensionOptions,
				flows: { schedule: false },
				pressureLimiter: false,
				telemetry: false,
			},
			throwOnBootstrapFailure,
		);

		const serverService = new ServerService({ schema: await getSchema() });
		let closePromise: Promise<void> | undefined;
		let acceptsRequestContexts = true;

		setLifecycleState('online');

		return {
			middleware: managedApp.middleware,
			createRequestContext: (request) => {
				if (!acceptsRequestContexts) {
					throw new Error('Embedded Directus runtime is closing or closed');
				}

				return createEmbeddedRequestContext(request);
			},
			health: () => serverService.health(),
			close: () => {
				acceptsRequestContexts = false;
				closePromise ??= withTimeout(closeEmbeddedRuntime(lease.release, managedApp), EMBEDDED_CLOSE_TIMEOUT_MS);
				return closePromise;
			},
		};
	} catch (error) {
		setLifecycleState('failed');
		const bootstrapError = createBootstrapError('Failed to bootstrap embedded Directus', error);

		try {
			await withTimeout(closeEmbeddedRuntime(lease.release), EMBEDDED_CLOSE_TIMEOUT_MS);
		} catch (closeError) {
			throw new Error('Failed to bootstrap and roll back embedded Directus', {
				cause: new AggregateError([bootstrapError, closeError], 'Embedded Directus bootstrap and rollback failed'),
			});
		}

		throw bootstrapError;
	}
}

async function createEmbeddedRequestContext(request: Request): Promise<EmbeddedDirectusRequestContext> {
	const context = await createAuthenticatedRequestContext(request);
	const services = await import('./services/index.js');

	return {
		...context,
		getSchema,
		services,
	};
}

async function closeEmbeddedRuntime(
	release: () => void,
	managers?: Pick<ManagedApp, 'extensionManager' | 'flowManager'>,
): Promise<void> {
	setLifecycleState('closing');

	try {
		await closeManagedRuntime(managers);
	} finally {
		setLifecycleState('closed');
		release();
	}
}

function validateEmbeddedOptions(options: EmbeddedDirectusOptions): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Embedded Directus options are required');
	}

	if (typeof options.extensionsPath !== 'string' || options.extensionsPath.length === 0) {
		throw new TypeError('Embedded Directus requires an explicit extensionsPath');
	}

	if (!isAbsolute(options.extensionsPath)) {
		throw new TypeError('Embedded Directus extensionsPath must be absolute');
	}

	if (options.extensions?.schedule !== false || options.extensions.watch !== false) {
		throw new TypeError('Embedded Directus requires extension schedule and watch to be disabled');
	}

	if (options.websockets !== false || options.signalHandling !== false) {
		throw new TypeError('Embedded Directus cannot own websockets or process signals');
	}
}

function snapshotProgrammaticHooks(
	hooks: readonly EmbeddedProgrammaticHook[] | undefined,
): readonly EmbeddedProgrammaticHook[] {
	if (hooks === undefined) return Object.freeze([]);
	if (!Array.isArray(hooks)) throw new TypeError('Embedded Directus programmaticHooks must be an array');

	const names = new Set<string>();

	const snapshot = hooks.map((hook) => {
		const name = hook?.name?.trim();

		if (!name) throw new TypeError('Programmatic hook name must be a non-empty string');

		if (typeof hook.config !== 'function') {
			throw new TypeError(`Programmatic hook ${JSON.stringify(name)} must provide a hook config function`);
		}

		if (names.has(name)) throw new Error(`Duplicate programmatic hook name: ${JSON.stringify(name)}`);

		names.add(name);
		return Object.freeze({ name, config: hook.config });
	});

	return Object.freeze(snapshot);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;

	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error(`Embedded Directus close timed out after ${timeoutMs}ms`)), timeoutMs);
	});

	return Promise.race([operation, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}
