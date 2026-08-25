import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger.js';
import { exitOnBootstrapFailure, throwOnBootstrapFailure } from './bootstrap-failure.js';

vi.mock('../logger.js');

describe('bootstrap failure strategies', () => {
	const logger = {
		error: vi.fn(),
	} as unknown as Logger<never>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useLogger).mockReturnValue(logger);
	});

	it('throws the original error for embedded consumers', () => {
		const cause = new Error('root cause');
		const error = new Error('bootstrap failed', { cause });

		expect(() => throwOnBootstrapFailure(error)).toThrow(error);
	});

	it('logs and exits for standalone consumers', () => {
		const cause = new Error('root cause');
		const error = new Error('bootstrap failed', { cause });

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process exited');
		});

		expect(() => exitOnBootstrapFailure(error)).toThrow('process exited');
		expect(logger.error).toHaveBeenNthCalledWith(1, 'bootstrap failed');
		expect(logger.error).toHaveBeenNthCalledWith(2, cause);
		expect(exit).toHaveBeenCalledWith(1);
	});
});
