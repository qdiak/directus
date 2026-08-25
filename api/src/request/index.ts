import type { AxiosInstance } from 'axios';
import type { Agent } from 'node:http';

export const _cache: { axiosInstance: AxiosInstance | null; agents: Agent[] } = {
	axiosInstance: null,
	agents: [],
};

export async function getAxios() {
	if (!_cache.axiosInstance) {
		const axios = (await import('axios')).default;
		const { Agent: AgentHttp } = await import('node:http');
		const { Agent: AgentHttps } = await import('node:https');
		const { agentWithIpValidation } = await import('./agent-with-ip-validation.js');

		const httpAgent = agentWithIpValidation(new AgentHttp());
		const httpsAgent = agentWithIpValidation(new AgentHttps());

		_cache.axiosInstance = axios.create({ httpAgent, httpsAgent });
		_cache.agents = [httpAgent, httpsAgent];
	}

	return _cache.axiosInstance;
}

export async function closeAxios(): Promise<void> {
	const agents = _cache.agents;
	_cache.axiosInstance = null;
	_cache.agents = [];

	for (const agent of agents) agent.destroy();
}
