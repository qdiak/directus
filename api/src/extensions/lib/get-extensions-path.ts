import { useEnv } from '@directus/env';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

export const getExtensionsPath = (explicitPath?: string): string => {
	const env = useEnv();

	if (explicitPath !== undefined) {
		if (!isAbsolute(explicitPath)) {
			throw new Error('Explicit extensions path must be absolute');
		}

		if (env['EXTENSIONS_LOCATION']) {
			throw new Error('Explicit extensions path cannot be combined with EXTENSIONS_LOCATION');
		}

		return normalize(explicitPath);
	}

	if (env['EXTENSIONS_LOCATION']) {
		return join(env['TEMP_PATH'] as string, 'extensions');
	}

	return env['EXTENSIONS_PATH'] as string;
};

export const validateExtensionsPath = async (extensionsPath: string): Promise<void> => {
	try {
		await access(extensionsPath, constants.R_OK);

		if ((await stat(extensionsPath)).isDirectory() === false) {
			throw new Error('Path is not a directory');
		}
	} catch (error) {
		throw new Error(`Explicit extensions directory (${extensionsPath}) is not readable`, { cause: error });
	}
};
