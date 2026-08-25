import { describe, expect, it, vi } from 'vitest';
import { closeResources } from './close-resources.js';

describe('closeResources', () => {
	it('continues closing resources and aggregates failures in order', async () => {
		const order: string[] = [];
		const firstError = new Error('first failed');
		const thirdError = new Error('third failed');

		const result = closeResources([
			{
				name: 'first',
				close: vi.fn(async () => {
					order.push('first');
					throw firstError;
				}),
			},
			{ name: 'second', close: vi.fn(async () => order.push('second')) },
			{
				name: 'third',
				close: vi.fn(async () => {
					order.push('third');
					throw thirdError;
				}),
			},
		]);

		const error = await result.catch((error: unknown) => error);

		expect(order).toEqual(['first', 'second', 'third']);
		expect(error).toBeInstanceOf(AggregateError);

		expect((error as AggregateError).errors).toMatchObject([
			{ message: 'Failed to close first', cause: firstError },
			{ message: 'Failed to close third', cause: thirdError },
		]);
	});
});
