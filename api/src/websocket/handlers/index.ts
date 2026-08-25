import { HeartbeatHandler } from './heartbeat.js';
import { ItemsHandler } from './items.js';
import { SubscribeHandler } from './subscribe.js';

let handlers: [HeartbeatHandler, ItemsHandler, SubscribeHandler] | undefined;

export function startWebSocketHandlers() {
	if (handlers) return handlers;

	handlers = [new HeartbeatHandler(), new ItemsHandler(), new SubscribeHandler()];
	return handlers;
}

export async function closeWebSocketHandlers(): Promise<void> {
	const activeHandlers = handlers;
	handlers = undefined;

	if (!activeHandlers) return;

	const results = await Promise.allSettled(activeHandlers.map((handler) => handler.close()));
	const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close WebSocket handlers');
	}
}

export * from './heartbeat.js';
export * from './items.js';
export * from './subscribe.js';
