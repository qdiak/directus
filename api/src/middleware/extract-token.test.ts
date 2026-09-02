import type { Request, Response } from 'express';
import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import { beforeEach, expect, test, vi } from 'vitest';
import extractToken from './extract-token.js';
import '../types/express.d.ts';

vi.mock('@directus/env', () => ({ useEnv: vi.fn() }));

let mockRequest: Partial<Request & { token?: string }>;
let mockResponse: Partial<Response>;
const nextFunction = vi.fn();

beforeEach(() => {
	mockRequest = {};
	mockResponse = {};
	vi.mocked(useEnv).mockReturnValue({ SESSION_COOKIE_NAME: 'directus_session_token' });
	vi.clearAllMocks();
});

test('Token from query', () => {
	mockRequest = {
		query: {
			access_token: 'test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Token from Authorization header (capitalized)', () => {
	mockRequest = {
		headers: {
			authorization: 'Bearer test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Token from Authorization header (lowercase)', () => {
	mockRequest = {
		headers: {
			authorization: 'bearer test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Ignore the token if authorization header is too many parts', () => {
	mockRequest = {
		headers: {
			authorization: 'bearer test what another one',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBeNull();
	expect(nextFunction).toBeCalledTimes(1);
});

test('Null if no token passed', () => {
	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBeNull();
	expect(nextFunction).toBeCalledTimes(1);
});

test('Token from session cookie', () => {
	mockRequest = {
		cookies: {
			directus_session_token: 'session-token',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('session-token');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Explicit token takes precedence over session cookie', () => {
	mockRequest = {
		headers: { authorization: 'Bearer bearer-token' },
		cookies: { directus_session_token: 'session-token' },
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('bearer-token');
});

test('Rejects query and bearer token together', () => {
	mockRequest = {
		query: { access_token: 'query-token' },
		headers: { authorization: 'Bearer bearer-token' },
	};

	expect(() => extractToken(mockRequest as Request, mockResponse as Response, nextFunction)).toThrow(
		InvalidPayloadError,
	);

	expect(nextFunction).not.toHaveBeenCalled();
});
