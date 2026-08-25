import { InstallationManager } from './manager.js';
import { getExtensionsPath } from '../get-extensions-path.js';

let manager: InstallationManager | undefined;

export function getInstallationManager(extensionsPath = getExtensionsPath()): InstallationManager {
	if (manager) {
		if (manager.extensionPath !== extensionsPath) {
			throw new Error('Installation manager is already configured with a different extensions path');
		}

		return manager;
	}

	manager = new InstallationManager(extensionsPath);

	return manager;
}

export function resetInstallationManager(instance?: InstallationManager): void {
	if (instance === undefined || manager === instance) {
		manager = undefined;
	}
}
