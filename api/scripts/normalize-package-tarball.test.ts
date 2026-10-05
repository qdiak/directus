import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tar from 'tar';
import { expect, it } from 'vitest';
import { normalizePackageTarball } from './normalize-package-tarball.mjs';

it('normalizes pack ordering and timestamps without losing executable or bundled files', async () => {
	const root = await mkdtemp(join(tmpdir(), 'quantum-pack-test-'));

	try {
		const source = join(root, 'source');
		await mkdir(join(source, 'package/node_modules/@directus/env'), { recursive: true });
		await writeFile(join(source, 'package/cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 });
		await writeFile(join(source, 'package/node_modules/@directus/env/defaults.js'), 'export default { freeze: true };');
		const first = join(root, 'first.tgz');
		const second = join(root, 'second.tgz');
		await writeFile(join(source, 'package/package.json'), '{"name":"fixture","dependencies":{"b":"2","a":"1"}}');
		await tar.c({ cwd: source, file: first, gzip: true, mtime: new Date('2020-01-01') }, ['package']);
		await writeFile(join(source, 'package/package.json'), '{"dependencies":{"a":"1","b":"2"},"name":"fixture"}');
		await tar.c({ cwd: source, file: second, gzip: true, mtime: new Date('2025-01-01') }, ['package']);
		expect(await readFile(first)).not.toEqual(await readFile(second));
		await normalizePackageTarball(first);
		await normalizePackageTarball(second);
		expect(await readFile(first)).toEqual(await readFile(second));
		const consumer = join(root, 'consumer');
		await mkdir(consumer);
		await tar.x({ cwd: consumer, file: first });
		expect((await stat(join(consumer, 'package/cli.js'))).mode & 0o777).toBe(0o755);

		expect(await readFile(join(consumer, 'package/node_modules/@directus/env/defaults.js'), 'utf8')).toBe(
			'export default { freeze: true };',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
