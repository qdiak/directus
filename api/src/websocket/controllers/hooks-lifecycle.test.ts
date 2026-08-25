import type { EventContext } from '@directus/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import emitter from '../../emitter.js';

const mocks = vi.hoisted(() => ({
	bus: { publish: vi.fn() },
}));

vi.mock('../../bus/index.js', () => ({ useBus: () => mocks.bus }));

const { closeWebSocketEvents, registerWebSocketEvents } = await import('./hooks.js');

afterEach(() => {
	closeWebSocketEvents();
	emitter.offAll();
	vi.clearAllMocks();
});

describe('WebSocket event action lifecycle', () => {
	it('keeps bus publication drainable during shutdown', async () => {
		let releasePublish!: () => void;

		mocks.bus.publish.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releasePublish = resolve;
				}),
		);

		registerWebSocketEvents();

		emitter.emitAction(
			'items.create',
			{ collection: 'articles', key: '1', payload: { title: 'Test' } },
			{} as EventContext,
		);

		await vi.waitFor(() => expect(mocks.bus.publish).toHaveBeenCalledOnce());

		let drained = false;
		const drain = emitter.drainActions().then(() => (drained = true));
		await Promise.resolve();
		expect(drained).toBe(false);

		releasePublish();
		await drain;
		expect(drained).toBe(true);

		closeWebSocketEvents();
		mocks.bus.publish.mockResolvedValue(undefined);
		registerWebSocketEvents();

		emitter.emitAction(
			'items.create',
			{ collection: 'articles', key: '2', payload: { title: 'Second' } },
			{} as EventContext,
		);

		await emitter.drainActions();
		expect(mocks.bus.publish).toHaveBeenCalledTimes(2);
	});
});
