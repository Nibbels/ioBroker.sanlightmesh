import { createHash } from 'node:crypto';

import type { DaylightConfiguration } from './protocol';

export const DAYLIGHT_ANALYSIS_VERSION = 1 as const;

export type DaylightCycleType = 'flowering' | 'vegetative' | 'alwaysOn' | 'alwaysDark' | 'custom';

export class DaylightAnalysisError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'DaylightAnalysisError';
	}
}

export interface DaylightAnalysis {
	analysisVersion: 1;
	onHours: number;
	offHours: number;
	schema: string;
	cycleType: DaylightCycleType;
	lightWindowCount: number;
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
	analysisVersion: 1;
	verifiedLampCount: number;
	distinctScheduleCount: number;
	distinctConfigurationCount: number;
	distinctSchemaCount: number;
	conflict: boolean;
	configurationConflict: boolean;
	schemaConflict: boolean;
	summary: string;
	lamps: DaylightFleetEntry[];
}

interface ScheduleInterval {
	start: number;
	end: number;
	positive: boolean;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function roundHours(minutes: number): number {
	return Math.round((minutes / 60) * 1000) / 1000;
}

function normalizeIntervals(configuration: DaylightConfiguration): ScheduleInterval[] {
	const values = configuration.values;
	if (values.length === 0) {
		return [{ start: 0, end: 1440, positive: false }];
	}

	const points = values.map((value) => ({
		timeInMinutes: value.timeInMinutes,
		brightness: value.brightness,
	}));

	const firstPoint = points[0]!;
	if (firstPoint.timeInMinutes > 0) {
		points.unshift({ timeInMinutes: 0, brightness: firstPoint.brightness });
	}
	const finalPoint = points[points.length - 1]!;
	if (finalPoint.timeInMinutes < 1440) {
		const last = finalPoint;
		points.push({ timeInMinutes: 1440, brightness: last.brightness });
	}

	const intervals: ScheduleInterval[] = [];
	for (let index = 0; index < points.length - 1; index += 1) {
		const current = points[index]!;
		const next = points[index + 1]!;
		if (next.timeInMinutes <= current.timeInMinutes) continue;
		intervals.push({
			start: current.timeInMinutes,
			end: next.timeInMinutes,
			// All evidenced SANlight daylight values are non-negative. A linear
			// segment emits light for its complete non-zero-length interior when
			// either endpoint is above zero; a zero endpoint itself has no duration.
			positive: current.brightness > 0 || next.brightness > 0,
		});
	}

	if (intervals.length === 0) {
		return [{ start: 0, end: 1440, positive: points[0]!.brightness > 0 }];
	}
	return intervals;
}

function countCircularLightWindows(intervals: ScheduleInterval[]): number {
	const positiveCount = intervals.filter((interval) => interval.positive).length;
	if (positiveCount === 0) return 0;
	if (positiveCount === intervals.length) return 1;

	let windows = 0;
	for (let index = 0; index < intervals.length; index += 1) {
		const previous = intervals[(index + intervals.length - 1) % intervals.length]!;
		const current = intervals[index]!;
		if (!previous.positive && current.positive) windows += 1;
	}
	return windows;
}

function classifyCycle(onMinutes: number, offMinutes: number, lightWindowCount: number): DaylightCycleType {
	if (onMinutes <= 0.000001) return 'alwaysDark';
	if (offMinutes <= 0.000001) return 'alwaysOn';
	if (lightWindowCount !== 1) return 'custom';

	const roundedOnHours = Math.max(0, Math.min(24, Math.round(onMinutes / 60)));
	if (roundedOnHours >= 10 && roundedOnHours <= 14) return 'flowering';
	if (roundedOnHours >= 16 && roundedOnHours <= 20) return 'vegetative';
	return 'custom';
}

export function analyzeDaylightConfiguration(configuration: DaylightConfiguration): DaylightAnalysis {
	if (configuration.values.length < 2) {
		throw new DaylightAnalysisError('daylight analysis requires at least two datapoints');
	}
	if (configuration.values[0]?.timeInMinutes !== 0) {
		throw new DaylightAnalysisError('daylight analysis requires a 00:00 datapoint');
	}
	if (configuration.values[configuration.values.length - 1]?.timeInMinutes !== 1440) {
		throw new DaylightAnalysisError('daylight analysis requires a 24:00 datapoint');
	}
	const intervals = normalizeIntervals(configuration);
	const onMinutes = intervals.reduce(
		(total, interval) => total + (interval.positive ? interval.end - interval.start : 0),
		0,
	);
	const boundedOnMinutes = Math.max(0, Math.min(1440, onMinutes));
	const offMinutes = 1440 - boundedOnMinutes;
	const lightWindowCount = countCircularLightWindows(intervals);
	const roundedOnHours = Math.max(0, Math.min(24, Math.round(boundedOnMinutes / 60)));
	const schema = lightWindowCount > 1 ? 'custom' : `${roundedOnHours}:${24 - roundedOnHours}`;

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
		onHours: roundHours(boundedOnMinutes),
		offHours: roundHours(offMinutes),
		schema,
		cycleType: classifyCycle(boundedOnMinutes, offMinutes, lightWindowCount),
		lightWindowCount,
		configurationFingerprint: fingerprint(normalizedConfiguration),
		scheduleFingerprint: fingerprint(normalizedSchedule),
	};
}

export function buildDaylightFleetSummary(entries: Iterable<DaylightFleetEntry>): DaylightFleetSummary {
	const lamps = [...entries].sort((left, right) => left.address.localeCompare(right.address));
	const schedules = new Set(lamps.map((entry) => entry.analysis.scheduleFingerprint));
	const configurations = new Set(lamps.map((entry) => entry.analysis.configurationFingerprint));
	const schemas = new Set(lamps.map((entry) => entry.analysis.schema));
	const conflict = schedules.size > 1;
	const configurationConflict = configurations.size > 1;
	const schemaConflict = schemas.size > 1;

	let summary: string;
	if (lamps.length === 0) {
		summary = 'No verified daylight configurations are available.';
	} else if (lamps.length === 1) {
		const lamp = lamps[0]!;
		summary = `${lamp.address}: ${lamp.analysis.schema} (${lamp.analysis.cycleType}), profile ${lamp.profileName}.`;
	} else if (!conflict) {
		const reference = lamps[0]!;
		summary = `${lamps.length} lamps share ${reference.analysis.schema} (${reference.analysis.cycleType}).`;
	} else {
		summary = `Daylight schedule conflict: ${lamps
			.map((lamp) => `${lamp.address}=${lamp.analysis.schema} (${lamp.analysis.cycleType})`)
			.join(', ')}.`;
	}

	return {
		analysisVersion: DAYLIGHT_ANALYSIS_VERSION,
		verifiedLampCount: lamps.length,
		distinctScheduleCount: schedules.size,
		distinctConfigurationCount: configurations.size,
		distinctSchemaCount: schemas.size,
		conflict,
		configurationConflict,
		schemaConflict,
		summary,
		lamps,
	};
}
