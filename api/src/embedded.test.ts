import type { Application } from 'express';
import http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLifecycleState, setLifecycleState } from './lifecycle.js';

const mocks = vi.hoisted(() => ({
	closeExtensionManager: vi.fn(),
	closeFlowManager: vi.fn(),
	closeRuntimeResources: vi.fn(),
	createManagedApp: vi.fn(),
	extensionManagerClose: vi.fn(),
	flowManagerClose: vi.fn(),
	getSchema: vi.fn(),
	health: vi.fn(),
}));

vi.mock('./app.js', () => ({ createManagedApp: mocks.createManagedApp }));
vi.mock('./extensions/index.js', () => ({ closeExtensionManager: mocks.closeExtensionManager }));
vi.mock('./flows.js', () => ({ closeFlowManager: mocks.closeFlowManager }));
vi.mock('./runtime/close-runtime-resources.js', () => ({ closeRuntimeResources: mocks.closeRuntimeResources }));
vi.mock('./utils/get-schema.js', () => ({ getSchema: mocks.getSchema }));

vi.mock('./services/server.js', () => ({
	ServerService: class {
		health = mocks.health;
	},
}));

const { createEmbeddedApp } = await import('./embedded.js');

const middleware = {} as Application;

const options = {
	extensionsPath: '/app/extensions',
	extensions: { schedule: false, watch: false },
	websockets: false,
	signalHandling: false,
} as const;

beforeEach(() => {
	setLifecycleState('closed');
	vi.clearAllMocks();

	mocks.createManagedApp.mockResolvedValue({
		middleware,
		extensionManager: { close: mocks.extensionManagerClose },
		flowManager: { close: mocks.flowManagerClose },
	});

	mocks.getSchema.mockResolvedValue({ collections: {}, relations: [] });
	mocks.health.mockImplementation(async () => ({ status: getLifecycleState() === 'online' ? 'ok' : 'error' }));
});

