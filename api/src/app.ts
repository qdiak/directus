import cookieParser from 'cookie-parser';
import express, { Request, RequestHandler, Response } from 'express';
import fse from 'fs-extra';
import type { ServerResponse } from 'http';
import path from 'path';
import qs from 'qs';
import activityRouter from './controllers/activity';
import assetsRouter from './controllers/assets';
import authRouter from './controllers/auth';
import collectionsRouter from './controllers/collections';
import dashboardsRouter from './controllers/dashboards';
import extensionsRouter from './controllers/extensions';
import fieldsRouter from './controllers/fields';
import filesRouter from './controllers/files';
import flowsRouter from './controllers/flows';
import foldersRouter from './controllers/folders';
import graphqlRouter from './controllers/graphql';
import itemsRouter from './controllers/items';
import notFoundHandler from './controllers/not-found';
import notificationsRouter from './controllers/notifications';
import operationsRouter from './controllers/operations';
import panelsRouter from './controllers/panels';
import permissionsRouter from './controllers/permissions';
import presetsRouter from './controllers/presets';
import relationsRouter from './controllers/relations';
import revisionsRouter from './controllers/revisions';
import rolesRouter from './controllers/roles';
import schemaRouter from './controllers/schema';
import serverRouter from './controllers/server';
import settingsRouter from './controllers/settings';
import sharesRouter from './controllers/shares';
import usersRouter from './controllers/users';
import utilsRouter from './controllers/utils';
import webhooksRouter from './controllers/webhooks';
import { isInstalled, validateDatabaseConnection, validateDatabaseExtensions, validateMigrations } from './database';
import emitter from './emitter';
import env from './env';
import { InvalidPayloadException } from './exceptions';
import { getExtensionManager } from './extensions';
import { getFlowManager } from './flows';
import logger, { expressLogger } from './logger';
import authenticate from './middleware/authenticate';
import cache from './middleware/cache';
import { checkIP } from './middleware/check-ip';
import cors from './middleware/cors';
import errorHandler from './middleware/error-handler';
import extractToken from './middleware/extract-token';
import getPermissions from './middleware/get-permissions';
import rateLimiterGlobal from './middleware/rate-limiter-global';
import rateLimiter from './middleware/rate-limiter-ip';
import sanitizeQuery from './middleware/sanitize-query';
import schema from './middleware/schema';

import { merge } from 'lodash';
import { registerAuthProviders } from './auth';
import { flushCaches } from './cache';
import { getConfigFromEnv } from './utils/get-config-from-env';
import { collectTelemetry } from './utils/telemetry';
import { Url } from './utils/url';
import { validateEnv } from './utils/validate-env';
import { validateStorage } from './utils/validate-storage';
import { init as initWebhooks } from './webhooks';

