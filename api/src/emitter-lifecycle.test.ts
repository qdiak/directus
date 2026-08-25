import { describe, expect, it, vi } from 'vitest';

vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./logger.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

const { Emitter } = await import('./emitter.js');

describe('Emitter action lifecycle', () => {
	it('drains fire-and-forget actions including child emissions', async () => {
		const emitter = new Emitter();
		let releaseParent!: () => void;
		let childFinished = false;

		emitter.onAction('parent', async () => {
			await new Promise<void>((resolve) => {
				releaseParent = resolve;
			});

			emitter.emitAction('child', {});
		});

		emitter.onAction('child', async () => {
			await Promise.resolve();
			childFinished = true;
		});

		emitter.emitAction('parent', {});
		let drained = false;
		const drain = emitter.drainActions().then(() => (drained = true));

		await Promise.resolve();
		expect(drained).toBe(false);

		releaseParent();
		await drain;

		expect(childFinished).toBe(true);
	});

	it('supports directly awaited action dispatch', async () => {
		const emitter = new Emitter();
		const handler = vi.fn();
		emitter.onAction('server.stop', handler);

		await emitter.emitActionAsync('server.stop', { server: 'test' });

		expect(handler).toHaveBeenCalledOnce();
	});
});
