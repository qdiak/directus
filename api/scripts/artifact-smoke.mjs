/* eslint-env es6 */
/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptsDirectory, '..');
const repositoryRoot = resolve(apiDirectory, '..');
const appDirectory = resolve(repositoryRoot, 'app');
const directusDirectory = resolve(repositoryRoot, 'directus');
const runtime = process.env['DIRECTUS_ARTIFACT_RUNTIME'] || process.execPath;
const pnpm = process.env['DIRECTUS_ARTIFACT_PNPM'] || 'pnpm';
const commandTimeout = Number(process.env['DIRECTUS_ARTIFACT_COMMAND_TIMEOUT_MS'] || 600_000);
const runtimeTimeout = Number(process.env['DIRECTUS_ARTIFACT_TIMEOUT_MS'] || 120_000);
const killGrace = Number(process.env['DIRECTUS_ARTIFACT_KILL_GRACE_MS'] || 5_000);

for (const [name, value] of [
	['DIRECTUS_ARTIFACT_COMMAND_TIMEOUT_MS', commandTimeout],
	['DIRECTUS_ARTIFACT_TIMEOUT_MS', runtimeTimeout],
	['DIRECTUS_ARTIFACT_KILL_GRACE_MS', killGrace],
]) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
}

const runSandbox =
	process.env['DIRECTUS_ARTIFACT_SANDBOX'] === '1' ||
	(process.env['DIRECTUS_ARTIFACT_SANDBOX'] !== '0' && !basename(runtime).toLowerCase().includes('bun'));

const temporaryRoot = await mkdtemp(join(tmpdir(), 'directus-artifact-smoke-'));

try {
	await run(pnpm, ['--version'], { cwd: repositoryRoot, timeout: 30_000 });
	await run(pnpm, ['--filter', 'quantum_directus_api', 'build'], { cwd: repositoryRoot });

	const packDirectory = join(temporaryRoot, 'pack');
	await mkdir(packDirectory);

	// A három Quantum csomag egymásra hivatkozó, együtt publikált release-egység.
	// A smoke ezért mindhármat a workspace-ből csomagolja, hogy egy még nem
	// publikált verzió CI-ja se a registry korábbi siblingjeivel adjon hamis eredményt.
	const appTarball = await packWorkspacePackage(appDirectory, 'quantum_directus_app', packDirectory);
	const directusTarball = await packWorkspacePackage(directusDirectory, 'quantum_directus', packDirectory);
	const apiTarball = await packWorkspacePackage(apiDirectory, 'quantum_directus_api', packDirectory);
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
					quantum_directus_api: `file:${apiTarball}`,
				},
				pnpm: {
					overrides: {
						quantum_directus: `file:${directusTarball}`,
						quantum_directus_api: `file:${apiTarball}`,
						quantum_directus_app: `file:${appTarball}`,
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
	await run(pnpm, ['install', '--no-frozen-lockfile', '--config.engine-strict=false'], { cwd: consumerDirectory });
	await run(runtime, ['--version'], { cwd: consumerDirectory, timeout: 30_000 });
	await run(runtime, ['smoke.mjs'], { cwd: consumerDirectory, timeout: runtimeTimeout });

	if (runSandbox) {
		await run(runtime, ['sandbox.mjs'], { cwd: consumerDirectory, timeout: runtimeTimeout });
	}

	const packedApiManifestPath = join(consumerDirectory, 'node_modules/quantum_directus_api/package.json');
	const packedApiManifest = JSON.parse(await readFile(packedApiManifestPath));
	// A pnpm symlinkelt package-et realpath alapján oldjuk fel, különben a Node a
	// consumer gyökerében keresné a szándékosan csak tranzitívan telepített siblingeket.
	const requireFromPackedApi = createRequire(await realpath(packedApiManifestPath));

	const packedAppManifest = JSON.parse(
		await readFile(requireFromPackedApi.resolve('quantum_directus_app/package.json')),
	);

	const packedDirectusManifest = JSON.parse(
		await readFile(requireFromPackedApi.resolve('quantum_directus/package.json')),
	);

	assertPublishedDependency(packedApiManifest, 'quantum_directus_app', packedAppManifest.version);
	assertPublishedDependency(packedApiManifest, 'quantum_directus', packedDirectusManifest.version);
	assertPublishedDependency(packedDirectusManifest, 'quantum_directus_api', packedApiManifest.version);
	assertNoLocalDependencySpecifiers(packedApiManifest);
	assertNoLocalDependencySpecifiers(packedAppManifest);
	assertNoLocalDependencySpecifiers(packedDirectusManifest);

	console.log(
		`artifact-smoke=ok api=${packedApiManifest.version} app=${packedAppManifest.version} directus=${
			packedDirectusManifest.version
		} runtime=${basename(runtime)} sandbox=${runSandbox ? 'on' : 'off'}`,
	);
} finally {
	if (process.env['DIRECTUS_ARTIFACT_KEEP_TEMP'] === '1') {
		console.log(`artifact-smoke-temp=${temporaryRoot}`);
	} else {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

async function packWorkspacePackage(packageDirectory, packageName, packDirectory) {
	await run(pnpm, ['pack', '--pack-destination', packDirectory], { cwd: packageDirectory });

	const prefix = `${packageName}-`;
	const matches = (await readdir(packDirectory)).filter((file) => file.startsWith(prefix) && file.endsWith('.tgz'));

	if (matches.length !== 1) {
		throw new Error(`Expected one ${packageName} tarball, received ${matches.length}`);
	}

	return join(packDirectory, matches[0]);
}

function assertPublishedDependency(manifest, dependencyName, expectedVersion) {
	const actualVersion = manifest.dependencies?.[dependencyName];

	if (actualVersion !== expectedVersion) {
		throw new Error(
			`${manifest.name} must depend on ${dependencyName}@${expectedVersion}; received ${String(actualVersion)}`,
		);
	}
}

function assertNoLocalDependencySpecifiers(manifest) {
	for (const [dependencyName, version] of Object.entries(manifest.dependencies ?? {})) {
		if (typeof version === 'string' && /^(?:file|link|workspace):/.test(version)) {
			throw new Error(`${manifest.name} retained local dependency ${dependencyName}@${version}`);
		}
	}
}

function run(command, args, { cwd, timeout = commandTimeout } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			detached: process.platform !== 'win32',
			env: process.env,
			stdio: 'inherit',
		});

		let finished = false;
		let timedOut = false;
		let forceKillTimer;

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			terminate('SIGTERM');
			forceKillTimer = setTimeout(() => terminate('SIGKILL'), killGrace);
		}, timeout);

		child.once('error', (error) => {
			settle(reject, new Error(`Failed to run ${command} ${args.join(' ')}`, { cause: error }));
		});

		child.once('close', (code, signal) => {
			if (timedOut) {
				settle(reject, new Error(`${command} ${args.join(' ')} timed out after ${timeout}ms`));
				return;
			}

			if (code !== 0) {
				settle(
					reject,
					new Error(`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `status ${code}`}`),
				);

				return;
			}

			settle(resolve);
		});

		function terminate(signal) {
			if (!child.pid) return;

			try {
				if (process.platform === 'win32') child.kill(signal);
				else process.kill(-child.pid, signal);
			} catch {
				child.kill(signal);
			}
		}

		function settle(callback, value) {
			if (finished) return;
			finished = true;
			clearTimeout(timeoutTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			callback(value);
		}
	});
}
