import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bus: { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
	useBus: vi.fn(),
	readByQuery: vi.fn(),
	getSchema: vi.fn(),
	schedule: vi.fn(),
}));

vi.mock('./bus/index.js', () => ({ useBus: mocks.useBus }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));

vi.mock('./services/flows.js', () => ({
	FlowsService: class {
		readByQuery = mocks.readByQuery;
	},
}));

vi.mock('./utils/get-schema.js', () => ({ getSchema: mocks.getSchema }));
vi.mock('./utils/schedule.js', () => ({ scheduleSynchronizedJob: mocks.schedule, validateCron: vi.fn(() => true) }));
vi.mock('./utils/construct-flow-tree.js', () => ({ constructFlowTree: (flow: unknown) => flow }));
const { FlowManager } = await import('./flows.js');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.useBus.mockReturnValue(mocks.bus);
	mocks.getSchema.mockResolvedValue({ collections: {}, relations: [] });
	mocks.readByQuery.mockResolvedValue([]);
});

describe('disabled Flow runtime', () => {
	it('never reads Flow data, registers operations, or acquires the bus, including reload and repeated initialization', async () => {
		const manager = new FlowManager();
		manager.configure({ enabled: false });
		manager.addOperation('exec', vi.fn());
		await manager.initialize({ enabled: false });
		await manager.initialize({ enabled: false });
		await manager.reload();
		(manager as any).handleFlowMessage({ type: 'reload' });
		await Promise.resolve();
		expect(mocks.readByQuery).not.toHaveBeenCalled();
		expect(mocks.getSchema).not.toHaveBeenCalled();
		expect(mocks.useBus).not.toHaveBeenCalled();
		expect(mocks.schedule).not.toHaveBeenCalled();
		expect((manager as any).operations.size).toBe(0);
		expect((manager as any).triggerHandlers).toEqual([]);
		await manager.close();
		await manager.close();
		expect(mocks.bus.unsubscribe).not.toHaveBeenCalled();
	});

	it('rejects every execution entry even if a stale handler is injected', async () => {
		const manager = new FlowManager();
		manager.configure({ enabled: false });
		const handler = vi.fn();
		(manager as any).operationFlowHandlers = { flow: handler };
		(manager as any).webhookFlowHandlers = { flow: handler };
		await expect(manager.runOperationFlow('flow', {}, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(manager.runWebhookFlow('flow', {}, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect((manager as any).executeFlow({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect((manager as any).executeFlowInternal({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(handler).not.toHaveBeenCalled();
		expect(mocks.getSchema).not.toHaveBeenCalled();
		await manager.close();
	});

	it.each([true, false])('cannot change the enabled policy after configuration (%s)', async (enabled) => {
		const manager = new FlowManager();
		const options = { enabled, schedule: false };
		manager.configure(options);
		options.enabled = !enabled;
		expect(() => manager.configure(options)).toThrow('different enabled option');
		await expect(manager.initialize(options)).rejects.toThrow('different enabled option');
		await manager.close();
	});

	it('preserves default loading and reload publication', async () => {
		const manager = new FlowManager();
		await manager.initialize();
		await manager.reload();
		expect(mocks.readByQuery).toHaveBeenCalledOnce();
		expect(mocks.bus.subscribe).toHaveBeenCalledWith('flows', expect.any(Function));
		expect(mocks.bus.publish).toHaveBeenCalledWith('flows', { type: 'reload' });
		await manager.close();
	});

	it('rejects non-boolean policies before acquiring resources', async () => {
		const manager = new FlowManager();
		expect(() => manager.configure({ enabled: 'false' } as any)).toThrow(TypeError);
		expect(mocks.useBus).not.toHaveBeenCalled();
		await manager.close();
	});
});
