import { useEnv } from '@directus/env';
import { toBoolean } from '@directus/utils';
import type { Server as httpServer } from 'http';
import { GraphQLSubscriptionController } from './graphql.js';
import { WebSocketController } from './rest.js';
import { closeWebSocketEvents } from './hooks.js';

let websocketController: WebSocketController | undefined;
let subscriptionController: GraphQLSubscriptionController | undefined;

export function createWebSocketController(server: httpServer) {
	const env = useEnv();

	if (toBoolean(env['WEBSOCKETS_REST_ENABLED'])) {
		websocketController = new WebSocketController(server);
	}

	return websocketController;
}

export function getWebSocketController() {
	return websocketController;
}

export function createSubscriptionController(server: httpServer) {
	const env = useEnv();

	if (toBoolean(env['WEBSOCKETS_GRAPHQL_ENABLED'])) {
		subscriptionController = new GraphQLSubscriptionController(server);
	}

	return subscriptionController;
}

export function getSubscriptionController() {
	return subscriptionController;
}

export async function closeWebSocketControllers(): Promise<void> {
	const controllers = [subscriptionController, websocketController].filter(
		(controller): controller is GraphQLSubscriptionController | WebSocketController => controller !== undefined,
	);

	subscriptionController = undefined;
	websocketController = undefined;

	const results = await Promise.allSettled(controllers.map((controller) => controller.close()));
	closeWebSocketEvents();

	const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close WebSocket controllers');
	}
}

export * from './graphql.js';
export * from './rest.js';
