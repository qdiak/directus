import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import tar from 'tar';

/** Produces a deterministic release tarball and releases its temporary extraction directory. */
export async function normalizePackageTarball(tarballPath) {
	const directory = await mkdtemp(join(tmpdir(), 'quantum-release-pack-'));
	const output = resolve(tarballPath);

	try {
		await tar.x({ file: output, cwd: directory });
		const manifestPath = join(directory, 'package/package.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		// A pnpm pack a dependency mezőket aszinkron feloldási sorrendben írja.
		// Az azonos forrású újrafuttatás nem kaphat emiatt eltérő SHA512-t.
		await writeFile(manifestPath, `${JSON.stringify(sortKeys(manifest), null, 2)}\n`);
		const entries = await listEntries(directory, 'package');

		await tar.c(
			{ file: output, cwd: directory, gzip: true, portable: true, noMtime: true, noDirRecurse: true },
			entries,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeys(value[key])]),
		);
	}

	return value;
}

async function listEntries(root, path) {
	const entries = [path];

	for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) =>
		a.name < b.name ? -1 : Number(a.name > b.name),
	)) {
		const child = `${path}/${entry.name}`;
		if (entry.isDirectory()) entries.push(...(await listEntries(root, child)));
		else entries.push(child);
	}

	return entries;
}
