import { describe, expect, it, vi } from 'vitest';
import { getExtensionManager } from './index.js';
import { ExtensionManager } from './manager.js';

const { messenger } = vi.hoisted(() => ({
	messenger: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
}));

vi.mock('../bus/index.js', () => ({
	useBus: vi.fn(() => messenger),
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
});
