import { createHash } from 'node:crypto';

import type { DaylightConfiguration } from './protocol';

export const DAYLIGHT_ANALYSIS_VERSION = 2 as const;
export const EFFECTIVE_LIGHT_THRESHOLD = 20 as const;
export const FLOWERING_MAX_HOURS = 13 as const;
export const TRANSITION_MAX_HOURS = 15 as const;

export type DaylightCycleType = 'flowering' | 'transition' | 'vegetative' | 'alwaysOn' | 'alwaysDark' | 'custom';

export class DaylightAnalysisError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'DaylightAnalysisError';
	}
}

export interface EffectiveLightWindow {
	startMinute: number;
	endMinute: number;
}

export interface DaylightAnalysis {
	analysisVersion: 2;
	effectiveLightThreshold: 20;
	onHours: number;
	offHours: number;
	schema: string;
	cycleType: DaylightCycleType;
	lightWindowCount: number;
	effectiveLightWindows: EffectiveLightWindow[];
	configurationFingerprint: string;
	scheduleFingerprint: string;
}

export interface DaylightFleetEntry {
	address: string;
	profileId: number;
	profileName: string;
	verifiedAt: string;
	lastReadOk: boolean;
	analysis: DaylightAnalysis;
}

export interface DaylightFleetSummary {
	analysisVersion: 2;
	effectiveLightThreshold: 20;
	verifiedLampCount: number;
	activeLampCount: number;
	ignoredAlwaysDarkLampCount: number;
	distinctScheduleCount: number;
	distinctConfigurationCount: number;
	distinctSchemaCount: number;
	scheduleDifference: boolean;
	configurationConflict: boolean;
	schemaConflict: boolean;
	combinedOnHours: number;
	combinedOffHours: number;
	combinedSchema: string;
	combinedCycleType: DaylightCycleType;
	combinedLightWindowCount: number;
	transitionWarning: boolean;
	conflict: boolean;
	conflictReason: string;
	summary: string;
	lamps: DaylightFleetEntry[];
}

const MINUTES_PER_DAY = 1440;
const EPSILON_MINUTES = 0.000001;
const FLOWERING_MAX_MINUTES = FLOWERING_MAX_HOURS * 60;
const TRANSITION_MAX_MINUTES = TRANSITION_MAX_HOURS * 60;

