import { useEnv } from '@directus/env';
import { GraphQLSchema } from 'graphql';
import LRUMapDefault from 'mnemonist/lru-map.js';
import { useBus } from '../../bus/index.js';

// Workaround for misaligned types in mnemonist package exports
const LRUMap = LRUMapDefault as unknown as typeof LRUMapDefault.default;

const env = useEnv();
let bus: ReturnType<typeof useBus> | undefined;
let subscribed = false;
let initialization: Promise<void> | undefined;

export const cache = new LRUMap<string, GraphQLSchema | string>(Number(env['GRAPHQL_SCHEMA_CACHE_CAPACITY'] ?? 100));

const handleSchemaChanged = () => {
	cache.clear();
};

export const initializeGraphqlSchemaCache = async (): Promise<void> => {
	if (subscribed) return;

	const pendingInitialization = (initialization ??= (async () => {
		bus = useBus();
		await bus.subscribe('schemaChanged', handleSchemaChanged);
		subscribed = true;
	})());

	try {
		await pendingInitialization;
	} catch (error) {
		if (initialization === pendingInitialization) initialization = undefined;
		bus = undefined;
		throw error;
	}
};

export const closeGraphqlSchemaCache = async (): Promise<void> => {
	const errors: unknown[] = [];

	try {
		await initialization;
	} catch (error) {
		errors.push(error);
	}

	if (subscribed && bus) {
		try {
			await bus.unsubscribe('schemaChanged', handleSchemaChanged);
		} catch (error) {
			errors.push(error);
		}
	}

	cache.clear();
	bus = undefined;
	subscribed = false;
	initialization = undefined;

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close GraphQL schema cache');
	}
};
