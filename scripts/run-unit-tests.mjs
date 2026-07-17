import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = join(repositoryRoot, 'build-test', 'test');
const testFiles = readdirSync(testDirectory, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
	.map((entry) => join(testDirectory, entry.name))
	.sort();

if (testFiles.length === 0) {
	throw new Error(`No compiled unit tests found below ${testDirectory}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
	cwd: repositoryRoot,
	stdio: 'inherit',
});

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
