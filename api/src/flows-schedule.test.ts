import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bus: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
	readByQuery: vi.fn(),
	scheduleSynchronizedJob: vi.fn(),
	stop: vi.fn(),
}));

vi.mock('./bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));

vi.mock('./services/flows.js', () => ({
	FlowsService: class {
		readByQuery = mocks.readByQuery;
	},
}));

vi.mock('./utils/construct-flow-tree.js', () => ({ constructFlowTree: (flow: unknown) => flow }));
vi.mock('./utils/get-schema.js', () => ({ getSchema: vi.fn().mockResolvedValue({ collections: {}, relations: [] }) }));

vi.mock('./utils/schedule.js', () => ({
	scheduleSynchronizedJob: mocks.scheduleSynchronizedJob,
	validateCron: vi.fn(() => true),
}));

const { FlowManager } = await import('./flows.js');

beforeEach(() => {
	vi.clearAllMocks();

	mocks.readByQuery.mockResolvedValue([
		{
			id: 'scheduled-flow',
			operations: [],
			options: { cron: '* * * * *' },
			trigger: 'schedule',
		},
	]);

	mocks.scheduleSynchronizedJob.mockReturnValue({ stop: mocks.stop });
});

describe('FlowManager scheduling ownership', () => {
	it('does not create schedule jobs when scheduling is disabled', async () => {
		const manager = new FlowManager();

		await manager.initialize({ schedule: false });

		expect(mocks.scheduleSynchronizedJob).not.toHaveBeenCalled();
		await manager.close();
	});

	it('preserves standalone scheduling by default', async () => {
		const manager = new FlowManager();

		await manager.initialize();

		expect(mocks.scheduleSynchronizedJob).toHaveBeenCalledOnce();
		await manager.close();
		expect(mocks.stop).toHaveBeenCalledOnce();
	});
});
