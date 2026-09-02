import type { RequestHandler } from 'express';
import { extractTokenFromRequest } from '../utils/request-auth.js';

/**
 * Extract access token from
 *
 * - 'access_token' query parameter
 * - 'Authorization' header
 * - Session cookie
 *
 * and store it under req.token
 */
const extractToken: RequestHandler = (req, _res, next) => {
	req.token = extractTokenFromRequest(req);
	next();
};

export default extractToken;
