/* eslint-env es6 */
/* eslint-disable no-console */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const event = process.env['GITHUB_EVENT_PATH']
	? JSON.parse(await readFile(process.env['GITHUB_EVENT_PATH'], 'utf8'))
	: undefined;

const pushBase = event?.before && !/^0+$/.test(event.before) ? event.before : undefined;
const base = process.env['DIRECTUS_CHECK_BASE'] || event?.pull_request?.base?.sha || pushBase || 'HEAD^';

const changedFiles = run('git', ['diff', '--name-only', '--diff-filter=ACMRT', '-z', base, '--'])
	.split('\0')
	.filter(Boolean);

if (changedFiles.length === 0) {
	console.log('changed-files-check=skipped reason=no-files');
} else {
	run('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', '--', ...changedFiles], true);

	const lintFiles = changedFiles.filter((file) => /\.(?:cjs|js|mjs|ts|tsx|vue)$/.test(file));

	if (lintFiles.length > 0) {
		run('pnpm', ['exec', 'eslint', '--no-cache', '--', ...lintFiles], true);
	}

	console.log(`changed-files-check=ok files=${changedFiles.length} linted=${lintFiles.length}`);
}

function run(command, args, inherit = false) {
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: inherit ? 'inherit' : 'pipe',
	});

	if (result.error) {
		throw new Error(`Failed to run ${command} ${args.join(' ')}`, { cause: result.error });
	}

	if (result.status !== 0) {
		if (!inherit && result.stderr) process.stderr.write(result.stderr);
		throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
	}

	return result.stdout || '';
}
