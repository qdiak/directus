import type { NextFunction, Request, Response } from 'express';
import asyncHandler from '../utils/async-handler.js';
import { authenticateRequest } from '../utils/request-auth.js';

/**
 * Verify the passed JWT and assign the user ID and role to `req`
 */
export const handler = async (req: Request, _res: Response, next: NextFunction) => {
	req.accountability = await authenticateRequest(req, req.token);

	return next();
};

export default asyncHandler(handler);
