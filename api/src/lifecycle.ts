export type LifecycleState = 'starting' | 'online' | 'closing' | 'closed' | 'failed';

let lifecycleState: LifecycleState = 'closed';

export let SERVER_ONLINE = false;

export const getLifecycleState = (): LifecycleState => lifecycleState;

export const setLifecycleState = (state: LifecycleState): void => {
	lifecycleState = state;
	SERVER_ONLINE = state === 'online';
};
