import type { ExtensionManager } from '../extensions/manager.js';
import { closeExtensionManager } from '../extensions/index.js';
import type { FlowManager } from '../flows.js';
import { closeFlowManager } from '../flows.js';
import { closeResources } from '../utils/close-resources.js';
import { closeRuntimeResources } from './close-runtime-resources.js';

export type ManagedRuntimeOwners = {
	extensionManager: ExtensionManager;
	flowManager: FlowManager;
};

export async function closeManagedRuntime(owners?: ManagedRuntimeOwners): Promise<void> {
	await closeResources([
		{ name: 'extension manager', close: () => owners?.extensionManager.close() ?? closeExtensionManager() },
		{ name: 'flow manager', close: () => owners?.flowManager.close() ?? closeFlowManager() },
		{ name: 'runtime resources', close: closeRuntimeResources },
	]);
}
