import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bus: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
}));

vi.mock('@directus/env', () => ({
	useEnv: () => ({
		EMAIL_TEMPLATES_PATH: './templates',
		EXTENSIONS_PATH: './extensions',
		RATE_LIMITER_ENABLED: false,
		SESSION_COOKIE_NAME: 'directus_session_token',
		STORAGE_LOCATIONS: ['local'],
		WEBSOCKETS_GRAPHQL_ENABLED: false,
		WEBSOCKETS_HEARTBEAT_ENABLED: false,
		WEBSOCKETS_REST_AUTH: 'handshake',
		WEBSOCKETS_REST_AUTH_TIMEOUT: 10,
		WEBSOCKETS_REST_ENABLED: true,
		WEBSOCKETS_REST_PATH: '/websocket',
	}),
}));

vi.mock('../../bus/index.js', () => ({ useBus: () => mocks.bus }));

const { closeWebSocketControllers, createWebSocketController, getWebSocketController } = await import('./index.js');
const { closeWebSocketHandlers, startWebSocketHandlers } = await import('../handlers/index.js');

beforeEach(() => {
	mocks.bus.subscribe.mockResolvedValue(undefined);
	mocks.bus.unsubscribe.mockResolvedValue(undefined);
});

afterEach(async () => {
	await closeWebSocketHandlers().catch(() => undefined);
	await closeWebSocketControllers().catch(() => undefined);
	vi.clearAllMocks();
});

describe('WebSocket runtime ownership', () => {
	it('removes upgrade listeners, closes handlers, and resets singletons for recreation', async () => {
		const firstServer = createServer();
		const firstController = createWebSocketController(firstServer);

		expect(firstController).toBeDefined();
		expect(firstServer.listenerCount('upgrade')).toBe(1);
		const firstHandlers = startWebSocketHandlers();
		await firstHandlers[2].initialize();

		await closeWebSocketHandlers();
		await closeWebSocketControllers();

		expect(firstServer.listenerCount('upgrade')).toBe(0);
		expect(getWebSocketController()).toBeUndefined();
		expect(mocks.bus.unsubscribe).toHaveBeenCalledWith('websocket.event', expect.any(Function));

		const secondServer = createServer();
		const secondController = createWebSocketController(secondServer);
		const secondHandlers = startWebSocketHandlers();
		await secondHandlers[2].initialize();

		expect(secondController).toBeDefined();
		expect(secondController).not.toBe(firstController);
		expect(secondServer.listenerCount('upgrade')).toBe(1);
		expect(mocks.bus.subscribe).toHaveBeenCalledTimes(2);

		await closeWebSocketHandlers();
		await closeWebSocketControllers();
		expect(secondServer.listenerCount('upgrade')).toBe(0);
	});
});
