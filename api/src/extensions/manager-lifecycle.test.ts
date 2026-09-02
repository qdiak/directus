import { describe, expect, it, vi } from 'vitest';
import emitter from '../emitter.js';
import { getExtensionManager } from './index.js';
import { ExtensionManager } from './manager.js';

const { messenger, scheduleSynchronizedJob } = vi.hoisted(() => ({
	messenger: {
		publish: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
	},
	scheduleSynchronizedJob: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('../bus/index.js', () => ({
	useBus: vi.fn(() => messenger),
}));

vi.mock('../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('../utils/schedule.js', () => ({
	scheduleSynchronizedJob,
	validateCron: vi.fn(() => true),
}));

describe('ExtensionManager lifecycle', () => {
	it('drains and closes once with the same bus callback identity', async () => {
		const onClose = vi.fn();
		const manager = new ExtensionManager(onClose);

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).isLoaded = true;
		});

		const unload = vi.spyOn(manager as any, 'unload').mockImplementation(async () => {
			(manager as any).isLoaded = false;
		});

		await manager.initialize({ schedule: false, watch: false, extensionsPath: '/app/extensions' });

		const subscribedCallback = messenger.subscribe.mock.calls.find(([channel]) => channel === 'extensions.reload')?.[1];

		await Promise.all([manager.close(), manager.close()]);

		expect(unload).toHaveBeenCalledOnce();
		expect(messenger.unsubscribe).toHaveBeenCalledWith('extensions.reload', subscribedCallback);
		expect(onClose).toHaveBeenCalledOnce();
		expect(manager.isClosed).toBe(true);
		await expect(manager.reload()).rejects.toThrow('Extension manager is closed');
	});

	it('resets the process singleton after close', async () => {
		const first = getExtensionManager();

		await first.close();

		const second = getExtensionManager();

		expect(second).not.toBe(first);

		await second.close();
	});

	it('does not create extension schedule jobs when scheduling is disabled', async () => {
		const manager = new ExtensionManager();

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).isLoaded = true;
		});

		await manager.initialize({ schedule: false, watch: false, extensionsPath: '/app/extensions' });

		const unregister = (manager as any).registerHook(
			({ schedule }: { schedule: (cron: string, handler: () => void) => void }) => schedule('* * * * *', vi.fn()),
			'test-hook',
		);

		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
		expect(unregister).toEqual([]);

		await manager.close();
	});

	it('waits for every extension unregister disposer when one fails', async () => {
		const manager = new ExtensionManager();
		const firstUnregister = vi.fn().mockRejectedValue(new Error('first unregister failed'));
		const secondUnregister = vi.fn();

		(manager as any).unregisterFunctionMap.set('first', firstUnregister);
		(manager as any).unregisterFunctionMap.set('second', secondUnregister);

		await expect(manager.close()).rejects.toThrow('Failed to close extension manager');
		expect(firstUnregister).toHaveBeenCalledOnce();
		expect(secondUnregister).toHaveBeenCalledOnce();
	});

	it('gives programmatic hooks the standard context and unregisters every handler on close', async () => {
		const manager = new ExtensionManager();
		const filterHandler = vi.fn((payload: string) => `${payload}-filtered`);
		const actionHandler = vi.fn();
		const initHandler = vi.fn();
		let registrationContext: unknown;

		(manager as any).registerProgrammaticHooks([
			{
				name: 'legacy-hook',
				config: ({ action, filter, init }: any, context: unknown) => {
					registrationContext = context;
					filter('quantum.legacy.filter', filterHandler);
					action('quantum.legacy.action', actionHandler);
					init('quantum.legacy.init', initHandler);
				},
			},
		]);

		expect(registrationContext).toMatchObject({
			services: expect.any(Object),
			env: expect.any(Object),
			emitter: expect.any(Object),
			logger: expect.any(Object),
			getSchema: expect.any(Function),
		});

		const eventContext = { accountability: null, database: {}, schema: null } as any;

		await expect(emitter.emitFilter('quantum.legacy.filter', 'payload', {}, eventContext)).resolves.toBe(
			'payload-filtered',
		);

		await emitter.emitActionAsync('quantum.legacy.action', { key: 'value' }, eventContext);
		await emitter.emitInit('quantum.legacy.init', { app: {} as any });

		expect(filterHandler).toHaveBeenCalledWith('payload', { event: 'quantum.legacy.filter' }, eventContext);
		expect(actionHandler).toHaveBeenCalledWith({ event: 'quantum.legacy.action', key: 'value' }, eventContext);
		expect(initHandler).toHaveBeenCalledOnce();

		await manager.close();

		await expect(emitter.emitFilter('quantum.legacy.filter', 'after-close', {}, eventContext)).resolves.toBe(
			'after-close',
		);

		await emitter.emitActionAsync('quantum.legacy.action', {}, eventContext);
		await emitter.emitInit('quantum.legacy.init', { app: {} as any });
		expect(actionHandler).toHaveBeenCalledOnce();
		expect(initHandler).toHaveBeenCalledOnce();
	});

	it('prevalidates programmatic hook name collisions before registering any hook', () => {
		const manager = new ExtensionManager();
		const registerHook = vi.spyOn(manager as any, 'registerHook');
		(manager as any).localExtensions.set('filesystem-hook', { name: 'filesystem-hook' });

		expect(() =>
			(manager as any).registerProgrammaticHooks([
				{ name: 'first', config: vi.fn() },
				{ name: ' first ', config: vi.fn() },
			]),
		).toThrow('Duplicate programmatic hook name');

		expect(registerHook).not.toHaveBeenCalled();

		expect(() => (manager as any).registerProgrammaticHooks([{ name: 'filesystem-hook', config: vi.fn() }])).toThrow(
			'Duplicate programmatic hook name',
		);

		expect(registerHook).not.toHaveBeenCalled();
	});

	it('rolls back handlers registered by a programmatic hook config that throws', async () => {
		const manager = new ExtensionManager();
		const filterHandler = vi.fn((payload: string) => `${payload}-leaked`);

		expect(() =>
			(manager as any).registerProgrammaticHooks([
				{
					name: 'failing-hook',
					config: ({ filter }: any) => {
						filter('quantum.legacy.failing', filterHandler);
						throw new Error('registration failed');
					},
				},
			]),
		).toThrow('registration failed');

		await expect(emitter.emitFilter('quantum.legacy.failing', 'payload', {})).resolves.toBe('payload');
		expect(filterHandler).not.toHaveBeenCalled();
		await manager.close();
	});

	it('registers programmatic hooks once across repeated initialization', async () => {
		const manager = new ExtensionManager();
		const config = vi.fn();

		vi.spyOn(manager as any, 'load').mockImplementation(async () => {
			(manager as any).registerProgrammaticHooks((manager as any).options.programmaticHooks ?? []);
			(manager as any).isLoaded = true;
		});

		const options = {
			extensionsPath: '/app/extensions',
			programmaticHooks: [{ name: 'legacy-hook', config }],
			schedule: false,
			watch: false,
		};

		await manager.initialize(options);
		await manager.initialize(options);

		expect(config).toHaveBeenCalledOnce();
		await manager.close();
	});
});
