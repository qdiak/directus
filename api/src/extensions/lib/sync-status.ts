import { exists } from 'fs-extra';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getExtensionsPath } from './get-extensions-path.js';

export enum SyncStatus {
	UNKNOWN = 'UNKNOWN',
	SYNCING = 'SYNCING',
	DONE = 'DONE',
}

/**
 * Retrieves the sync status from the `.status` file in the local extensions folder
 */
export const getSyncStatus = async (extensionsPath = getExtensionsPath()) => {
	const statusFilePath = join(extensionsPath, '.status');

	if (await exists(statusFilePath)) {
		const status = await readFile(statusFilePath, 'utf8');
		return status;
	} else {
		return SyncStatus.UNKNOWN;
	}
};

export const setSyncStatus = async (status: SyncStatus, extensionsPath = getExtensionsPath()) => {
	const statusFilePath = join(extensionsPath, '.status');
	await writeFile(statusFilePath, status);
};