function canonicalJson(value: unknown): string {
	return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function roundHours(minutes: number): number {
	return Math.round((minutes / 60) * 1000) / 1000;
}

function roundMinute(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

function mergeIntervals(intervals: EffectiveLightWindow[]): EffectiveLightWindow[] {
	const sorted = intervals
		.filter((interval) => interval.endMinute - interval.startMinute > EPSILON_MINUTES)
		.map((interval) => ({
			startMinute: Math.max(0, Math.min(MINUTES_PER_DAY, interval.startMinute)),
			endMinute: Math.max(0, Math.min(MINUTES_PER_DAY, interval.endMinute)),
		}))
		.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);

	const merged: EffectiveLightWindow[] = [];
	for (const interval of sorted) {
		const previous = merged[merged.length - 1];
		if (!previous || interval.startMinute > previous.endMinute + EPSILON_MINUTES) {
			merged.push({ ...interval });
			continue;
		}
		previous.endMinute = Math.max(previous.endMinute, interval.endMinute);
	}

	return merged.map((interval) => ({
		startMinute: roundMinute(interval.startMinute),
		endMinute: roundMinute(interval.endMinute),
	}));
}

function effectiveSegment(
	startMinute: number,
	endMinute: number,
	startBrightness: number,
	endBrightness: number,
): EffectiveLightWindow | undefined {
	if (endMinute <= startMinute) return undefined;

	const startOn = startBrightness >= EFFECTIVE_LIGHT_THRESHOLD;
	const endOn = endBrightness >= EFFECTIVE_LIGHT_THRESHOLD;
	if (startOn && endOn) return { startMinute, endMinute };
	if (!startOn && !endOn) return undefined;

	const duration = endMinute - startMinute;
	const brightnessDelta = endBrightness - startBrightness;
	if (Math.abs(brightnessDelta) <= Number.EPSILON) return undefined;

	const crossing = startMinute + ((EFFECTIVE_LIGHT_THRESHOLD - startBrightness) / brightnessDelta) * duration;
	if (startOn) return { startMinute, endMinute: crossing };
	return { startMinute: crossing, endMinute };
}

function effectiveLightWindows(configuration: DaylightConfiguration): EffectiveLightWindow[] {
	const intervals: EffectiveLightWindow[] = [];
	for (let index = 0; index < configuration.values.length - 1; index += 1) {
		const current = configuration.values[index]!;
		const next = configuration.values[index + 1]!;
		const interval = effectiveSegment(
			current.timeInMinutes,
			next.timeInMinutes,
			current.brightness,
			next.brightness,
		);
		if (interval) intervals.push(interval);
	}
	return mergeIntervals(intervals);
}

function intervalMinutes(intervals: EffectiveLightWindow[]): number {
	return intervals.reduce((total, interval) => total + interval.endMinute - interval.startMinute, 0);
}

function countCircularLightWindows(intervals: EffectiveLightWindow[]): number {
	if (intervals.length === 0) return 0;
	if (
		intervals.length > 1 &&
		intervals[0]!.startMinute <= EPSILON_MINUTES &&
		intervals[intervals.length - 1]!.endMinute >= MINUTES_PER_DAY - EPSILON_MINUTES
	) {
		return intervals.length - 1;
	}
	return intervals.length;
}

function classifyCycle(onMinutes: number, offMinutes: number, lightWindowCount: number): DaylightCycleType {
	if (onMinutes <= EPSILON_MINUTES) return 'alwaysDark';
	if (offMinutes <= EPSILON_MINUTES) return 'alwaysOn';
	if (lightWindowCount !== 1) return 'custom';
	if (onMinutes < FLOWERING_MAX_MINUTES - EPSILON_MINUTES) return 'flowering';
	if (onMinutes <= TRANSITION_MAX_MINUTES + EPSILON_MINUTES) return 'transition';
	return 'vegetative';
}

function readableSchema(onMinutes: number, lightWindowCount: number): string {
	if (lightWindowCount > 1) return 'custom';
	const roundedOnHours = Math.max(0, Math.min(24, Math.round(onMinutes / 60)));
	return `${roundedOnHours}:${24 - roundedOnHours}`;
}

export function analyzeDaylightConfiguration(configuration: DaylightConfiguration): DaylightAnalysis {
	if (configuration.values.length < 2) {
		throw new DaylightAnalysisError('daylight analysis requires at least two datapoints');
	}
	if (configuration.values[0]?.timeInMinutes !== 0) {
		throw new DaylightAnalysisError('daylight analysis requires a 00:00 datapoint');
	}
	if (configuration.values[configuration.values.length - 1]?.timeInMinutes !== MINUTES_PER_DAY) {
		throw new DaylightAnalysisError('daylight analysis requires a 24:00 datapoint');
	}

	const windows = effectiveLightWindows(configuration);
	const onMinutes = Math.max(0, Math.min(MINUTES_PER_DAY, intervalMinutes(windows)));
	const offMinutes = MINUTES_PER_DAY - onMinutes;
	const lightWindowCount = countCircularLightWindows(windows);

	const normalizedConfiguration = {
		id: configuration.id,
		name: configuration.name,
		values: configuration.values.map((value) => ({
			timeInMinutes: value.timeInMinutes,
			brightness: value.brightness,
		})),
	};
	const normalizedSchedule = normalizedConfiguration.values;

	return {
		analysisVersion: DAYLIGHT_ANALYSIS_VERSION,
		effectiveLightThreshold: EFFECTIVE_LIGHT_THRESHOLD,
		onHours: roundHours(onMinutes),
		offHours: roundHours(offMinutes),
		schema: readableSchema(onMinutes, lightWindowCount),
		cycleType: classifyCycle(onMinutes, offMinutes, lightWindowCount),
		lightWindowCount,
		effectiveLightWindows: windows,
		configurationFingerprint: fingerprint(normalizedConfiguration),
		scheduleFingerprint: fingerprint(normalizedSchedule),
	};
}

export function buildDaylightFleetSummary(entries: Iterable<DaylightFleetEntry>): DaylightFleetSummary {
	const lamps = [...entries].sort((left, right) => left.address.localeCompare(right.address));
	const activeLamps = lamps.filter(
		(entry) => intervalMinutes(entry.analysis.effectiveLightWindows) > EPSILON_MINUTES,
	);
	const ignoredAlwaysDarkLampCount = lamps.length - activeLamps.length;
	const schedules = new Set(lamps.map((entry) => entry.analysis.scheduleFingerprint));
	const configurations = new Set(lamps.map((entry) => entry.analysis.configurationFingerprint));
	const schemas = new Set(lamps.map((entry) => entry.analysis.schema));
	const scheduleDifference = schedules.size > 1;
	const configurationConflict = configurations.size > 1;
	const schemaConflict = schemas.size > 1;

	const combinedWindows = mergeIntervals(
		activeLamps.flatMap((entry) => entry.analysis.effectiveLightWindows.map((window) => ({ ...window }))),
	);
	const combinedOnMinutes = Math.max(0, Math.min(MINUTES_PER_DAY, intervalMinutes(combinedWindows)));
	const combinedOffMinutes = MINUTES_PER_DAY - combinedOnMinutes;
	const combinedLightWindowCount = countCircularLightWindows(combinedWindows);
	const combinedSchema = readableSchema(combinedOnMinutes, combinedLightWindowCount);
	const combinedCycleType = classifyCycle(combinedOnMinutes, combinedOffMinutes, combinedLightWindowCount);

	const floweringIntentLamps = activeLamps.filter(
		(entry) => intervalMinutes(entry.analysis.effectiveLightWindows) < FLOWERING_MAX_MINUTES - EPSILON_MINUTES,
	);
	const combinedLeavesFloweringRange = combinedOnMinutes >= FLOWERING_MAX_MINUTES - EPSILON_MINUTES;
	const conflict = activeLamps.length > 1 && floweringIntentLamps.length > 0 && combinedLeavesFloweringRange;
	const transitionWarning =
		activeLamps.some((entry) => {
			const minutes = intervalMinutes(entry.analysis.effectiveLightWindows);
			return (
				minutes >= FLOWERING_MAX_MINUTES - EPSILON_MINUTES &&
				minutes <= TRANSITION_MAX_MINUTES + EPSILON_MINUTES
			);
		}) ||
		(combinedOnMinutes >= FLOWERING_MAX_MINUTES - EPSILON_MINUTES &&
			combinedOnMinutes <= TRANSITION_MAX_MINUTES + EPSILON_MINUTES);

	let conflictReason: string;
	if (lamps.length === 0) {
		conflictReason = 'No verified daylight configurations are available.';
	} else if (activeLamps.length === 0) {
		conflictReason = 'All verified lamps are always dark and contribute no plant-light exposure.';
	} else if (conflict) {
		conflictReason = `Flowering-risk conflict: ${floweringIntentLamps
			.map((entry) => entry.address)
			.join(
				', ',
			)} individually remain below ${FLOWERING_MAX_HOURS} light hours, but the combined exposure is ${roundHours(combinedOnMinutes)} hours.`;
	} else if (
		scheduleDifference &&
		activeLamps.every(
			(entry) => intervalMinutes(entry.analysis.effectiveLightWindows) >= FLOWERING_MAX_MINUTES - EPSILON_MINUTES,
		)
	) {
		conflictReason = `Schedules differ, but every active lamp has at least ${FLOWERING_MAX_HOURS} light hours; no flowering-risk conflict is raised.`;
	} else if (ignoredAlwaysDarkLampCount > 0) {
		conflictReason = `${ignoredAlwaysDarkLampCount} always-dark lamp${ignoredAlwaysDarkLampCount === 1 ? ' is' : 's are'} ignored for combined plant-light exposure.`;
	} else {
		conflictReason = 'No flowering-risk conflict detected.';
	}

	let summary: string;
	if (lamps.length === 0) {
		summary = 'No verified daylight configurations are available.';
	} else if (activeLamps.length === 0) {
		summary = `${lamps.length} verified lamp${lamps.length === 1 ? ' is' : 's are'} always dark.`;
	} else {
		const ignoredSuffix =
			ignoredAlwaysDarkLampCount > 0
				? `; ${ignoredAlwaysDarkLampCount} always-dark lamp${ignoredAlwaysDarkLampCount === 1 ? '' : 's'} ignored`
				: '';
		if (conflict) {
			summary = `Flowering-risk conflict: ${activeLamps.length} active lamps combine to ${combinedSchema} (${combinedCycleType})${ignoredSuffix}.`;
		} else if (scheduleDifference) {
			summary = `${activeLamps.length} active lamps have different schedules and combine to ${combinedSchema} (${combinedCycleType}) without a flowering-risk conflict${ignoredSuffix}.`;
		} else {
			summary = `${activeLamps.length} active lamp${activeLamps.length === 1 ? '' : 's'} combine to ${combinedSchema} (${combinedCycleType})${ignoredSuffix}.`;
		}
	}

	return {
		analysisVersion: DAYLIGHT_ANALYSIS_VERSION,
		effectiveLightThreshold: EFFECTIVE_LIGHT_THRESHOLD,
		verifiedLampCount: lamps.length,
		activeLampCount: activeLamps.length,
		ignoredAlwaysDarkLampCount,
		distinctScheduleCount: schedules.size,
		distinctConfigurationCount: configurations.size,
		distinctSchemaCount: schemas.size,
		scheduleDifference,
		configurationConflict,
		schemaConflict,
		combinedOnHours: roundHours(combinedOnMinutes),
		combinedOffHours: roundHours(combinedOffMinutes),
		combinedSchema,
		combinedCycleType,
		combinedLightWindowCount,
		transitionWarning,
		conflict,
		conflictReason,
		summary,
		lamps,
	};
}
