import { once } from 'node:events';
import { createServer as createNodeServer } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLifecycleState, setLifecycleState } from './lifecycle.js';

const mocks = vi.hoisted(() => ({
	closeManagedRuntime: vi.fn(),
	closeWebSocketControllers: vi.fn(),
	closeWebSocketHandlers: vi.fn(),
	database: { marker: 'live-database' },
	drainActions: vi.fn(),
	emitAction: vi.fn(),
	emitActionAsync: vi.fn(),
	env: {
		HOST: '127.0.0.1',
		PORT: '0',
		SERVER_SHUTDOWN_TIMEOUT: 2500,
		WEBSOCKETS_ENABLED: false,
	},
	logger: { info: vi.fn(), error: vi.fn() },
	order: [] as string[],
	terminusServer: undefined as import('node:http').Server | undefined,
	terminusOptions: undefined as Record<string, any> | undefined,
	webSocketServicesAvailable: true,
	webSocketController: { terminate: vi.fn() },
	subscriptionController: { terminate: vi.fn() },
}));

vi.mock('@directus/env', () => ({
	useEnv: () => mocks.env,
}));

vi.mock('@directus/utils/node', () => ({ getNodeEnv: () => 'test' }));

vi.mock('@godaddy/terminus', () => ({
	createTerminus: vi.fn((server, options) => {
		mocks.terminusServer = server;
		mocks.terminusOptions = options;
	}),
}));

vi.mock('./app.js', () => ({ default: vi.fn().mockResolvedValue((_req: unknown, _res: unknown) => undefined) }));
vi.mock('./database/index.js', () => ({ default: () => mocks.database }));

vi.mock('./emitter.js', () => ({
	default: {
		drainActions: mocks.drainActions,
		emitAction: mocks.emitAction,
		emitActionAsync: mocks.emitActionAsync,
	},
}));

vi.mock('./logger.js', () => ({ useLogger: () => mocks.logger }));
vi.mock('./runtime/close-managed-runtime.js', () => ({ closeManagedRuntime: mocks.closeManagedRuntime }));

vi.mock('./websocket/controllers/index.js', () => ({
	closeWebSocketControllers: async () => {
		mocks.webSocketServicesAvailable = false;
		await mocks.closeWebSocketControllers();
	},
	createSubscriptionController: vi.fn(),
	createWebSocketController: vi.fn(),
	getSubscriptionController: () => mocks.subscriptionController,
	getWebSocketController: () => mocks.webSocketController,
}));

vi.mock('./websocket/handlers/index.js', () => ({
	closeWebSocketHandlers: mocks.closeWebSocketHandlers,
	startWebSocketHandlers: vi.fn(),
}));

vi.mock('./utils/get-config-from-env.js', () => ({ getConfigFromEnv: () => ({}) }));
vi.mock('./utils/get-ip-from-req.js', () => ({ getIPFromReq: vi.fn() }));

const { createServer, startServer } = await import('./server.js');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.order.length = 0;
	mocks.env.HOST = '127.0.0.1';
	mocks.env.PORT = '0';
	mocks.terminusOptions = undefined;
	mocks.terminusServer = undefined;
	mocks.webSocketServicesAvailable = true;
	setLifecycleState('online');
	mocks.closeWebSocketHandlers.mockImplementation(async () => void mocks.order.push('handlers'));
	mocks.closeWebSocketControllers.mockImplementation(async () => void mocks.order.push('controllers'));
	mocks.drainActions.mockImplementation(async () => void mocks.order.push('drain'));
	mocks.webSocketController.terminate.mockImplementation(() => void mocks.order.push('terminate-rest'));
	mocks.subscriptionController.terminate.mockImplementation(() => void mocks.order.push('terminate-graphql'));

	mocks.emitActionAsync.mockImplementation(async () => {
		expect(mocks.webSocketServicesAvailable).toBe(true);
		mocks.order.push('server.stop');
	});

	mocks.closeManagedRuntime.mockImplementation(async () => void mocks.order.push('runtime'));
});

describe('standalone server shutdown', () => {
	it('preserves Terminus ownership and drains before live-context stop and managed teardown', async () => {
		const server = await createServer();
		const options = mocks.terminusOptions!;

		expect(options['signals']).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
		expect(options['timeout']).toBe(2500);

		await options['beforeShutdown']();
		expect(getLifecycleState()).toBe('closing');

		await Promise.all([options['onSignal'](), options['onSignal']()]);

		expect(mocks.order).toEqual([
			'terminate-graphql',
			'terminate-rest',
			'drain',
			'server.stop',
			'drain',
			'handlers',
			'controllers',
			'drain',
			'runtime',
		]);

		expect(mocks.emitActionAsync).toHaveBeenCalledWith(
			'server.stop',
			{ server },
			{
				accountability: null,
				database: mocks.database,
				schema: null,
			},
		);

		expect(getLifecycleState()).toBe('closed');

		await options['onShutdown']();
		expect(mocks.emitActionAsync).toHaveBeenCalledOnce();
		expect(mocks.closeManagedRuntime).toHaveBeenCalledOnce();
	});

	it('attempts every teardown layer and closes lifecycle when an earlier layer fails', async () => {
		mocks.closeWebSocketHandlers.mockImplementationOnce(async () => {
			mocks.order.push('handlers');
			throw new Error('handler close failed');
		});

		await createServer();
		const options = mocks.terminusOptions!;

		await options['beforeShutdown']();
		await expect(options['onSignal']()).rejects.toThrow('Failed to close runtime resources');

		expect(mocks.order).toEqual([
			'terminate-graphql',
			'terminate-rest',
			'drain',
			'server.stop',
			'drain',
			'handlers',
			'controllers',
			'drain',
			'runtime',
		]);

		expect(getLifecycleState()).toBe('closed');
	});
});

describe('standalone server start', () => {
	it('listens, reports readiness, and emits server.start with a live database', async () => {
		const originalSend = process.send;
		const send = vi.fn();
		process.send = send;

		try {
			await startServer();

			await vi.waitFor(() =>
				expect(mocks.emitAction).toHaveBeenCalledWith(
					'server.start',
					expect.objectContaining({ server: mocks.terminusServer }),
					{
						accountability: null,
						database: mocks.database,
						schema: null,
					},
				),
			);

			expect(mocks.logger.info).toHaveBeenCalledWith('Server started at http://127.0.0.1:0');
			expect(send).toHaveBeenCalledWith('ready');
			expect(mocks.logger.info.mock.invocationCallOrder.at(-1)).toBeLessThan(send.mock.invocationCallOrder[0]!);
			expect(send.mock.invocationCallOrder[0]).toBeLessThan(mocks.emitAction.mock.invocationCallOrder[0]!);
		} finally {
			process.send = originalSend;

			await new Promise<void>((resolve, reject) =>
				mocks.terminusServer!.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});

	it('preserves the EADDRINUSE exit behavior', async () => {
		const occupiedServer = createNodeServer();
		occupiedServer.listen(0, '127.0.0.1');
		await once(occupiedServer, 'listening');
		mocks.env.PORT = String((occupiedServer.address() as import('node:net').AddressInfo).port);

		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

		try {
			await startServer();
			await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

			expect(mocks.logger.error).toHaveBeenCalledWith(`Port ${mocks.env.PORT} is already in use`);
			expect(mocks.emitAction).not.toHaveBeenCalledWith('server.start', expect.anything(), expect.anything());
		} finally {
			exit.mockRestore();

			await new Promise<void>((resolve, reject) =>
				occupiedServer.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});
