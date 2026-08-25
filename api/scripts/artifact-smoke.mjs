/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptsDirectory, '..');
const repositoryRoot = resolve(apiDirectory, '..');
const runtime = process.env['DIRECTUS_ARTIFACT_RUNTIME'] || process.execPath;
const pnpm = process.env['DIRECTUS_ARTIFACT_PNPM'] || 'pnpm';
const timeout = Number(process.env['DIRECTUS_ARTIFACT_TIMEOUT_MS'] || 120_000);

const runSandbox =
	process.env['DIRECTUS_ARTIFACT_SANDBOX'] === '1' ||
	(process.env['DIRECTUS_ARTIFACT_SANDBOX'] !== '0' && !basename(runtime).toLowerCase().includes('bun'));

const temporaryRoot = await mkdtemp(join(tmpdir(), 'directus-artifact-smoke-'));

try {
	run(pnpm, ['--filter', 'quantum_directus_api', 'build'], { cwd: repositoryRoot });

	const packDirectory = join(temporaryRoot, 'pack');
	await mkdir(packDirectory);
	run(pnpm, ['pack', '--pack-destination', packDirectory], { cwd: apiDirectory });

	const tarballs = (await readdir(packDirectory)).filter((file) => file.endsWith('.tgz'));

	if (tarballs.length !== 1) {
		throw new Error(`Expected one API tarball, received ${tarballs.length}`);
	}

	const tarball = join(packDirectory, tarballs[0]);
	const consumerDirectory = join(temporaryRoot, 'consumer');
	await mkdir(consumerDirectory);

	await writeFile(
		join(consumerDirectory, 'package.json'),
		JSON.stringify(
			{
				name: 'directus-artifact-smoke-consumer',
				private: true,
				type: 'module',
				dependencies: {
					quantum_directus_api: `file:${tarball}`,
				},
				pnpm: {
					overrides: {
						quantum_directus_api: `file:${tarball}`,
					},
				},
			},
			null,
			2,
		),
	);

	await copyFile(join(scriptsDirectory, 'artifact-smoke-consumer.mjs'), join(consumerDirectory, 'smoke.mjs'));
	await copyFile(join(scriptsDirectory, 'artifact-sandbox-consumer.mjs'), join(consumerDirectory, 'sandbox.mjs'));

	// The SQLite smoke must not be blocked by engine declarations from unused MSSQL/storage drivers.
	// The repository install remains engine-strict and frozen in its own validation job.
	run(pnpm, ['install', '--no-frozen-lockfile', '--config.engine-strict=false'], { cwd: consumerDirectory });
	run(runtime, ['--version'], { cwd: consumerDirectory });
	run(runtime, ['smoke.mjs'], { cwd: consumerDirectory, timeout });

	if (runSandbox) {
		run(runtime, ['sandbox.mjs'], { cwd: consumerDirectory, timeout });
	}

	const packedManifest = JSON.parse(
		await readFile(join(consumerDirectory, 'node_modules/quantum_directus_api/package.json')),
	);

	console.log(
		`artifact-smoke=ok package=${packedManifest.version} runtime=${basename(runtime)} sandbox=${
			runSandbox ? 'on' : 'off'
		}`,
	);
} finally {
	if (process.env['DIRECTUS_ARTIFACT_KEEP_TEMP'] === '1') {
		console.log(`artifact-smoke-temp=${temporaryRoot}`);
	} else {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function run(command, args, { cwd, timeout: commandTimeout } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: process.env,
		stdio: 'inherit',
		timeout: commandTimeout,
	});

	if (result.error) {
		throw new Error(`Failed to run ${command} ${args.join(' ')}`, { cause: result.error });
	}

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
	}
}
