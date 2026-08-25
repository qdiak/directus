import { useEnv } from '@directus/env';
import { toBoolean } from '@directus/utils';
import { getCache } from '../../cache.js';
import { scheduleSynchronizedJob, type ScheduledJob } from '../../utils/schedule.js';
import { track } from './track.js';

let telemetryJob: ScheduledJob | null = null;

/**
 * Exported to be able to test the anonymous callback function
 */
export const jobCallback = () => {
	track();
};

/**
 * Initialize the telemetry tracking. Will generate a report on start, and set a schedule to report
 * every 6 hours
 *
 * @returns Whether or not telemetry has been initialized
 */
export const initTelemetry = async () => {
	const env = useEnv();

	if (toBoolean(env['TELEMETRY']) === false) return false;
	if (telemetryJob) return true;

	telemetryJob = scheduleSynchronizedJob('telemetry', '0 */6 * * *', jobCallback);

	try {
		const { lockCache } = getCache();

		if (!(await lockCache.get('telemetry-lock'))) {
			await lockCache.set('telemetry-lock', true, 30000);

			track({ wait: false });

			// Don't flush the lock. We want to debounce these calls across containers on startup
		}
	} catch (error) {
		await closeTelemetry();
		throw error;
	}

	return true;
};

export const closeTelemetry = async (): Promise<void> => {
	const job = telemetryJob;
	telemetryJob = null;

	await job?.stop();
};