export default async function createApp(): Promise<express.Application> {
	const helmet = await import('helmet');

	validateEnv(['KEY', 'SECRET']);

	if (!new Url(env['PUBLIC_URL']).isAbsolute()) {
		logger.warn('PUBLIC_URL should be a full URL');
	}

	await validateStorage();

	await validateDatabaseConnection();
	await validateDatabaseExtensions();

	if ((await isInstalled()) === false) {
		logger.error(`Database doesn't have Directus tables installed.`);
		process.exit(1);
	}

	if ((await validateMigrations()) === false) {
		logger.warn(`Database migrations have not all been run`);
	}

	await flushCaches();

	await registerAuthProviders();

	const extensionManager = getExtensionManager();
	const flowManager = getFlowManager();

	await extensionManager.initialize();
	await flowManager.initialize();

	const app = express();

	app.disable('x-powered-by');
	app.set('trust proxy', env['IP_TRUST_PROXY']);
	app.set('query parser', (str: string) => qs.parse(str, { depth: 10 }));

	app.use(
		helmet.contentSecurityPolicy(
			merge(
				{
					useDefaults: true,
					directives: {
						// Unsafe-eval is required for vue3 / vue-i18n / app extensions
						scriptSrc: ["'self'", "'unsafe-eval'"],

						// Even though this is recommended to have enabled, it breaks most local
						// installations. Making this opt-in rather than opt-out is a little more
						// friendly. Ref #10806
						upgradeInsecureRequests: null,

						// These are required for MapLibre
						// https://cdn.directus.io is required for images/videos in the official docs
						workerSrc: ["'self'", 'blob:'],
						childSrc: ["'self'", 'blob:'],
						imgSrc: ["'self'", 'data:', 'blob:', 'https://cdn.directus.io'],
						mediaSrc: ["'self'", 'https://cdn.directus.io'],
						connectSrc: ["'self'", 'https://*'],
					},
				},
				getConfigFromEnv('CONTENT_SECURITY_POLICY_')
			)
		)
	);

	if (env['HSTS_ENABLED']) {
		app.use(helmet.hsts(getConfigFromEnv('HSTS_', ['HSTS_ENABLED'])));
	}

	await emitter.emitInit('app.before', { app });

	await emitter.emitInit('middlewares.before', { app });

	app.use(expressLogger);

	app.use((_req, res, next) => {
		res.setHeader('X-Powered-By', 'Directus');
		next();
	});

	if (env['CORS_ENABLED'] === true) {
		app.use(cors);
	}

	app.use((req, res, next) => {
		(
			express.json({
				limit: env['MAX_PAYLOAD_SIZE'],
			}) as RequestHandler
		)(req, res, (err: any) => {
			if (err) {
				return next(new InvalidPayloadException(err.message));
			}

			return next();
		});
	});

	app.use(cookieParser());

	app.use(extractToken);

	app.get('/', (_req, res, next) => {
		if (env['ROOT_REDIRECT']) {
			res.redirect(env['ROOT_REDIRECT']);
		} else {
			next();
		}
	});

	app.get('/robots.txt', (_, res) => {
		res.set('Content-Type', 'text/plain');
		res.status(200);
		res.send(env['ROBOTS_TXT']);
	});

	if (env['SERVE_APP']) {
		const adminPath = require.resolve('au_directus_app');
		const adminUrl = new Url(env['PUBLIC_URL']).addPath('admin');

		const embeds = extensionManager.getEmbeds();

		// Set the App's base path according to the APIs public URL
		const html = await fse.readFile(adminPath, 'utf8');
		const htmlWithVars = html
			.replace(/<base \/>/, `<base href="${adminUrl.toString({ rootRelative: true })}/" />`)
			.replace(/<embed-head \/>/, embeds.head)
			.replace(/<embed-body \/>/, embeds.body);

		const sendHtml = (_req: Request, res: Response) => {
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Vary', 'Origin, Cache-Control');
			res.send(htmlWithVars);
		};

		const setStaticHeaders = (res: ServerResponse) => {
			res.setHeader('Cache-Control', 'max-age=31536000, immutable');
			res.setHeader('Vary', 'Origin, Cache-Control');
		};

		app.get('/admin', sendHtml);
		app.use('/admin', express.static(path.join(adminPath, '..'), { setHeaders: setStaticHeaders }));
		app.use('/admin/*', sendHtml);
	}

	// use the rate limiter - all routes for now
	if (env['RATE_LIMITER_GLOBAL_ENABLED'] === true) {
		app.use(rateLimiterGlobal);
	}
	if (env['RATE_LIMITER_ENABLED'] === true) {
		app.use(rateLimiter);
	}

	app.get('/server/ping', (_req, res) => res.send('pong'));

	app.use(authenticate);

	app.use(checkIP);

	app.use(sanitizeQuery);

	app.use(cache);

	app.use(schema);

	app.use(getPermissions);

	await emitter.emitInit('middlewares.after', { app });

	await emitter.emitInit('routes.before', { app });

	app.use('/auth', authRouter);

	app.use('/graphql', graphqlRouter);

	app.use('/activity', activityRouter);
	app.use('/assets', assetsRouter);
	app.use('/collections', collectionsRouter);
	app.use('/dashboards', dashboardsRouter);
	app.use('/extensions', extensionsRouter);
	app.use('/fields', fieldsRouter);
	app.use('/files', filesRouter);
	app.use('/flows', flowsRouter);
	app.use('/folders', foldersRouter);
	app.use('/items', itemsRouter);
	app.use('/notifications', notificationsRouter);
	app.use('/operations', operationsRouter);
	app.use('/panels', panelsRouter);
	app.use('/permissions', permissionsRouter);
	app.use('/presets', presetsRouter);
	app.use('/relations', relationsRouter);
	app.use('/revisions', revisionsRouter);
	app.use('/roles', rolesRouter);
	app.use('/schema', schemaRouter);
	app.use('/server', serverRouter);
	app.use('/settings', settingsRouter);
	app.use('/shares', sharesRouter);
	app.use('/users', usersRouter);
	app.use('/utils', utilsRouter);
	app.use('/webhooks', webhooksRouter);

	// Register custom endpoints
	await emitter.emitInit('routes.custom.before', { app });
	app.use(extensionManager.getEndpointRouter());
	await emitter.emitInit('routes.custom.after', { app });

	app.use(notFoundHandler);
	app.use(errorHandler);

	await emitter.emitInit('routes.after', { app });

	// Register all webhooks
	await initWebhooks();

	collectTelemetry();

	await emitter.emitInit('app.after', { app });

	return app;
}
