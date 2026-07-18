import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeDaylightConfiguration, buildDaylightFleetSummary, DaylightAnalysisError } from '../src/lib/daylight';
import type { DaylightConfiguration } from '../src/lib/protocol';

function configuration(id: number, name: string, values: Array<[number, number]>): DaylightConfiguration {
	return {
		id,
		name,
		valueCount: values.length,
		values: values.map(([timeInMinutes, brightness]) => ({
			timeInMinutes,
			time:
				timeInMinutes === 1440
					? '24:00'
					: `${String(Math.floor(timeInMinutes / 60)).padStart(2, '0')}:${String(timeInMinutes % 60).padStart(2, '0')}`,
			brightness,
		})),
	};
}

const flowering = configuration(947_599_001, '100% 12:12', [
	[0, 0],
	[359, 0],
	[360, 20],
	[390, 100],
	[1050, 100],
	[1080, 20],
	[1081, 0],
	[1440, 0],
]);

const vegetative = configuration(396_724_180, '100% 6:18', [
	[0, 0],
	[360, 0],
	[361, 20],
	[390, 100],
	[1410, 100],
	[1438, 20],
	[1440, 0],
]);

const alwaysDark = configuration(1_303_806_668, 'Absolut Dunkel', [
	[0, 0],
	[1440, 0],
]);

test('derives rounded schemas and cultivation classifications from the datapoints, not profile names', () => {
	const flower = analyzeDaylightConfiguration(flowering);
	assert.equal(flower.schema, '12:12');
	assert.equal(flower.cycleType, 'flowering');
	assert.equal(flower.lightWindowCount, 1);
	assert.equal(flower.onHours, 12.033);
	assert.equal(flower.offHours, 11.967);

	const veg = analyzeDaylightConfiguration(vegetative);
	assert.equal(veg.schema, '18:6');
	assert.equal(veg.cycleType, 'vegetative');
	assert.equal(veg.lightWindowCount, 1);
	assert.equal(veg.onHours, 18);
	assert.equal(veg.offHours, 6);
	assert.notEqual(veg.schema, vegetative.name.split(' ').at(-1));
});

test('recognizes all-dark, all-on and multiple-window schedules', () => {
	assert.deepEqual(
		{
			schema: analyzeDaylightConfiguration(alwaysDark).schema,
			cycleType: analyzeDaylightConfiguration(alwaysDark).cycleType,
			windows: analyzeDaylightConfiguration(alwaysDark).lightWindowCount,
		},
		{ schema: '0:24', cycleType: 'alwaysDark', windows: 0 },
	);

	const alwaysOn = analyzeDaylightConfiguration(
		configuration(4, 'Always', [
			[0, 100],
			[1440, 100],
		]),
	);
	assert.equal(alwaysOn.schema, '24:0');
	assert.equal(alwaysOn.cycleType, 'alwaysOn');
	assert.equal(alwaysOn.onHours, 24);

	const split = analyzeDaylightConfiguration(
		configuration(5, 'Split', [
			[0, 0],
			[359, 0],
			[360, 100],
			[480, 100],
			[481, 0],
			[719, 0],
			[720, 100],
			[840, 100],
			[841, 0],
			[1440, 0],
		]),
	);
	assert.equal(split.schema, 'custom');
	assert.equal(split.cycleType, 'custom');
	assert.equal(split.lightWindowCount, 2);
});

test('rounds a 2 hour 21 minute single light window to readable schema 2:22', () => {
	const analysis = analyzeDaylightConfiguration(
		configuration(6, 'Odd schedule', [
			[0, 0],
			[1082, 0],
			[1083, 100],
			[1222, 100],
			[1223, 0],
			[1440, 0],
		]),
	);
	assert.equal(analysis.onHours, 2.35);
	assert.equal(analysis.offHours, 21.65);
	assert.equal(analysis.schema, '2:22');
	assert.equal(analysis.cycleType, 'custom');
});

test('rejects incomplete daily curves instead of inventing missing endpoints', () => {
	assert.throws(
		() =>
			analyzeDaylightConfiguration(
				configuration(7, 'Incomplete start', [
					[60, 0],
					[1440, 0],
				]),
			),
		DaylightAnalysisError,
	);
	assert.throws(
		() =>
			analyzeDaylightConfiguration(
				configuration(8, 'Incomplete end', [
					[0, 0],
					[1380, 0],
				]),
			),
		DaylightAnalysisError,
	);
});

test('fleet summary distinguishes behavioral schedule conflicts from metadata-only differences', () => {
	const flowerAnalysis = analyzeDaylightConfiguration(flowering);
	const vegAnalysis = analyzeDaylightConfiguration(vegetative);
	const mixed = buildDaylightFleetSummary([
		{
			address: '0002',
			profileId: vegetative.id,
			profileName: vegetative.name,
			verifiedAt: '2026-07-18T15:17:14Z',
			lastReadOk: true,
			analysis: vegAnalysis,
		},
		{
			address: '0003',
			profileId: flowering.id,
			profileName: flowering.name,
			verifiedAt: '2026-07-18T15:17:15Z',
			lastReadOk: true,
			analysis: flowerAnalysis,
		},
	]);
	assert.equal(mixed.conflict, true);
	assert.equal(mixed.schemaConflict, true);
	assert.equal(mixed.distinctScheduleCount, 2);
	assert.match(mixed.summary, /0002=18:6/);
	assert.match(mixed.summary, /0003=12:12/);

	const renamedFlower = configuration(
		99,
		'Different name',
		flowering.values.map((value) => [value.timeInMinutes, value.brightness]),
	);
	const metadataOnly = buildDaylightFleetSummary([
		{
			address: '0002',
			profileId: flowering.id,
			profileName: flowering.name,
			verifiedAt: '2026-07-18T15:17:14Z',
			lastReadOk: true,
			analysis: flowerAnalysis,
		},
		{
			address: '0003',
			profileId: renamedFlower.id,
			profileName: renamedFlower.name,
			verifiedAt: '2026-07-18T15:17:15Z',
			lastReadOk: true,
			analysis: analyzeDaylightConfiguration(renamedFlower),
		},
	]);
	assert.equal(metadataOnly.conflict, false);
	assert.equal(metadataOnly.schemaConflict, false);
	assert.equal(metadataOnly.configurationConflict, true);
});
