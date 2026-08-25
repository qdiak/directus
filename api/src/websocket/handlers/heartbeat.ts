import { useEnv } from '@directus/env';
import { ServiceUnavailableError } from '@directus/errors';
import type { ActionHandler } from '@directus/types';
import { toBoolean } from '@directus/utils';
import emitter from '../../emitter.js';
import { WebSocketController, getWebSocketController } from '../controllers/index.js';
import { WebSocketMessage } from '../messages.js';
import type { WebSocketClient } from '../types.js';
import { fmtMessage, getMessageType } from '../utils/message.js';

const env = useEnv();

const HEARTBEAT_FREQUENCY = Number(env['WEBSOCKETS_HEARTBEAT_PERIOD']) * 1000;

export class HeartbeatHandler {
	private pulse: NodeJS.Timeout | undefined;
	private controller: WebSocketController;
	private messageWatchers = new Map<ActionHandler, NodeJS.Timeout>();
	private readonly handleMessage: ActionHandler = ({ client, message }) => {
		try {
			this.onMessage(client, WebSocketMessage.parse(message));
		} catch {
			/* ignore errors */
		}
	};

	private readonly handleClientChange: ActionHandler = () => this.checkClients();

	constructor(controller?: WebSocketController) {
		controller = controller ?? getWebSocketController();

		if (!controller) {
			throw new ServiceUnavailableError({ service: 'ws', reason: 'WebSocket server is not initialized' });
		}

		this.controller = controller;

		emitter.onAction('websocket.message', this.handleMessage);

		if (toBoolean(env['WEBSOCKETS_HEARTBEAT_ENABLED']) === true) {
			emitter.onAction('websocket.connect', this.handleClientChange);
			emitter.onAction('websocket.error', this.handleClientChange);
			emitter.onAction('websocket.close', this.handleClientChange);
		}
	}

	private checkClients() {
		const hasClients = this.controller.clients.size > 0;

		if (hasClients && !this.pulse) {
			this.pulse = setInterval(() => {
				this.pingClients();
			}, HEARTBEAT_FREQUENCY);
		}

		if (!hasClients && this.pulse) {
			clearInterval(this.pulse);
			this.pulse = undefined;
		}
	}

	onMessage(client: WebSocketClient, message: WebSocketMessage) {
		if (getMessageType(message) !== 'ping') return;
		// send pong message back as acknowledgement
		const data = 'uid' in message ? { uid: message.uid } : {};
		client.send(fmtMessage('pong', data));
	}

	pingClients() {
		const pendingClients = new Set<WebSocketClient>(this.controller.clients);
		const activeClients = new Set<WebSocketClient>();

		const messageWatcher: ActionHandler = ({ client }) => {
			// any message means this connection is still open
			if (!activeClients.has(client)) {
				pendingClients.delete(client);
				activeClients.add(client);
			}

			if (pendingClients.size === 0) {
				const timeout = this.messageWatchers.get(messageWatcher);
				if (timeout) clearTimeout(timeout);
				this.messageWatchers.delete(messageWatcher);
				emitter.offAction('websocket.message', messageWatcher);
			}
		};

		const timeout = setTimeout(() => {
			// close connections that haven't responded
			for (const client of pendingClients) {
				client.close();
			}

			this.messageWatchers.delete(messageWatcher);
			emitter.offAction('websocket.message', messageWatcher);
		}, HEARTBEAT_FREQUENCY);

		this.messageWatchers.set(messageWatcher, timeout);
		emitter.onAction('websocket.message', messageWatcher);

		// ping all the clients
		for (const client of pendingClients) {
			client.send(fmtMessage('ping'));
		}
	}

	async close(): Promise<void> {
		if (this.pulse) clearInterval(this.pulse);
		this.pulse = undefined;

		emitter.offAction('websocket.message', this.handleMessage);
		emitter.offAction('websocket.connect', this.handleClientChange);
		emitter.offAction('websocket.error', this.handleClientChange);
		emitter.offAction('websocket.close', this.handleClientChange);

		for (const [watcher, timeout] of this.messageWatchers) {
			clearTimeout(timeout);
			emitter.offAction('websocket.message', watcher);
		}

		this.messageWatchers.clear();
	}
}
