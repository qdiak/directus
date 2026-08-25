export type NamedDisposer = {
	name: string;
	close: () => void | Promise<void>;
};

export async function closeResources(disposers: NamedDisposer[]): Promise<void> {
	const errors: Error[] = [];

	for (const disposer of disposers) {
		try {
			await disposer.close();
		} catch (error) {
			errors.push(new Error(`Failed to close ${disposer.name}`, { cause: error }));
		}
	}

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to close runtime resources');
	}
}