describe('createEmbeddedApp', () => {
	it('creates a schedule-free listenerless handle with direct health', async () => {
		const processOn = vi.spyOn(process, 'on');
		const createServer = vi.spyOn(http, 'createServer');
		const handle = await createEmbeddedApp(options);

		expect(mocks.createManagedApp).toHaveBeenCalledWith(
			{
				extensionsPath: options.extensionsPath,
				extensions: options.extensions,
				flows: { schedule: false },
				pressureLimiter: false,
				telemetry: false,
			},
			expect.any(Function),
		);

		expect(handle.middleware).toBe(middleware);
		await expect(handle.health()).resolves.toEqual({ status: 'ok' });
		expect(processOn).not.toHaveBeenCalled();
		expect(createServer).not.toHaveBeenCalled();

		processOn.mockRestore();
		createServer.mockRestore();
		await handle.close();
	});

	it('closes once, resets health, and supports recreation', async () => {
		const first = await createEmbeddedApp(options);

		const firstClose = first.close();
		const secondClose = first.close();

		expect(secondClose).toBe(firstClose);
		await Promise.all([firstClose, secondClose]);

		expect(mocks.extensionManagerClose).toHaveBeenCalledOnce();
		expect(mocks.flowManagerClose).toHaveBeenCalledOnce();
		expect(mocks.closeRuntimeResources).toHaveBeenCalledOnce();

		expect(mocks.extensionManagerClose.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.flowManagerClose.mock.invocationCallOrder[0]!,
		);

		await expect(first.health()).resolves.toEqual({ status: 'error' });
		expect(getLifecycleState()).toBe('closed');

		const second = await createEmbeddedApp(options);
		await second.close();
	});

	it('claims singleton ownership before bootstrap awaits', async () => {
		let resolveBootstrap!: (value: {
			middleware: Application;
			extensionManager: { close: () => Promise<void> };
			flowManager: { close: () => Promise<void> };
		}) => void;

		mocks.createManagedApp.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveBootstrap = resolve;
				}),
		);

		const firstCreation = createEmbeddedApp(options);

		await expect(createEmbeddedApp(options)).rejects.toThrow('already active');

		resolveBootstrap({
			middleware,
			extensionManager: { close: mocks.extensionManagerClose },
			flowManager: { close: mocks.flowManagerClose },
		});

		const first = await firstCreation;
		await first.close();
	});

	it('rolls back partial bootstrap and releases ownership', async () => {
		const rootCause = new Error('database unavailable');
		mocks.createManagedApp.mockRejectedValueOnce(rootCause);

		const error = await createEmbeddedApp(options).catch((error: unknown) => error);

		expect(error).toMatchObject({
			message: 'Failed to bootstrap embedded Directus',
			cause: rootCause,
		});

		expect(mocks.closeExtensionManager).toHaveBeenCalledOnce();
		expect(mocks.closeFlowManager).toHaveBeenCalledOnce();
		expect(mocks.closeRuntimeResources).toHaveBeenCalledOnce();
		expect(getLifecycleState()).toBe('closed');

		const recreated = await createEmbeddedApp(options);
		await recreated.close();
	});

	it('rejects mutable host ownership options before claiming the runtime', async () => {
		await expect(createEmbeddedApp({ ...options, websockets: true } as unknown as typeof options)).rejects.toThrow(
			'cannot own websockets',
		);

		const handle = await createEmbeddedApp(options);
		await handle.close();
	});

	it('snapshots normalized immutable extension ownership before awaiting bootstrap', async () => {
		const mutableOptions = {
			extensionsPath: '/app/../app/extensions',
			extensions: { schedule: false, watch: false },
			websockets: false,
			signalHandling: false,
		};

		const creation = createEmbeddedApp(mutableOptions);

		mutableOptions.extensions.schedule = true;
		mutableOptions.extensions.watch = true;

		expect(mocks.createManagedApp).toHaveBeenCalledWith(
			expect.objectContaining({
				extensionsPath: '/app/extensions',
				extensions: { schedule: false, watch: false },
			}),
			expect.any(Function),
		);

		const handle = await creation;
		await handle.close();
	});

	it('rejects relative extension ownership before claiming the runtime', async () => {
		await expect(createEmbeddedApp({ ...options, extensionsPath: './extensions' })).rejects.toThrow('must be absolute');

		const handle = await createEmbeddedApp(options);
		await handle.close();
	});

	it('attempts every close layer and releases ownership after a close failure', async () => {
		mocks.extensionManagerClose.mockRejectedValueOnce(new Error('extension close failed'));
		const handle = await createEmbeddedApp(options);

		await expect(handle.close()).rejects.toThrow('Failed to close runtime resources');
		expect(mocks.flowManagerClose).toHaveBeenCalledOnce();
		expect(mocks.closeRuntimeResources).toHaveBeenCalledOnce();
		expect(getLifecycleState()).toBe('closed');

		const recreated = await createEmbeddedApp(options);
		await recreated.close();
	});

	it('preserves direct health failures', async () => {
		const dependencyError = new Error('database health failed');
		mocks.health.mockRejectedValueOnce(dependencyError);
		const handle = await createEmbeddedApp(options);

		await expect(handle.health()).rejects.toBe(dependencyError);
		await handle.close();
	});

	it('times out the caller but retains ownership until teardown settles', async () => {
		vi.useFakeTimers();
		let finishClose!: () => void;

		mocks.extensionManagerClose.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishClose = resolve;
				}),
		);

		const handle = await createEmbeddedApp(options);
		const close = handle.close();
		const closeExpectation = expect(close).rejects.toThrow('timed out');

		await vi.advanceTimersByTimeAsync(30_000);
		await closeExpectation;
		expect(getLifecycleState()).toBe('closing');
		await expect(createEmbeddedApp(options)).rejects.toThrow('already active');

		finishClose();
		await vi.runAllTimersAsync();
		await Promise.resolve();
		expect(getLifecycleState()).toBe('closed');

		const recreated = await createEmbeddedApp(options);
		await recreated.close();
		vi.useRealTimers();
	});

	it('bounds partial-bootstrap rollback without releasing active teardown ownership', async () => {
		vi.useFakeTimers();
		let finishRollback!: () => void;
		mocks.createManagedApp.mockRejectedValueOnce(new Error('bootstrap failed'));

		mocks.closeExtensionManager.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishRollback = resolve;
				}),
		);

		const creation = createEmbeddedApp(options);
		const creationExpectation = expect(creation).rejects.toThrow('Failed to bootstrap and roll back embedded Directus');

		await vi.advanceTimersByTimeAsync(30_000);
		await creationExpectation;
		expect(getLifecycleState()).toBe('closing');
		await expect(createEmbeddedApp(options)).rejects.toThrow('already active');

		finishRollback();
		await vi.runAllTimersAsync();
		await Promise.resolve();
		expect(getLifecycleState()).toBe('closed');

		const recreated = await createEmbeddedApp(options);
		await recreated.close();
		vi.useRealTimers();
	});
});
