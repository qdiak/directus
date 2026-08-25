import { useLogger } from '../logger.js';

export type BootstrapFailureStrategy = (error: Error) => never;

export const throwOnBootstrapFailure: BootstrapFailureStrategy = (error) => {
	throw error;
};

export const exitOnBootstrapFailure: BootstrapFailureStrategy = (error) => {
	const logger = useLogger();

	logger.error(error.message);

	if (error.cause) {
		logger.error(error.cause);
	}

	return process.exit(1);
};

export const createBootstrapError = (message: string, cause: unknown): Error => {
	return new Error(message, { cause });
};
