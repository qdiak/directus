import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLifecycleState } from '../lifecycle.js';
import { ServerService } from './server.js';

const { env, getCache, getDatabase, getMailer, getStorage, hasDatabaseConnection } = vi.hoisted(() => ({
	env: {
		CACHE_ENABLED: false,
		DB_CLIENT: 'sqlite3',
		KEY: 'test-key',
		RATE_LIMITER_ENABLED: false,
		RATE_LIMITER_GLOBAL_ENABLED: false,
		STORAGE_LOCATIONS: 'local',
	},
	getCache: vi.fn(),
	getDatabase: vi.fn(),
	getMailer: vi.fn(),
	getStorage: vi.fn(),
	hasDatabaseConnection: vi.fn(),
}));

vi.mock('@directus/env', () => ({
	useEnv: () => env,
}));

vi.mock('../database/index.js', () => ({
	default: getDatabase,
	hasDatabaseConnection,
}));

vi.mock('../cache.js', () => ({
	getCache,
}));

vi.mock('../mailer.js', () => ({
	default: getMailer,
}));

vi.mock('../storage/index.js', () => ({
	getStorage,
}));

describe('ServerService lifecycle health', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(['starting', 'closing', 'closed', 'failed'] as const)(
		'returns error in %s state without creating dependency handles',
		async (state) => {
			setLifecycleState(state);

			await expect(ServerService.prototype.health.call({})).resolves.toEqual({ status: 'error' });
			expect(getDatabase).not.toHaveBeenCalled();
			expect(getCache).not.toHaveBeenCalled();
		},
	);

	it('awaits storage probe cleanup before returning the health response', async () => {
		setLifecycleState('online');
		hasDatabaseConnection.mockResolvedValue(true);

		getDatabase.mockReturnValue({
			client: {
				pool: {
					numFree: () => 1,
					numUsed: () => 0,
				},
			},
		});

		getMailer.mockReturnValue({ verify: vi.fn().mockResolvedValue(undefined) });

		let finishDelete!: () => void;

		const deletePending = new Promise<void>((resolve) => {
			finishDelete = resolve;
		});

		const disk = {
			delete: vi.fn(() => deletePending),
			read: vi.fn(async () => Readable.from(['check'])),
			write: vi.fn().mockResolvedValue(undefined),
		};

		getStorage.mockResolvedValue({ location: () => disk });

		const healthPromise = ServerService.prototype.health.call({ accountability: null });
		let healthSettled = false;

		void healthPromise.then(() => {
			healthSettled = true;
		});

		await vi.waitFor(() => expect(disk.delete).toHaveBeenCalledOnce());
		expect(healthSettled).toBe(false);

		finishDelete();
		await expect(healthPromise).resolves.toEqual({ status: 'ok' });
	});
});
