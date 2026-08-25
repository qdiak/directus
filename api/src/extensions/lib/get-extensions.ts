import { useEnv } from '@directus/env';
import { resolveFsExtensions, resolveModuleExtensions } from '@directus/extensions/node';
import { join } from 'node:path';
import { getExtensionsPath } from './get-extensions-path.js';

export const getExtensions = async (options: { extensionsPath?: string } = {}) => {
	const env = useEnv();
	const extensionsPath = options.extensionsPath ?? getExtensionsPath();

	const localExtensions = await resolveFsExtensions(extensionsPath);
	const registryExtensions = await resolveFsExtensions(join(extensionsPath, '.registry'));

	/** Extensions that are listed as dependencies in the root package.json */
	const moduleExtensions = await resolveModuleExtensions(env['PACKAGE_FILE_LOCATION'] as string);

	return { local: localExtensions, registry: registryExtensions, module: moduleExtensions };
};
