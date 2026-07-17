import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ioPackage = JSON.parse(readFileSync(new URL('../io-package.json', import.meta.url), 'utf8'));
const jsonConfig = JSON.parse(readFileSync(new URL('../admin/jsonConfig.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

assert.equal(pkg.name, 'iobroker.sanlightmesh');
assert.equal(pkg.version, ioPackage.common.version);
assert.equal(packageLock.version, pkg.version);
assert.equal(packageLock.packages[''].version, pkg.version);
assert.ok(ioPackage.common.news[pkg.version], 'io-package news must contain the current version');
assert.equal(pkg.main, 'src/main.ts');
assert.equal(ioPackage.common.adminUI.config, 'json');
assert.ok(ioPackage.common.encryptedNative.includes('mqttPassword'));
assert.ok(ioPackage.common.protectedNative.includes('mqttPassword'));
assert.equal(ioPackage.native.topicPrefix, 'sanlightmesh/v1');
assert.equal(ioPackage.native.gatewayId, '');
assert.equal(ioPackage.native.allowBlackout, false);
assert.ok(pkg.files.includes('src/'));
assert.ok(pkg.files.includes('docs/'));
assert.equal(jsonConfig.type, 'panel');
assert.equal(
	jsonConfig.i18n,
	false,
	'jsonConfig must explicitly disable external i18n when no translation files are used',
);
assert.equal((readme.match(/^# /gm) || []).length, 1, 'README must have exactly one H1');
assert.ok(!readme.includes('iobroker url '), 'README must use the Admin custom URL installation path');
assert.ok(
	!/applied-caas|internal\.api\.openai\.org/.test(JSON.stringify(packageLock)),
	'package-lock.json must not reference an internal npm registry',
);
assert.ok(
	JSON.stringify(packageLock).includes('https://registry.npmjs.org/'),
	'package-lock.json must resolve packages through the public npm registry',
);
assert.ok(
	!/\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{[^}]*\btype\s+[A-Za-z_$][\w$]*[^}]*\}\s+from\s+['"]/s.test(mainSource),
	'src/main.ts must avoid inline type import specifiers for ioBroker esbuild 0.11 compatibility',
);

console.log('Package metadata validation passed.');
