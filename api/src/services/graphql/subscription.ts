import { EventEmitter, on } from 'events';
import { useBus } from '../../bus/index.js';
import type { GraphQLService } from './index.js';
import { getSchema } from '../../utils/get-schema.js';
import type { GraphQLResolveInfo, SelectionNode } from 'graphql';
import { refreshAccountability } from '../../websocket/authenticate.js';
import { getPayload } from '../../websocket/utils/items.js';
import type { Subscription } from '../../websocket/types.js';
import type { WebSocketEvent } from '../../websocket/messages.js';

const messages = createPubSub(new EventEmitter());
let messenger: ReturnType<typeof useBus> | undefined;
let binding: Promise<void> | undefined;
let bound = false;

const handleWebSocketEvent = (payload: unknown) => {
	const message = payload as Record<string, any>;
	messages.publish(`${message['collection']}_mutated`, message);
};

export async function bindPubSub(): Promise<void> {
	if (bound) return;

	const pendingBinding = (binding ??= (async () => {
		messenger = useBus();
		await messenger.subscribe('websocket.event', handleWebSocketEvent);
		bound = true;
	})());

	try {
		await pendingBinding;
	} catch (error) {
		if (binding === pendingBinding) binding = undefined;
		messenger = undefined;
		throw error;
	}
}

export async function closePubSub(): Promise<void> {
	const errors: unknown[] = [];

	try {
		await binding;
	} catch (error) {
		errors.push(error);
	}

	if (bound && messenger) {
		try {
			await messenger.unsubscribe('websocket.event', handleWebSocketEvent);
		} catch (error) {
			errors.push(error);
		}
	}

	messenger = undefined;
	binding = undefined;
	bound = false;

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close GraphQL WebSocket pub/sub');
	}
}

export function createSubscriptionGenerator(self: GraphQLService, event: string) {
	return async function* (_x: unknown, _y: unknown, _z: unknown, request: GraphQLResolveInfo) {
		const fields = parseFields(self, request);
		const args = parseArguments(request);

		for await (const payload of messages.subscribe(event)) {
			const eventData = payload as WebSocketEvent;

			if ('event' in args && eventData['action'] !== args['event']) {
				continue; // skip filtered events
			}

			const accountability = await refreshAccountability(self.accountability);
			const schema = await getSchema();

			const subscription: Omit<Subscription, 'client'> = {
				collection: eventData['collection'],
				event: eventData['action'],
				query: { fields },
			};

			if (eventData['action'] === 'delete') {
				// we have no data to send besides the key
				for (const key of eventData.keys) {
					yield { [event]: { key, data: null, event: eventData['action'] } };
				}
			}

			if (eventData['action'] === 'create') {
				try {
					subscription.item = eventData['key'];
					const result = await getPayload(subscription, accountability, schema, eventData);

					yield {
						[event]: {
							key: eventData['key'],
							data: result['data'],
							event: eventData['action'],
						},
					};
				} catch {
					// dont notify the subscription of permission errors
				}
			}

			if (eventData['action'] === 'update') {
				for (const key of eventData['keys']) {
					try {
						subscription.item = key;
						const result = await getPayload(subscription, accountability, schema, eventData);

						yield {
							[event]: {
								key,
								data: result['data'],
								event: eventData['action'],
							},
						};
					} catch {
						// dont notify the subscription of permission errors
					}
				}
			}
		}
	};
}

function createPubSub<P extends { [key: string]: unknown }>(emitter: EventEmitter) {
	return {
		publish: <T extends Extract<keyof P, string>>(event: T, payload: P[T]) =>
			void emitter.emit(event as string, payload),
		subscribe: async function* <T extends Extract<keyof P, string>>(event: T): AsyncIterableIterator<P[T]> {
			const asyncIterator = on(emitter, event);

			for await (const [value] of asyncIterator) {
				yield value;
			}
		},
	};
}

function parseFields(service: GraphQLService, request: GraphQLResolveInfo) {
	const selections = request.fieldNodes[0]?.selectionSet?.selections ?? [];

	const dataSelections = selections.reduce((result: readonly SelectionNode[], selection: SelectionNode) => {
		if (
			selection.kind === 'Field' &&
			selection.name.value === 'data' &&
			selection.selectionSet?.kind === 'SelectionSet'
		) {
			return selection.selectionSet.selections;
		}

		return result;
	}, []);

	const { fields } = service.getQuery({}, dataSelections, request.variableValues);
	return fields ?? [];
}

function parseArguments(request: GraphQLResolveInfo) {
	const args = request.fieldNodes[0]?.arguments ?? [];
	return args.reduce(
		(result, current) => {
			if ('value' in current.value && typeof current.value.value === 'string') {
				result[current.name.value] = current.value.value;
			}

			return result;
		},
		{} as Record<string, string>,
	);
}
