import { useEnv } from '@directus/env';
import { toBoolean } from '@directus/utils';
import { getNodeEnv } from '@directus/utils/node';
import type { TerminusOptions } from '@godaddy/terminus';
import { createTerminus } from '@godaddy/terminus';
import type { Request } from 'express';
import * as http from 'http';
import * as https from 'https';
import { once } from 'lodash-es';
import qs from 'qs';
import url from 'url';
import createApp from './app.js';
import getDatabase from './database/index.js';
import emitter from './emitter.js';
import { setLifecycleState } from './lifecycle.js';
import { useLogger } from './logger.js';
import { closeManagedRuntime } from './runtime/close-managed-runtime.js';
import { createBootstrapError } from './utils/bootstrap-failure.js';
import { closeResources } from './utils/close-resources.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';
import { getIPFromReq } from './utils/get-ip-from-req.js';
import {
	createSubscriptionController,
	createWebSocketController,
	closeWebSocketControllers,
	getSubscriptionController,
	getWebSocketController,
} from './websocket/controllers/index.js';
import { closeWebSocketHandlers, startWebSocketHandlers } from './websocket/handlers/index.js';

export { SERVER_ONLINE } from './lifecycle.js';

const env = useEnv();
const logger = useLogger();

export async function createServer(): Promise<http.Server> {
	const server = http.createServer(await createApp());

	Object.assign(server, getConfigFromEnv('SERVER_'));

	server.on('request', function (req: http.IncomingMessage & Request, res: http.ServerResponse) {
		const startTime = process.hrtime();

		const complete = once(function (finished: boolean) {
			const elapsedTime = process.hrtime(startTime);
			const elapsedNanoseconds = elapsedTime[0] * 1e9 + elapsedTime[1];
			const elapsedMilliseconds = elapsedNanoseconds / 1e6;

			const previousIn = (req.socket as any)._metrics?.in || 0;
			const previousOut = (req.socket as any)._metrics?.out || 0;

			const metrics = {
				in: req.socket.bytesRead - previousIn,
				out: req.socket.bytesWritten - previousOut,
			};

			(req.socket as any)._metrics = {
				in: req.socket.bytesRead,
				out: req.socket.bytesWritten,
			};

			// Compatibility when supporting serving with certificates
			const protocol = server instanceof https.Server ? 'https' : 'http';

			// Rely on url.parse for path extraction
			// Doesn't break on illegal URLs
			const urlInfo = url.parse(req.originalUrl || req.url);

			const info = {
				finished,
				request: {
					aborted: req.aborted,
					completed: req.complete,
					method: req.method,
					url: urlInfo.href,
					path: urlInfo.pathname,
					protocol,
					host: req.headers.host,
					size: metrics.in,
					query: urlInfo.query ? qs.parse(urlInfo.query) : {},
					headers: req.headers,
				},
				response: {
					status: res.statusCode,
					size: metrics.out,
					headers: res.getHeaders(),
				},
				ip: getIPFromReq(req),
				duration: elapsedMilliseconds.toFixed(),
			};

			emitter.emitAction('response', info, {
				database: getDatabase(),
				schema: req.schema,
				accountability: req.accountability ?? null,
			});
		});

		res.once('finish', complete.bind(null, true));
		res.once('close', complete.bind(null, false));
	});

	if (toBoolean(env['WEBSOCKETS_ENABLED']) === true) {
		try {
			const subscriptionController = createSubscriptionController(server);
			await subscriptionController?.initialize();
			createWebSocketController(server);

			if (getWebSocketController()) {
				const handlers = startWebSocketHandlers();
				await handlers[2].initialize();
			}
		} catch (error) {
			setLifecycleState('failed');
			const bootstrapError = createBootstrapError('Failed to initialize standalone WebSockets', error);

			try {
				await closeStandaloneResources();
			} catch (closeError) {
				throw new Error('Failed to initialize and roll back standalone WebSockets', {
					cause: new AggregateError([bootstrapError, closeError], 'Standalone WebSocket bootstrap and rollback failed'),
				});
			} finally {
				setLifecycleState('closed');
			}

			throw bootstrapError;
		}
	}

	let shutdownPromise: Promise<void> | undefined;

	const terminusOptions: TerminusOptions = {
		timeout:
			(env['SERVER_SHUTDOWN_TIMEOUT'] as number) >= 0 && (env['SERVER_SHUTDOWN_TIMEOUT'] as number) < Infinity
				? (env['SERVER_SHUTDOWN_TIMEOUT'] as number)
				: 1000,
		signals: ['SIGINT', 'SIGTERM', 'SIGHUP'],
		beforeShutdown,
		onSignal,
		onShutdown,
	};

	createTerminus(server, terminusOptions);

	return server;

	async function beforeShutdown() {
		if (getNodeEnv() !== 'development') {
			logger.info('Shutting down...');
		}

		setLifecycleState('closing');
	}

	async function onSignal() {
		shutdownPromise ??= closeStandaloneServer(server);
		await shutdownPromise;
	}

	async function onShutdown() {
		if (getNodeEnv() !== 'development') {
			logger.info('Directus shut down OK. Bye bye!');
		}
	}
}

async function closeStandaloneServer(server: http.Server): Promise<void> {
	setLifecycleState('closing');

	try {
		await closeStandaloneResources(server);
		logger.info('Database connections destroyed');
	} finally {
		setLifecycleState('closed');
	}
}

async function closeStandaloneResources(server?: http.Server): Promise<void> {
	await closeResources([
		{
			name: 'WebSocket clients',
			close: () => {
				getSubscriptionController()?.terminate();
				getWebSocketController()?.terminate();
			},
		},
		{ name: 'active action handlers', close: () => emitter.drainActions() },
		...(server
			? [
					{
						name: 'server.stop action',
						close: async () => {
							await emitter.emitActionAsync(
								'server.stop',
								{ server },
								{
									database: getDatabase(),
									schema: null,
									accountability: null,
								},
							);

							await emitter.drainActions();
						},
					},
			  ]
			: []),
		{ name: 'WebSocket handlers', close: closeWebSocketHandlers },
		{ name: 'WebSocket controllers', close: closeWebSocketControllers },
		{ name: 'WebSocket close actions', close: () => emitter.drainActions() },
		{ name: 'managed runtime', close: closeManagedRuntime },
	]);
}

export async function startServer(): Promise<void> {
	const server = await createServer();

	const host = env['HOST'] as string;
	const port = parseInt(env['PORT'] as string);

	server
		.listen(port, host, () => {
			logger.info(`Server started at http://${host}:${port}`);

			process.send?.('ready');

			emitter.emitAction(
				'server.start',
				{ server },
				{
					database: getDatabase(),
					schema: null,
					accountability: null,
				},
			);
		})
		.once('error', (err: any) => {
			if (err?.code === 'EADDRINUSE') {
				logger.error(`Port ${port} is already in use`);
				process.exit(1);
			} else {
				throw err;
			}
		});
}
