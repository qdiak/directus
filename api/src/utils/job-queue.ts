import type { PromiseCallback } from '@directus/types';

export class JobQueue {
	private running = false;
	private accepting = true;
	private jobs: { job: PromiseCallback; resolve: () => void; reject: (error: unknown) => void }[] = [];
	private idleWaiters: (() => void)[] = [];

	public enqueue(job: PromiseCallback): Promise<void> {
		if (this.accepting === false) {
			return Promise.reject(new Error('Job queue is closed'));
		}

		const completion = new Promise<void>((resolve, reject) => {
			this.jobs.push({ job, resolve, reject });
		});

		if (!this.running) {
			void this.run();
		}

		return completion;
	}

	private async run(): Promise<void> {
		this.running = true;

		try {
			while (this.jobs.length > 0) {
				const { job, resolve, reject } = this.jobs.shift()!;

				try {
					await job();
					resolve();
				} catch (error) {
					reject(error);
				}
			}
		} finally {
			this.running = false;
			this.resolveIdleWaiters();
		}
	}

	public async onIdle(): Promise<void> {
		if (!this.running && this.jobs.length === 0) return;

		await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
	}

	public async close(): Promise<void> {
		this.accepting = false;
		await this.onIdle();
	}

	private resolveIdleWaiters(): void {
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}

	public get size(): number {
		return this.jobs.length + (this.running ? 1 : 0);
	}
}
