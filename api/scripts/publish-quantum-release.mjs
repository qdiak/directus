/* eslint-env es2021 */
/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePackageTarball } from './normalize-package-tarball.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, 'release-artifacts');
const temporaryTag = 'quantum-release-9';

const packages = [
	{ folder: 'app', name: 'quantum_directus_app', version: '12.0.3-quantum.9' },
	{ folder: 'api', name: 'quantum_directus_api', version: '19.0.3-quantum.9' },
	{ folder: 'directus', name: 'quantum_directus', version: '10.10.8-quantum.9' },
];

await mkdir(directory, { recursive: true });
const previousLatest = {};

for (const pkg of packages) {
	const manifest = JSON.parse(await readFile(join(root, pkg.folder, 'package.json')));

	if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
		throw new Error(`Unexpected manifest: ${pkg.folder}`);
	}

	previousLatest[pkg.name] = (await metadata(pkg.name))['dist-tags'].latest;
	run('pnpm', ['pack', '--pack-destination', directory], join(root, pkg.folder));
	pkg.tarball = join(directory, `${pkg.name}-${pkg.version}.tgz`);
	await normalizePackageTarball(pkg.tarball);

	pkg.integrity = `sha512-${createHash('sha512')
		.update(await readFile(pkg.tarball))
		.digest('base64')}`;
}

await writeFile(
	join(directory, 'release-proof.json'),
	JSON.stringify(
		{
			sourceSha: process.env['GITHUB_SHA'],
			previousLatest,
			packages: packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
		},
		null,
		2,
	),
);

// A CLI/API körkörös exact függősége miatt előbb mindhárom immutable verzió
// legyen elérhető. A belső tag nem canary próbakör: ugyanebben a jobban latest lesz.
for (const pkg of packages) {
	let published = await metadata(`${pkg.name}/${pkg.version}`, true);

	if (!published) {
		run('npm', ['publish', pkg.tarball, '--access=public', '--provenance', '--tag', temporaryTag], root);

		for (let attempt = 0; attempt < 30; attempt++) {
			published = await metadata(`${pkg.name}/${pkg.version}`, true);
			if (published) break;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		if (!published) throw new Error(`Published version is not available: ${pkg.name}`);
	}

	if (published.version !== pkg.version || published.dist.integrity !== pkg.integrity) {
		throw new Error(`Registry artifact differs from the validated tarball: ${pkg.name}@${pkg.version}`);
	}
}

try {
	for (const pkg of packages) run('npm', ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest'], root);

	for (const pkg of packages) {
		if ((await metadata(pkg.name))['dist-tags'].latest !== pkg.version) throw new Error(`Latest mismatch: ${pkg.name}`);
	}
} catch (error) {
	// Exact verziót nem írunk felül és nem unpublish-olunk. A tag-visszaállítás
	// megszünteti a részleges latest előléptetést, az audit artifact megmarad.
	const rollbackErrors = [];

	for (const pkg of packages) {
		try {
			run('npm', ['dist-tag', 'add', `${pkg.name}@${previousLatest[pkg.name]}`, 'latest'], root);
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}
	}

	if (rollbackErrors.length) {
		throw new AggregateError([error, ...rollbackErrors], 'Latest promotion and rollback failed');
	}

	throw error;
}

for (const pkg of packages) {
	if ((await metadata(pkg.name))['dist-tags'][temporaryTag]) {
		run('npm', ['dist-tag', 'rm', pkg.name, temporaryTag], root);
	}
}

console.log('quantum-release=ok exact-trio=verified latest=promoted');

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 120_000 });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
}

async function metadata(path, allowMissing = false) {
	const response = await fetch(`https://registry.npmjs.org/${path}`, {
		headers: { 'cache-control': 'no-cache' },
		signal: AbortSignal.timeout(15000),
	});

	if (allowMissing && response.status === 404) return undefined;
	if (!response.ok) throw new Error(`Registry lookup failed: ${path}: ${response.status}`);
	return response.json();
}
