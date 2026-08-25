import { ExtensionManager } from './manager.js';

let extensionManager: ExtensionManager | undefined;

export function getExtensionManager(): ExtensionManager {
	if (extensionManager) {
		return extensionManager;
	}

	const manager = new ExtensionManager(() => {
		if (extensionManager === manager) extensionManager = undefined;
	});

	extensionManager = manager;

	return extensionManager;
}

export async function closeExtensionManager(): Promise<void> {
	await extensionManager?.close();
}
