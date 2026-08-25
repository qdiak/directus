import { describe, expect, it, vi } from 'vitest';
import { FlowManager, getFlowManager } from './flows.js';

const { messenger } = vi.hoisted(() => ({
	messenger: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
}));

vi.mock('./bus/index.js', () => ({
	useBus: vi.fn(() => messenger),
}));

describe('FlowManager lifecycle', () => {
	it('unsubscribes, waits for active executions, and closes once', async () => {
		const onClose = vi.fn();
		const manager = new FlowManager(onClose);

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).isLoaded = true;
		});

		const unload = vi.spyOn(manager as any, 'unload').mockImplementation(async () => {
			(manager as any).isLoaded = false;
		});

		await manager.initialize();

		let releaseExecution!: () => void;
		const activeExecution = new Promise<void>((resolve) => (releaseExecution = resolve));
		(manager as any).activeExecutions.add(activeExecution);

		let closed = false;
		const close = manager.close().then(() => (closed = true));
		const subscribedCallback = messenger.subscribe.mock.calls.find(([channel]) => channel === 'flows')?.[1];

		await Promise.resolve();
		expect(closed).toBe(false);

		releaseExecution();
		await Promise.all([close, manager.close()]);

		expect(unload).toHaveBeenCalledOnce();
		expect(messenger.unsubscribe).toHaveBeenCalledWith('flows', subscribedCallback);
		expect(onClose).toHaveBeenCalledOnce();
		expect(() => manager.addOperation('closed', vi.fn())).toThrow('Flow manager is closed');
	});

	it('resets the process singleton after close', async () => {
		const first = getFlowManager();

		await first.close();

		const second = getFlowManager();

		expect(second).not.toBe(first);

		await second.close();
	});

	it('unloads partially registered handlers after initialization fails', async () => {
		const manager = new FlowManager();
		const stop = vi.fn();

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).triggerHandlers.push({
				id: 'partial-schedule',
				events: [{ type: 'schedule', job: { stop } }],
			});

			throw new Error('flow bootstrap failed');
		});

		await expect(manager.initialize({ schedule: false })).rejects.toThrow('flow bootstrap failed');
		await manager.close();

		expect(stop).toHaveBeenCalledOnce();
	});

	it('attempts every trigger disposer when one fails', async () => {
		const manager = new FlowManager();
		const firstStop = vi.fn().mockRejectedValue(new Error('first stop failed'));
		const secondStop = vi.fn();

		(manager as any).triggerHandlers.push({
			id: 'schedules',
			events: [
				{ type: 'schedule', job: { stop: firstStop } },
				{ type: 'schedule', job: { stop: secondStop } },
			],
		});

		await expect(manager.close()).rejects.toThrow('Failed to close flow manager');
		expect(firstStop).toHaveBeenCalledOnce();
		expect(secondStop).toHaveBeenCalledOnce();
	});
});
