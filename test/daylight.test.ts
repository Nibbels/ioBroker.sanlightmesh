import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DAYLIGHT_ANALYSIS_VERSION,
	EFFECTIVE_LIGHT_THRESHOLD,
	analyzeDaylightConfiguration,
	buildDaylightFleetSummary,
	DaylightAnalysisError,
} from '../src/lib/daylight';
import type { DaylightFleetEntry } from '../src/lib/daylight';
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

function fleetEntry(address: string, profile: DaylightConfiguration): DaylightFleetEntry {
	return {
		address,
		profileId: profile.id,
		profileName: profile.name,
		verifiedAt: '2026-07-18T15:17:14Z',
		lastReadOk: true,
		analysis: analyzeDaylightConfiguration(profile),
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

test('uses the SANlight 20 percent effective threshold for exact light and dark hours', () => {
	const flower = analyzeDaylightConfiguration(flowering);
	assert.equal(flower.analysisVersion, DAYLIGHT_ANALYSIS_VERSION);
	assert.equal(flower.effectiveLightThreshold, EFFECTIVE_LIGHT_THRESHOLD);
	assert.equal(flower.schema, '12:12');
	assert.equal(flower.cycleType, 'flowering');
	assert.equal(flower.lightWindowCount, 1);
	assert.equal(flower.onHours, 12);
	assert.equal(flower.offHours, 12);
	assert.deepEqual(flower.effectiveLightWindows, [{ startMinute: 360, endMinute: 1080 }]);

	const veg = analyzeDaylightConfiguration(vegetative);
	assert.equal(veg.schema, '18:6');
	assert.equal(veg.cycleType, 'vegetative');
	assert.equal(veg.lightWindowCount, 1);
	assert.equal(veg.onHours, 17.95);
	assert.equal(veg.offHours, 6.05);
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
			[1081, 0],
			[1082, 20],
			[1223, 20],
			[1224, 0],
			[1440, 0],
		]),
	);
	assert.equal(analysis.onHours, 2.35);
	assert.equal(analysis.offHours, 21.65);
	assert.equal(analysis.schema, '2:22');
	assert.equal(analysis.cycleType, 'flowering');
});

test('uses the 13 to 15 hour range as an explicit transition classification', () => {
	const thirteenHours = analyzeDaylightConfiguration(
		configuration(7, '13 hours', [
			[0, 0],
			[300, 20],
			[1080, 20],
			[1440, 0],
		]),
	);
	assert.equal(thirteenHours.onHours, 13);
	assert.equal(thirteenHours.cycleType, 'transition');

	const fifteenHours = analyzeDaylightConfiguration(
		configuration(8, '15 hours', [
			[0, 0],
			[120, 20],
			[1020, 20],
			[1440, 0],
		]),
	);
	assert.equal(fifteenHours.onHours, 15);
	assert.equal(fifteenHours.cycleType, 'transition');

	const overFifteenHours = analyzeDaylightConfiguration(
		configuration(9, 'Over 15 hours', [
			[0, 0],
			[119, 20],
			[1020, 20],
			[1440, 0],
		]),
	);
	assert.equal(overFifteenHours.onHours, 15.017);
	assert.equal(overFifteenHours.cycleType, 'vegetative');
});

test('rejects incomplete daily curves instead of inventing missing endpoints', () => {
	assert.throws(
		() =>
			analyzeDaylightConfiguration(
				configuration(10, 'Incomplete start', [
					[60, 0],
					[1440, 0],
				]),
			),
		DaylightAnalysisError,
	);
	assert.throws(
		() =>
			analyzeDaylightConfiguration(
				configuration(11, 'Incomplete end', [
					[0, 0],
					[1380, 0],
				]),
			),
		DaylightAnalysisError,
	);
});

