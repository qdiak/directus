import type { Application } from 'express';
import { isAbsolute, normalize } from 'node:path';
import { createManagedApp, type ManagedApp } from './app.js';
import { setLifecycleState } from './lifecycle.js';
import { closeManagedRuntime } from './runtime/close-managed-runtime.js';
import { claimEmbeddedRuntime } from './runtime/embedded-ownership.js';
import { ServerService } from './services/server.js';
import { createBootstrapError, throwOnBootstrapFailure } from './utils/bootstrap-failure.js';
import { getSchema } from './utils/get-schema.js';

export type EmbeddedDirectusOptions = {
	extensionsPath: string;
	extensions: {
		schedule: false;
		watch: false;
	};
	websockets: false;
	signalHandling: false;
};

export type DirectusHealth = Record<string, unknown>;

export type EmbeddedDirectusApp = {
	middleware: Application;
	health(): Promise<DirectusHealth>;
	close(): Promise<void>;
};

export const EMBEDDED_CLOSE_TIMEOUT_MS = 30_000;

export async function createEmbeddedApp(options: EmbeddedDirectusOptions): Promise<EmbeddedDirectusApp> {
	validateEmbeddedOptions(options);
	const extensionsPath = normalize(options.extensionsPath);
	const extensionOptions = { schedule: false, watch: false } as const;
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

		setLifecycleState('online');

		return {
			middleware: managedApp.middleware,
			health: () => serverService.health(),
			close: () => {
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

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;

	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error(`Embedded Directus close timed out after ${timeoutMs}ms`)), timeoutMs);
	});

	return Promise.race([operation, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}
