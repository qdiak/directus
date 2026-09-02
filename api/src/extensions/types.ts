import type { EndpointConfig, HookConfig, OperationApiConfig } from '@directus/extensions';
import type { BootstrapFailureStrategy } from '../utils/bootstrap-failure.js';

export type BundleConfig = {
	endpoints: { name: string; config: EndpointConfig }[];
	hooks: { name: string; config: HookConfig }[];
	operations: { name: string; config: OperationApiConfig }[];
};

export interface ExtensionManagerOptions {
	schedule: boolean;
	watch: boolean;
	failureStrategy: BootstrapFailureStrategy;
	extensionsPath?: string;
	programmaticHooks?: readonly { name: string; config: HookConfig }[];
}
