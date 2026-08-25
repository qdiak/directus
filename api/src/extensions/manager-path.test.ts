import { describe, expect, it, vi } from 'vitest';
import { ExtensionManager } from './manager.js';

describe('ExtensionManager path ownership', () => {
	it('rejects a different extensions path after initialization', async () => {
		const manager = new ExtensionManager();

		vi.spyOn(manager as any, 'load').mockResolvedValue(undefined);

		await manager.initialize({ schedule: false, watch: false, extensionsPath: '/app/extensions' });

		await expect(
			manager.initialize({ schedule: false, watch: false, extensionsPath: '/other/extensions' }),
		).rejects.toThrow('Extension manager is already configured with a different extensions path');
	});
});
