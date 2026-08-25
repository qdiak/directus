import { useEnv } from '@directus/env';

export function validateEnv(requiredKeys: string[]): void {
	const env = useEnv();

	for (const requiredKey of requiredKeys) {
		if (requiredKey in env === false) {
			throw new Error(`"${requiredKey}" Environment Variable is missing.`);
		}
	}
}
