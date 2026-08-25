import { test, vi, afterEach, beforeEach, expect } from 'vitest';
import { closeAxios, getAxios, _cache } from './index.js';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { Agent } from 'node:http';
import { agentWithIpValidation } from './agent-with-ip-validation.js';

vi.mock('axios');
vi.mock('./agent-with-ip-validation.js');

let mockAxiosInstance: AxiosInstance;
let mockAgentWithIpValidation: Agent;

beforeEach(() => {
	mockAxiosInstance = {} as AxiosInstance;
	mockAgentWithIpValidation = { destroy: vi.fn() } as unknown as Agent;

	vi.mocked(axios.create).mockReturnValue(mockAxiosInstance);
	vi.mocked(agentWithIpValidation).mockReturnValue(mockAgentWithIpValidation);
});

afterEach(() => {
	vi.clearAllMocks();
	_cache.axiosInstance = null;
	_cache.agents = [];
});

test('Creates and returns new axios instance with custom agents if cache is empty', async () => {
	await getAxios();

	expect(axios.create).toHaveBeenCalledWith({
		httpAgent: mockAgentWithIpValidation,
		httpsAgent: mockAgentWithIpValidation,
	});
});

test('Returns axios instance from cache immediately if cache has been filled', async () => {
	_cache.axiosInstance = mockAxiosInstance;

	const instance = await getAxios();

	expect(instance).toBe(mockAxiosInstance);
	expect(axios.create).not.toHaveBeenCalled();
});

test('Destroys owned agents and resets the axios singleton on close', async () => {
	await getAxios();
	await closeAxios();

	expect(mockAgentWithIpValidation.destroy).toHaveBeenCalledTimes(2);
	expect(_cache.axiosInstance).toBeNull();
	expect(_cache.agents).toEqual([]);
});
