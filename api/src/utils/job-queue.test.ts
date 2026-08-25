import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from './job-queue.js';

describe('JobQueue', () => {
	it('runs jobs sequentially and reports idle after all work completes', async () => {
		const queue = new JobQueue();
		const order: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));

		const first = queue.enqueue(async () => {
			order.push('first:start');
			await firstGate;
			order.push('first:end');
		});

		const second = queue.enqueue(async () => {
			order.push('second');
		});

		expect(queue.size).toBe(2);
		expect(order).toEqual(['first:start']);

		releaseFirst();
		await Promise.all([first, second, queue.onIdle()]);

		expect(order).toEqual(['first:start', 'first:end', 'second']);
		expect(queue.size).toBe(0);
	});

	it('continues after a rejected job', async () => {
		const queue = new JobQueue();
		const followUp = vi.fn();

		await expect(queue.enqueue(async () => Promise.reject(new Error('job failed')))).rejects.toThrow('job failed');
		await expect(queue.enqueue(async () => followUp())).resolves.toBeUndefined();

		expect(followUp).toHaveBeenCalledOnce();
		expect(queue.size).toBe(0);
	});

	it('waits for active work on close and rejects new jobs', async () => {
		const queue = new JobQueue();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let closed = false;

		const job = queue.enqueue(() => gate);
		const close = queue.close().then(() => (closed = true));

		await Promise.resolve();
		expect(closed).toBe(false);
		await expect(queue.enqueue(async () => undefined)).rejects.toThrow('Job queue is closed');

		release();
		await Promise.all([job, close]);
		expect(closed).toBe(true);
	});
});
