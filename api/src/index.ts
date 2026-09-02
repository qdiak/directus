export { default as createApp } from './app.js';
export { createEmbeddedApp } from './embedded.js';
export type {
	DirectusHealth,
	EmbeddedDirectusApp,
	EmbeddedDirectusOptions,
	EmbeddedDirectusRequestContext,
} from './embedded.js';
export * from './services/index.js';
export * from './utils/get-schema.js';
