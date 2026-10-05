import { afterEach, expect, it, vi } from 'vitest';
import { waitForRegistry } from './wait-for-registry.mjs';

afterEach(() => vi.useRealTimers());

it('waits for an accepted upload to become available', async () => {
	vi.useFakeTimers();
	const read = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ version: '.9' });
	const result = waitForRegistry(read, Boolean, { timeoutMs: 5000, errorMessage: 'Missing version' });
	await vi.advanceTimersByTimeAsync(1000);
	await expect(result).resolves.toEqual({ version: '.9' });
	expect(read).toHaveBeenCalledTimes(2);
});

it('allows stale latest metadata to propagate before verifying promotion', async () => {
	vi.useFakeTimers();
	const read = vi.fn().mockResolvedValueOnce({ latest: '.2' }).mockResolvedValueOnce({ latest: '.9' });

	const result = waitForRegistry(read, (tags: { latest: string }) => tags.latest === '.9', {
		timeoutMs: 5000,
		errorMessage: 'Latest mismatch',
	});

	await vi.advanceTimersByTimeAsync(1000);
	await expect(result).resolves.toEqual({ latest: '.9' });
});

it('rejects a permanent mismatch at the deadline without another polling timer', async () => {
	vi.useFakeTimers();
	const read = vi.fn().mockResolvedValue({ latest: '.2' });

	const result = waitForRegistry(read, (tags: { latest: string }) => tags.latest === '.9', {
		timeoutMs: 1500,
		errorMessage: 'Latest mismatch',
	});

	const rejection = expect(result).rejects.toThrow('Latest mismatch');
	await vi.advanceTimersByTimeAsync(1500);
	await rejection;
	expect(read).toHaveBeenCalledTimes(3);
	expect(vi.getTimerCount()).toBe(0);
});

it('does not hide registry lookup failures behind availability retries', async () => {
	const read = vi.fn().mockRejectedValue(new Error('Registry lookup failed: 403'));

	await expect(waitForRegistry(read, Boolean, { timeoutMs: 5000, errorMessage: 'Missing version' })).rejects.toThrow(
		'Registry lookup failed: 403',
	);

	expect(read).toHaveBeenCalledTimes(1);
});
