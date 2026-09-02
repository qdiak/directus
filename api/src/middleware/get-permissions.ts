import type { RequestHandler } from 'express';
import asyncHandler from '../utils/async-handler.js';
import { applyRequestPermissions } from '../utils/request-permissions.js';

const getPermissions: RequestHandler = asyncHandler(async (req, _res, next) => {
	if (!req.accountability) {
		throw new Error('getPermissions middleware needs to be called after authenticate');
	}

	await applyRequestPermissions(req.accountability, req.schema);

	return next();
});

export default getPermissions;