test('ignores always-dark lamps for combined plant-light conflict evaluation', () => {
	const summary = buildDaylightFleetSummary([fleetEntry('0002', alwaysDark), fleetEntry('0003', flowering)]);
	assert.equal(summary.verifiedLampCount, 2);
	assert.equal(summary.activeLampCount, 1);
	assert.equal(summary.ignoredAlwaysDarkLampCount, 1);
	assert.equal(summary.scheduleDifference, true);
	assert.equal(summary.configurationConflict, true);
	assert.equal(summary.schemaConflict, true);
	assert.equal(summary.combinedOnHours, 12);
	assert.equal(summary.combinedOffHours, 12);
	assert.equal(summary.combinedSchema, '12:12');
	assert.equal(summary.combinedCycleType, 'flowering');
	assert.equal(summary.conflict, false);
	assert.match(summary.conflictReason, /always-dark lamp is ignored/i);
});

test('raises a flowering-risk conflict when shifted flowering schedules extend combined exposure', () => {
	const nightFlowering = configuration(12, 'Night 12:12', [
		[0, 20],
		[360, 20],
		[361, 0],
		[1079, 0],
		[1080, 20],
		[1440, 20],
	]);
	const nightAnalysis = analyzeDaylightConfiguration(nightFlowering);
	assert.equal(nightAnalysis.schema, '12:12');
	assert.equal(nightAnalysis.cycleType, 'flowering');
	assert.equal(nightAnalysis.lightWindowCount, 1);

	const summary = buildDaylightFleetSummary([fleetEntry('0002', flowering), fleetEntry('0003', nightFlowering)]);
	assert.equal(summary.scheduleDifference, true);
	assert.equal(summary.combinedOnHours, 24);
	assert.equal(summary.combinedSchema, '24:0');
	assert.equal(summary.combinedCycleType, 'alwaysOn');
	assert.equal(summary.conflict, true);
	assert.match(summary.conflictReason, /Flowering-risk conflict/);
});

test('raises a flowering-risk conflict for a flowering profile combined with an 18:6 profile', () => {
	const summary = buildDaylightFleetSummary([fleetEntry('0002', vegetative), fleetEntry('0003', flowering)]);
	assert.equal(summary.conflict, true);
	assert.equal(summary.scheduleDifference, true);
	assert.equal(summary.schemaConflict, true);
	assert.equal(summary.combinedSchema, '18:6');
	assert.match(summary.summary, /Flowering-risk conflict/);
});

test('does not raise flowering conflict when every active lamp already has at least 13 light hours', () => {
	const transition = configuration(13, '13 hours', [
		[0, 0],
		[300, 20],
		[1080, 20],
		[1440, 0],
	]);
	const summary = buildDaylightFleetSummary([fleetEntry('0002', transition), fleetEntry('0003', vegetative)]);
	assert.equal(summary.scheduleDifference, true);
	assert.equal(summary.conflict, false);
	assert.equal(summary.transitionWarning, true);
	assert.match(summary.conflictReason, /every active lamp has at least 13 light hours/i);
});

test('keeps metadata-only profile differences informational', () => {
	const renamedFlower = configuration(
		99,
		'Different name',
		flowering.values.map((value) => [value.timeInMinutes, value.brightness]),
	);
	const summary = buildDaylightFleetSummary([fleetEntry('0002', flowering), fleetEntry('0003', renamedFlower)]);
	assert.equal(summary.scheduleDifference, false);
	assert.equal(summary.conflict, false);
	assert.equal(summary.schemaConflict, false);
	assert.equal(summary.configurationConflict, true);
	assert.equal(summary.combinedSchema, '12:12');
});

test('reports a fully dark fleet without an exposure conflict', () => {
	const secondDark = configuration(14, 'Also dark', [
		[0, 0],
		[1440, 0],
	]);
	const summary = buildDaylightFleetSummary([fleetEntry('0002', alwaysDark), fleetEntry('0003', secondDark)]);
	assert.equal(summary.activeLampCount, 0);
	assert.equal(summary.ignoredAlwaysDarkLampCount, 2);
	assert.equal(summary.combinedOnHours, 0);
	assert.equal(summary.combinedOffHours, 24);
	assert.equal(summary.combinedSchema, '0:24');
	assert.equal(summary.combinedCycleType, 'alwaysDark');
	assert.equal(summary.conflict, false);
	assert.match(summary.summary, /always dark/);
});
