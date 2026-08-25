import { closeAuthProviders } from '../auth.js';
import { closeBus } from '../bus/index.js';
import { closeCache } from '../cache.js';
import { closeDatabase } from '../database/index.js';
import { closeLock } from '../lock/index.js';
import { closeMailer } from '../mailer.js';
import { closeGlobalRateLimiter } from '../middleware/rate-limiter-global.js';
import { closeRateLimiter } from '../middleware/rate-limiter-ip.js';
import { closeRedis } from '../redis/index.js';
import { closeAxios } from '../request/index.js';
import { closeGraphqlSchemaCache } from '../services/graphql/schema-cache.js';
import { closeStorage } from '../storage/index.js';
import { closeSynchronization } from '../synchronization.js';
import { closeTelemetry } from '../telemetry/index.js';
import { closeResources } from '../utils/close-resources.js';

export async function closeRuntimeResources(): Promise<void> {
	await closeResources([
		{ name: 'telemetry', close: closeTelemetry },
		{ name: 'GraphQL schema cache', close: closeGraphqlSchemaCache },
		{ name: 'cache', close: closeCache },
		{ name: 'auth providers', close: closeAuthProviders },
		{ name: 'global rate limiter', close: closeGlobalRateLimiter },
		{ name: 'IP rate limiter', close: closeRateLimiter },
		{ name: 'HTTP agents', close: closeAxios },
		{ name: 'mailer', close: closeMailer },
		{ name: 'storage', close: closeStorage },
		{ name: 'synchronization', close: closeSynchronization },
		{ name: 'message bus', close: closeBus },
		{ name: 'lock', close: closeLock },
		{ name: 'Redis', close: closeRedis },
		{ name: 'database', close: closeDatabase },
	]);
}
