/* eslint-env es6 */
/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import tar from 'tar';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptsDirectory, '..');
const repositoryRoot = resolve(apiDirectory, '..');
const appDirectory = resolve(repositoryRoot, 'app');
const directusDirectory = resolve(repositoryRoot, 'directus');
const repositoryManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json')));
const runtime = process.env['DIRECTUS_ARTIFACT_RUNTIME'] || process.execPath;
const pnpm = process.env['DIRECTUS_ARTIFACT_PNPM'] || 'pnpm';
const commandTimeout = Number(process.env['DIRECTUS_ARTIFACT_COMMAND_TIMEOUT_MS'] || 600_000);
const runtimeTimeout = Number(process.env['DIRECTUS_ARTIFACT_TIMEOUT_MS'] || 120_000);
const killGrace = Number(process.env['DIRECTUS_ARTIFACT_KILL_GRACE_MS'] || 5_000);

const expectedVersions = {
	quantum_directus_app: '12.0.3-quantum.4',
	quantum_directus_api: '19.0.3-quantum.4',
	quantum_directus: '10.10.8-quantum.4',
};

if (typeof repositoryManifest.packageManager !== 'string') {
	throw new Error('The repository packageManager version is required for the artifact consumer');
}

for (const [name, value] of [
	['DIRECTUS_ARTIFACT_COMMAND_TIMEOUT_MS', commandTimeout],
	['DIRECTUS_ARTIFACT_TIMEOUT_MS', runtimeTimeout],
	['DIRECTUS_ARTIFACT_KILL_GRACE_MS', killGrace],
]) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
}

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

	await Promise.all(
		[appTarball, directusTarball, apiTarball].map((tarball) => assertTarballDoesNotContain(tarball, 'isolated-vm')),
	);

	const consumerDirectory = join(temporaryRoot, 'consumer');
	await mkdir(consumerDirectory);

	await writeFile(
		join(consumerDirectory, 'package.json'),
		JSON.stringify(
			{
				name: 'directus-artifact-smoke-consumer',
				private: true,
				type: 'module',
				packageManager: repositoryManifest.packageManager,
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
	await copyFile(join(scriptsDirectory, 'artifact-run-script-consumer.mjs'), join(consumerDirectory, 'run-script.mjs'));

	// The SQLite smoke must not be blocked by engine declarations from unused MSSQL/storage drivers.
	// The repository install remains engine-strict and frozen in its own validation job.
	await run(pnpm, ['install', '--no-frozen-lockfile', '--config.engine-strict=false'], { cwd: consumerDirectory });
	await run(runtime, ['--version'], { cwd: consumerDirectory, timeout: 30_000 });
	await run(runtime, ['smoke.mjs'], { cwd: consumerDirectory, timeout: runtimeTimeout });
	await run(runtime, ['run-script.mjs'], { cwd: consumerDirectory, timeout: runtimeTimeout });

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

	const packedEnvManifestPath = requireFromPackedApi.resolve('@directus/env/package.json');
	const packedEnvManifest = JSON.parse(await readFile(packedEnvManifestPath));

	if (packedEnvManifest.name !== '@directus/env') {
		throw new Error(`Packed environment package name mismatch: ${String(packedEnvManifest.name)}`);
	}

	assertExactVersion(packedAppManifest, expectedVersions.quantum_directus_app);
	assertExactVersion(packedApiManifest, expectedVersions.quantum_directus_api);
	assertExactVersion(packedDirectusManifest, expectedVersions.quantum_directus);
	assertBundledDependency(packedApiManifest, '@directus/env', packedEnvManifestPath);
	await assertPackedEnvContract(requireFromPackedApi);

	assertPublishedDependency(packedApiManifest, 'quantum_directus_app', packedAppManifest.version);
	assertPublishedDependency(packedApiManifest, 'quantum_directus', packedDirectusManifest.version);
	assertPublishedDependency(packedDirectusManifest, 'quantum_directus_api', packedApiManifest.version);
	assertNoLocalDependencySpecifiers(packedApiManifest);
	assertNoLocalDependencySpecifiers(packedAppManifest);
	assertNoLocalDependencySpecifiers(packedDirectusManifest);
	assertNoDependency(packedApiManifest, 'isolated-vm');
	assertNoDependency(packedAppManifest, 'isolated-vm');
	assertNoDependency(packedDirectusManifest, 'isolated-vm');
	assertModuleCannotBeResolved(requireFromPackedApi, 'isolated-vm');

	const productionGraph = JSON.parse(
		await run(pnpm, ['list', 'isolated-vm', '--prod', '--depth', 'Infinity', '--json'], {
			cwd: consumerDirectory,
			timeout: 30_000,
			capture: true,
		}),
	);

	assertDependencyGraphDoesNotContain(productionGraph, 'isolated-vm');

	console.log(
		`artifact-smoke=ok api=${packedApiManifest.version} app=${packedAppManifest.version} directus=${
			packedDirectusManifest.version
		} runtime=${basename(runtime)} run-script=trusted isolated-vm=absent`,
	);
} finally {
	if (process.env['DIRECTUS_ARTIFACT_KEEP_TEMP'] === '1') {
		console.log(`artifact-smoke-temp=${temporaryRoot}`);
	} else {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function assertExactVersion(manifest, expectedVersion) {
	if (manifest.version !== expectedVersion) {
		throw new Error(`${manifest.name} must be ${expectedVersion}; received ${String(manifest.version)}`);
	}
}

function assertBundledDependency(manifest, dependencyName, resolvedManifestPath) {
	if (!manifest.bundledDependencies?.includes(dependencyName)) {
		throw new Error(`${manifest.name} must bundle ${dependencyName}`);
	}

	const bundledPathSegment = `${manifest.name}/node_modules/${dependencyName}/package.json`;

	if (!resolvedManifestPath.includes(bundledPathSegment)) {
		throw new Error(`${dependencyName} resolved outside the packed ${manifest.name} artifact: ${resolvedManifestPath}`);
	}
}

async function assertPackedEnvContract(requireFromPackedApi) {
	const previousConfigPath = process.env['CONFIG_PATH'];
	const previousMarketplaceTrust = process.env['MARKETPLACE_TRUST'];

	process.env['CONFIG_PATH'] = join(temporaryRoot, 'missing-config');
	delete process.env['MARKETPLACE_TRUST'];

	try {
		const { useEnv } = await import(pathToFileURL(requireFromPackedApi.resolve('@directus/env')).href);
		const packedEnv = useEnv();

		if (packedEnv['MARKETPLACE_TRUST'] !== 'app') {
			throw new Error(`Packed MARKETPLACE_TRUST default must be app; received ${packedEnv['MARKETPLACE_TRUST']}`);
		}

		for (const obsoleteVariable of [
			'FLOWS_RUN_SCRIPT_MAX_MEMORY',
			'FLOWS_RUN_SCRIPT_TIMEOUT',
			'EXTENSIONS_SANDBOX_MEMORY',
			'EXTENSIONS_SANDBOX_TIMEOUT',
		]) {
			if (Object.hasOwn(packedEnv, obsoleteVariable)) {
				throw new Error(`Packed environment retained obsolete variable ${obsoleteVariable}`);
			}
		}
	} finally {
		if (previousConfigPath === undefined) delete process.env['CONFIG_PATH'];
		else process.env['CONFIG_PATH'] = previousConfigPath;

		if (previousMarketplaceTrust === undefined) delete process.env['MARKETPLACE_TRUST'];
		else process.env['MARKETPLACE_TRUST'] = previousMarketplaceTrust;
	}
}

async function assertTarballDoesNotContain(tarballPath, forbiddenName) {
	const entries = [];

	await tar.t({
		file: tarballPath,
		onentry: (entry) => entries.push(entry.path),
	});

	const match = entries.find((entry) => entry.toLowerCase().includes(forbiddenName.toLowerCase()));

	if (match) {
		throw new Error(`${basename(tarballPath)} retained ${forbiddenName} in packlist entry ${match}`);
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

function assertNoDependency(manifest, dependencyName) {
	for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		if (Object.hasOwn(manifest[section] ?? {}, dependencyName)) {
			throw new Error(`${manifest.name} retained ${dependencyName} in ${section}`);
		}
	}

	for (const section of ['bundledDependencies', 'bundleDependencies']) {
		if (Array.isArray(manifest[section]) && manifest[section].includes(dependencyName)) {
			throw new Error(`${manifest.name} retained ${dependencyName} in ${section}`);
		}
	}
}

function assertModuleCannotBeResolved(requireFromPackage, dependencyName) {
	let resolutionError;

	try {
		requireFromPackage.resolve(dependencyName);
	} catch (error) {
		resolutionError = error;
	}

	if (resolutionError?.code !== 'MODULE_NOT_FOUND') {
		throw new Error(`${dependencyName} unexpectedly resolves from the packed API`, { cause: resolutionError });
	}
}

function assertDependencyGraphDoesNotContain(value, dependencyName) {
	if (!value || typeof value !== 'object') return;

	for (const [key, child] of Object.entries(value)) {
		if (key === dependencyName || (key === 'name' && child === dependencyName)) {
			throw new Error(`Production dependency graph retained ${dependencyName}`);
		}

		assertDependencyGraphDoesNotContain(child, dependencyName);
	}
}

function run(command, args, { cwd, timeout = commandTimeout, capture = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			detached: process.platform !== 'win32',
			env: process.env,
			stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});

		let finished = false;
		let timedOut = false;
		let forceKillTimer;
		let stdout = '';
		let stderr = '';

		if (capture) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk) => (stdout += chunk));
			child.stderr.on('data', (chunk) => (stderr += chunk));
		}

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
					new Error(
						`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `status ${code}`}${
							stderr ? `: ${stderr.trim()}` : ''
						}`,
					),
				);

				return;
			}

			settle(resolve, stdout);
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
