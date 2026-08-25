import { describe, expect, it, vi } from 'vitest';
import { getExtensionManager } from './index.js';
import { ExtensionManager } from './manager.js';

const { messenger, scheduleSynchronizedJob } = vi.hoisted(() => ({
	messenger: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
	scheduleSynchronizedJob: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('../bus/index.js', () => ({
	useBus: vi.fn(() => messenger),
}));

vi.mock('../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('../utils/schedule.js', () => ({
	scheduleSynchronizedJob,
	validateCron: vi.fn(() => true),
}));

describe('ExtensionManager lifecycle', () => {
	it('drains and closes once with the same bus callback identity', async () => {
		const onClose = vi.fn();
		const manager = new ExtensionManager(onClose);

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).isLoaded = true;
		});

		const unload = vi.spyOn(manager as any, 'unload').mockImplementation(async () => {
			(manager as any).isLoaded = false;
		});

		await manager.initialize({ schedule: false, watch: false, extensionsPath: '/app/extensions' });

		const subscribedCallback = messenger.subscribe.mock.calls.find(([channel]) => channel === 'extensions.reload')?.[1];

		await Promise.all([manager.close(), manager.close()]);

		expect(unload).toHaveBeenCalledOnce();
		expect(messenger.unsubscribe).toHaveBeenCalledWith('extensions.reload', subscribedCallback);
		expect(onClose).toHaveBeenCalledOnce();
		expect(manager.isClosed).toBe(true);
		await expect(manager.reload()).rejects.toThrow('Extension manager is closed');
	});

	it('resets the process singleton after close', async () => {
		const first = getExtensionManager();

		await first.close();

		const second = getExtensionManager();

		expect(second).not.toBe(first);

		await second.close();
	});

	it('does not create extension schedule jobs when scheduling is disabled', async () => {
		const manager = new ExtensionManager();

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).isLoaded = true;
		});

		await manager.initialize({ schedule: false, watch: false, extensionsPath: '/app/extensions' });

		const unregister = (manager as any).registerHook(
			({ schedule }: { schedule: (cron: string, handler: () => void) => void }) => schedule('* * * * *', vi.fn()),
			'test-hook',
		);

		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
		expect(unregister).toEqual([]);

		await manager.close();
	});

	it('waits for every extension unregister disposer when one fails', async () => {
		const manager = new ExtensionManager();
		const firstUnregister = vi.fn().mockRejectedValue(new Error('first unregister failed'));
		const secondUnregister = vi.fn();

		(manager as any).unregisterFunctionMap.set('first', firstUnregister);
		(manager as any).unregisterFunctionMap.set('second', secondUnregister);

		await expect(manager.close()).rejects.toThrow('Failed to close extension manager');
		expect(firstUnregister).toHaveBeenCalledOnce();
		expect(secondUnregister).toHaveBeenCalledOnce();
	});
});
