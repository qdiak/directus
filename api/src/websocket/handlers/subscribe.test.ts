import type { CollectionsOverview, Relation } from '@directus/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import emitter from '../../emitter.js';
import { getSchema } from '../../utils/get-schema.js';
import type { WebSocketClient } from '../types.js';
import { SubscribeHandler } from './subscribe.js';

// mocking
const mocks = vi.hoisted(() => ({
	bus: {
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
}));

vi.mock('../controllers', () => ({
	getWebSocketController: vi.fn(() => ({
		clients: new Set(),
	})),
}));

vi.mock('../../utils/get-schema', () => ({
	getSchema: vi.fn(),
}));

vi.mock('../../services', () => ({
	ItemsService: vi.fn(() => ({
		readByQuery: vi.fn(),
	})),
	MetaService: vi.fn(),
}));

vi.mock('../../database/index');
vi.mock('../../bus/index', () => ({ useBus: () => mocks.bus }));

function mockClient() {
	return {
		on: vi.fn(),
		off: vi.fn(),
		send: vi.fn(),
		close: vi.fn(),
		accountability: null,
	} as unknown as WebSocketClient;
}

function delay(ms: number) {
	return new Promise<void>((resolve) => {
		setTimeout(() => resolve(), ms);
	});
}

describe('WebSocket heartbeat handler', () => {
	let handler: SubscribeHandler;

	beforeEach(() => {
		mocks.bus.subscribe.mockResolvedValue(undefined);
		mocks.bus.unsubscribe.mockResolvedValue(undefined);

		// initialize handler
		handler = new SubscribeHandler();
	});

	afterEach(() => {
		emitter.offAll();
		vi.clearAllMocks();
	});

	test('ignore other message types', async () => {
		const spy = vi.spyOn(handler, 'onMessage');

		// receive message
		emitter.emitAction('websocket.message', {
			client: mockClient(),
			message: { type: 'ping' },
		});

		// expect nothing
		expect(spy).not.toBeCalled();
	});

	test('waits for in-flight message and bus dispatch work before closing', async () => {
		let releaseMessage!: () => void;
		let releaseDispatch!: () => void;

		const onMessage = vi.spyOn(handler, 'onMessage').mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseMessage = resolve;
				}),
		);

		const dispatch = vi.spyOn(handler, 'dispatch').mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseDispatch = resolve;
				}),
		);

		await handler.initialize();
		const busHandler = mocks.bus.subscribe.mock.calls[0]![1];

		emitter.emitAction('websocket.message', {
			client: mockClient(),
			message: { type: 'subscribe', collection: 'test_collection' },
		});

		busHandler({ collection: 'test_collection', action: 'create', key: '1' });

		await vi.waitFor(() => expect(onMessage).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());

		let closed = false;
		const close = handler.close().then(() => (closed = true));
		await Promise.resolve();
		expect(closed).toBe(false);
		expect(mocks.bus.unsubscribe).toHaveBeenCalledWith('websocket.event', busHandler);

		emitter.emitAction('websocket.message', {
			client: mockClient(),
			message: { type: 'subscribe', collection: 'test_collection' },
		});

		busHandler({ collection: 'test_collection', action: 'create', key: '2' });
		await emitter.drainActions();
		expect(onMessage).toHaveBeenCalledOnce();
		expect(dispatch).toHaveBeenCalledOnce();

		releaseMessage();
		releaseDispatch();
		await close;
		expect(closed).toBe(true);
	});

	test('should fail subscribe to non-existing collection', async () => {
		vi.mocked(getSchema).mockImplementation(async () => ({
			collections: {} as CollectionsOverview,
			relations: [] as Relation[],
		}));

		const subscribe = vi.spyOn(handler, 'subscribe');
		const onMessage = vi.spyOn(handler, 'onMessage');

		// receive message
		emitter.emitAction('websocket.message', {
			client: mockClient(),
			message: {
				type: 'subscribe',
				collection: 'does_not_exist',
			},
		});

		await delay(10);

		// expect
		expect(onMessage).toBeCalled();
		expect(subscribe).not.toBeCalled();
	});

	test('should subscribe/unsubscribe to collection', async () => {
		const client = mockClient();

		vi.mocked(getSchema).mockImplementation(async () => ({
			collections: {
				test_collection: {
					collection: 'test_collection',
					primary: 'id',
					singleton: false,
					sortField: null,
					note: null,
					accountability: null,
					fields: {},
				},
			} as CollectionsOverview,
			relations: [] as Relation[],
		}));

		const subscribe = vi.spyOn(handler, 'subscribe');
		const onMessage = vi.spyOn(handler, 'onMessage');

		// receive message
		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'subscribe',
				collection: 'test_collection',
				uid: '123',
			},
		});

		await delay(10);

		// expect
		expect(onMessage).toBeCalled();
		expect(subscribe).toBeCalled();
		expect(handler.subscriptions['test_collection']?.size).toBe(1);
	});

	test('unsubscribe a specific subscription', async () => {
		const client = mockClient();

		vi.mocked(getSchema).mockImplementation(async () => ({
			collections: {
				test_collection: {
					collection: 'test_collection',
					primary: 'id',
					singleton: false,
					sortField: null,
					note: null,
					accountability: null,
					fields: {},
				},
				other_collection: {
					collection: 'other_collection',
					primary: 'id',
					singleton: false,
					sortField: null,
					note: null,
					accountability: null,
					fields: {},
				},
			} as CollectionsOverview,
			relations: [] as Relation[],
		}));

		const unsubscribe = vi.spyOn(handler, 'unsubscribe');
		const subscribe = vi.spyOn(handler, 'subscribe');
		const onMessage = vi.spyOn(handler, 'onMessage');

		// subscribe
		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'subscribe',
				collection: 'test_collection',
				uid: '123',
			},
		});

		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'subscribe',
				collection: 'other_collection',
				uid: '456',
			},
		});

		await delay(10);

		// expect
		expect(onMessage).toBeCalledTimes(2);
		expect(subscribe).toBeCalledTimes(2);
		expect(handler.subscriptions['test_collection']?.size).toBe(1);
		expect(handler.subscriptions['other_collection']?.size).toBe(1);

		// unsubscribe
		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'unsubscribe',
				uid: '123',
			},
		});

		await delay(10);

		// expect
		expect(unsubscribe).toBeCalled();
		expect(handler.subscriptions['test_collection']?.size).toBe(0);
		expect(handler.subscriptions['other_collection']?.size).toBe(1);
	});

	test('unsubscribe all subscriptions', async () => {
		const client = mockClient();

		vi.mocked(getSchema).mockImplementation(async () => ({
			collections: {
				test_collection: {
					collection: 'test_collection',
					primary: 'id',
					singleton: false,
					sortField: null,
					note: null,
					accountability: null,
					fields: {},
				},
				other_collection: {
					collection: 'other_collection',
					primary: 'id',
					singleton: false,
					sortField: null,
					note: null,
					accountability: null,
					fields: {},
				},
			} as CollectionsOverview,
			relations: [] as Relation[],
		}));

		const unsubscribe = vi.spyOn(handler, 'unsubscribe');
		const subscribe = vi.spyOn(handler, 'subscribe');
		const onMessage = vi.spyOn(handler, 'onMessage');

		// subscribe
		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'subscribe',
				collection: 'test_collection',
				uid: '123',
			},
		});

		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'subscribe',
				collection: 'other_collection',
				uid: '456',
			},
		});

		await delay(10);

		// expect
		expect(onMessage).toBeCalledTimes(2);
		expect(subscribe).toBeCalledTimes(2);
		expect(handler.subscriptions['test_collection']?.size).toBe(1);
		expect(handler.subscriptions['other_collection']?.size).toBe(1);

		// unsubscribe
		emitter.emitAction('websocket.message', {
			client,
			message: {
				type: 'unsubscribe',
			},
		});

		await delay(10);

		// expect
		expect(unsubscribe).toBeCalled();
		expect(handler.subscriptions['test_collection']?.size).toBe(0);
		expect(handler.subscriptions['other_collection']?.size).toBe(0);
	});
});
