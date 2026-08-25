import { useEnv } from '@directus/env';
import { beforeAll, expect, test, vi } from 'vitest';
import { validateEnv } from './validate-env.js';

vi.mock('@directus/env');

beforeAll(() => {
	vi.mocked(useEnv).mockReturnValue({
		PRESENT_TEST_VARIABLE: 'true',
	});
});

test('should not have any error when key is present', () => {
	expect(() => validateEnv(['PRESENT_TEST_VARIABLE'])).not.toThrow();
});

test('should have error when key is missing', () => {
	expect(() => validateEnv(['ABSENT_TEST_VARIABLE'])).toThrow(
		'"ABSENT_TEST_VARIABLE" Environment Variable is missing.',
	);
});
