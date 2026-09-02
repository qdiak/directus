import type { RequestHandler } from 'express';
import asyncHandler from '../utils/async-handler.js';
import { getRequestSchema } from '../utils/request-schema.js';

const schema: RequestHandler = asyncHandler(async (req, _res, next) => {
	req.schema = await getRequestSchema();
	return next();
});

export default schema;
