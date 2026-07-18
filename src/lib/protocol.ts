export const PROTOCOL_VERSION = 1 as const;
export const COMMAND_TTL_MIN = 1;
export const COMMAND_TTL_MAX = 300;
export const SET_MAX_MIN = 20;
export const SET_MAX_MAX = 100;
export const CLOCK_SECONDS_MIN = 0;
export const CLOCK_SECONDS_MAX = 86_399;

const GATEWAY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const NODE_ADDRESS_RE = /^[0-9A-F]{4}$/;
const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LAMP_CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const DAYLIGHT_CLOCK_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DAYLIGHT_COMBINED_CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/;
const LOWER_HEX_RE = /^[0-9a-f]+$/;
const LOWER_HEX_OR_EMPTY_RE = /^[0-9a-f]*$/;
const CLOCK_TARGET_RE = /^(?:([01]\d|2[0-3])):([0-5]\d)(?::([0-5]\d))?$/;

export type NodeTarget = string | 'all';
export type GatewayAction =
	| 'refresh'
	| 'read-daylight'
	| 'set-max'
	| 'blackout'
	| 'restore-blackout'
	| 'sync-clock'
	| 'set-clock'
	| 'refresh-gateway-info';

export interface GatewayNode {
	address: string;
	name: string;
}

export interface GatewayInfo {
	protocolVersion: 1;
	serviceVersion: string;
	gatewayId: string;
	meshUuid: string;
	senderAddress: string;
	nodes: GatewayNode[];
	commandTopic?: string;
	sequenceNumber?: number;
	sequenceRemaining?: number;
	sequenceRemainingPercent?: number;
	sequenceStatus?: 'ok' | 'warning' | 'critical';
	sequenceWarning?: string;
	localClockSeconds: number;
	localClock: string;
	timestamp: string;
	writePolicy?: Record<string, unknown>;
}

export interface NodeMeta {
	protocolVersion: 1;
	address: string;
	name: string;
	writable?: {
		maxBrightness?: {
			minimum?: number;
			maximum?: number;
		};
	};
	readable?: {
		daylightConfiguration?: boolean;
	};
	supportsExplicitBlackout: boolean;
}

export interface DaylightValue {
	timeInMinutes: number;
	time: string;
	brightness: number;
}

export interface DaylightConfiguration {
	id: number;
	name: string;
	valueCount: number;
	values: DaylightValue[];
}

export interface DaylightCombinedStatus {
	lampTimeMs: number;
	lampClock: string;
	liveBrightnessRaw: number;
	liveBrightnessPercentEstimate: number;
	maxBrightness: number;
}

export interface DaylightData {
	requestOpcode: 3 | 14;
	requestOpcodeHex: '0x03' | '0x0E';
	statusOpcode: 4 | 15;
	statusOpcodeHex: '0x04' | '0x0F';
	rawPduHex: string;
	rawParametersHex: string;
	parsed: boolean;
	parserLayout?: string;
	parseError?: string;
	configuration?: DaylightConfiguration;
	combinedStatus?: DaylightCombinedStatus;
}

export interface DaylightState extends Partial<DaylightData> {
	verified: boolean;
	verifiedAt?: string;
	lastReadAt: string;
	lastReadOk: boolean;
	lastError?: string;
	lastObservation?: DaylightData;
}

export interface NodeState {
	protocolVersion: 1;
	address: string;
	name: string;
	maxBrightness: number;
	off: boolean;
	verified: true;
	verifiedAt: string;
	cached?: boolean;
	liveVerified: boolean;
	lampClockSeconds?: number;
	lampClock?: string;
	liveBrightnessRaw?: number;
	liveBrightnessPercentEstimate?: number;
	liveVerifiedAt?: string;
	daylightConfiguration?: DaylightState;
}

export interface GatewayResult {
	protocolVersion: 1;
	id: string;
	ok: boolean;
	status: string;
	message: string;
	action?: GatewayAction;
	target?: string;
	requested?: number;
	requestedSecondsSinceMidnight?: number;
	details?: Record<string, unknown>;
	timestamp: string;
}

export interface RefreshCommand {
	id: string;
	action: 'refresh';
	target: string;
	createdAt: string;
	ttlSeconds: number;
}

export interface ReadDaylightCommand {
	id: string;
	action: 'read-daylight';
	target: string;
	createdAt: string;
	ttlSeconds: number;
}

export interface SetMaxCommand {
	id: string;
	action: 'set-max';
	target: string;
	value: number;
	createdAt: string;
	ttlSeconds: number;
}

export interface BlackoutCommand {
	id: string;
	action: 'blackout';
	target: string;
	confirmed: true;
	createdAt: string;
	ttlSeconds: number;
}

export interface RestoreBlackoutCommand {
	id: string;
	action: 'restore-blackout';
	target: 'latest';
	confirmed: true;
	createdAt: string;
	ttlSeconds: number;
}

export interface SyncClockCommand {
	id: string;
	action: 'sync-clock';
	target: string;
	createdAt: string;
	ttlSeconds: number;
}

export interface SetClockCommand {
	id: string;
	action: 'set-clock';
	target: string;
	secondsSinceMidnight: number;
	createdAt: string;
	ttlSeconds: number;
}

export interface RefreshGatewayInfoCommand {
	id: string;
	action: 'refresh-gateway-info';
	target: 'gateway';
	createdAt: string;
	ttlSeconds: number;
}

export type GatewayCommand =
	| RefreshCommand
	| ReadDaylightCommand
	| SetMaxCommand
	| BlackoutCommand
	| RestoreBlackoutCommand
	| SyncClockCommand
	| SetClockCommand
	| RefreshGatewayInfoCommand;

export interface GatewayTopics {
	root: string;
	availability: string;
	gatewayInfo: string;
	nodeMeta: string;
	nodeState: string;
	command: string;
	result: string;
}

export type ParsedTopic =
	| { kind: 'availability' }
	| { kind: 'gatewayInfo' }
	| { kind: 'nodeMeta'; address: string }
	| { kind: 'nodeState'; address: string }
	| { kind: 'result'; commandId: string };

export class ProtocolError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ProtocolError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new ProtocolError(`${label} must be a string`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') {
		throw new ProtocolError(`${label} must be a boolean`);
	}
	return value;
}

function requireInteger(value: unknown, label: string, minimum?: number, maximum?: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new ProtocolError(`${label} must be an integer`);
	}
	if (minimum !== undefined && value < minimum) {
		throw new ProtocolError(`${label} must be at least ${minimum}`);
	}
	if (maximum !== undefined && value > maximum) {
		throw new ProtocolError(`${label} must be at most ${maximum}`);
	}
	return value;
}

function optionalInteger(value: unknown, label: string, minimum?: number, maximum?: number): number | undefined {
	return value === undefined ? undefined : requireInteger(value, label, minimum, maximum);
}

function requireFiniteNumber(value: unknown, label: string, minimum?: number, maximum?: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new ProtocolError(`${label} must be a finite number`);
	}
	if (minimum !== undefined && value < minimum) {
		throw new ProtocolError(`${label} must be at least ${minimum}`);
	}
	if (maximum !== undefined && value > maximum) {
		throw new ProtocolError(`${label} must be at most ${maximum}`);
	}
	return value;
}

function requireTimestamp(value: unknown, label: string): string {
	const text = requireString(value, label);
	if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) || Number.isNaN(Date.parse(text))) {
		throw new ProtocolError(`${label} must be an ISO-8601 timestamp with timezone`);
	}
	return text;
}

function requireLowerHex(value: unknown, label: string, allowEmpty = false): string {
	const text = requireString(value, label, allowEmpty);
	const pattern = allowEmpty ? LOWER_HEX_OR_EMPTY_RE : LOWER_HEX_RE;
	if (!pattern.test(text)) throw new ProtocolError(`${label} must be lowercase hexadecimal`);
	return text;
}

function formatDaylightMinute(value: number): string {
	if (value === 1440) return '24:00';
	return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function formatMillisecondsAsClock(value: number): string {
	const normalized = value % 86_400_000;
	const totalSeconds = Math.floor(normalized / 1000);
	const milliseconds = normalized % 1000;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function parseDaylightConfiguration(value: unknown, label: string): DaylightConfiguration {
	if (!isRecord(value)) throw new ProtocolError(`${label} must be an object`);
	const valuesRaw = value.values;
	if (!Array.isArray(valuesRaw)) throw new ProtocolError(`${label}.values must be an array`);
	if (valuesRaw.length > 96) throw new ProtocolError(`${label}.values must contain at most 96 entries`);

	let previousMinute = -1;
	const values = valuesRaw.map((entry, index): DaylightValue => {
		if (!isRecord(entry)) throw new ProtocolError(`${label}.values[${index}] must be an object`);
		const timeInMinutes = requireInteger(entry.timeInMinutes, `${label}.values[${index}].timeInMinutes`, 0, 1440);
		if (timeInMinutes < previousMinute) {
			throw new ProtocolError(`${label}.values must be ordered by timeInMinutes`);
		}
		previousMinute = timeInMinutes;
		const time = requireString(entry.time, `${label}.values[${index}].time`);
		if (!DAYLIGHT_CLOCK_RE.test(time) || time !== formatDaylightMinute(timeInMinutes)) {
			throw new ProtocolError(`${label}.values[${index}].time must match timeInMinutes`);
		}
		return {
			timeInMinutes,
			time,
			brightness: requireInteger(entry.brightness, `${label}.values[${index}].brightness`, 0, 100),
		};
	});

	const valueCount = requireInteger(value.valueCount, `${label}.valueCount`, 0, 96);
	if (valueCount !== values.length) throw new ProtocolError(`${label}.valueCount must match values.length`);
	return {
		id: requireInteger(value.id, `${label}.id`, 0, 0xffffffff),
		name: requireString(value.name, `${label}.name`, true),
		valueCount,
		values,
	};
}

function parseDaylightCombinedStatus(value: unknown, label: string): DaylightCombinedStatus {
	if (!isRecord(value)) throw new ProtocolError(`${label} must be an object`);
	const lampTimeMs = requireInteger(value.lampTimeMs, `${label}.lampTimeMs`, 0, 0xffffffff);
	const lampClock = requireString(value.lampClock, `${label}.lampClock`);
	if (!DAYLIGHT_COMBINED_CLOCK_RE.test(lampClock) || lampClock !== formatMillisecondsAsClock(lampTimeMs)) {
		throw new ProtocolError(`${label}.lampClock must match lampTimeMs`);
	}
	const liveBrightnessRaw = requireInteger(value.liveBrightnessRaw, `${label}.liveBrightnessRaw`, 0, 0xffff);
	const liveBrightnessPercentEstimate = requireFiniteNumber(
		value.liveBrightnessPercentEstimate,
		`${label}.liveBrightnessPercentEstimate`,
		0,
		6553.5,
	);
	if (Math.abs(liveBrightnessPercentEstimate - liveBrightnessRaw / 10) > 0.000001) {
		throw new ProtocolError(`${label}.liveBrightnessPercentEstimate must equal liveBrightnessRaw / 10`);
	}
	return {
		lampTimeMs,
		lampClock,
		liveBrightnessRaw,
		liveBrightnessPercentEstimate,
		maxBrightness: requireInteger(value.maxBrightness, `${label}.maxBrightness`, 0, 100),
	};
}

export function parseDaylightData(value: unknown, label = 'daylight data'): DaylightData {
	if (!isRecord(value)) throw new ProtocolError(`${label} must be an object`);
	const requestOpcode = requireInteger(value.requestOpcode, `${label}.requestOpcode`);
	if (requestOpcode !== 3 && requestOpcode !== 14) {
		throw new ProtocolError(`${label}.requestOpcode must be 3 or 14`);
	}
	const expectedRequestHex = requestOpcode === 3 ? '0x03' : '0x0E';
	const requestOpcodeHex = requireString(value.requestOpcodeHex, `${label}.requestOpcodeHex`);
	if (requestOpcodeHex !== expectedRequestHex) {
		throw new ProtocolError(`${label}.requestOpcodeHex must match requestOpcode`);
	}
	const statusOpcode = requireInteger(value.statusOpcode, `${label}.statusOpcode`);
	const expectedStatusOpcode = requestOpcode === 3 ? 4 : 15;
	if (statusOpcode !== expectedStatusOpcode) {
		throw new ProtocolError(`${label}.statusOpcode does not match requestOpcode`);
	}
	const expectedStatusHex = statusOpcode === 4 ? '0x04' : '0x0F';
	const statusOpcodeHex = requireString(value.statusOpcodeHex, `${label}.statusOpcodeHex`);
	if (statusOpcodeHex !== expectedStatusHex) {
		throw new ProtocolError(`${label}.statusOpcodeHex must match statusOpcode`);
	}

	const parsed = requireBoolean(value.parsed, `${label}.parsed`);
	const configuration =
		value.configuration === undefined
			? undefined
			: parseDaylightConfiguration(value.configuration, `${label}.configuration`);
	if (parsed !== (configuration !== undefined)) {
		throw new ProtocolError(`${label}.parsed must be true exactly when configuration is present`);
	}
	const combinedStatus =
		value.combinedStatus === undefined
			? undefined
			: parseDaylightCombinedStatus(value.combinedStatus, `${label}.combinedStatus`);
	if (combinedStatus !== undefined && requestOpcode !== 14) {
		throw new ProtocolError(`${label}.combinedStatus requires request opcode 0x0E`);
	}

	return {
		requestOpcode,
		requestOpcodeHex: requestOpcodeHex as DaylightData['requestOpcodeHex'],
		statusOpcode,
		statusOpcodeHex: statusOpcodeHex as DaylightData['statusOpcodeHex'],
		rawPduHex: requireLowerHex(value.rawPduHex, `${label}.rawPduHex`),
		rawParametersHex: requireLowerHex(value.rawParametersHex, `${label}.rawParametersHex`, true),
		parsed,
		parserLayout:
			value.parserLayout === undefined ? undefined : requireString(value.parserLayout, `${label}.parserLayout`),
		parseError:
			value.parseError === undefined ? undefined : requireString(value.parseError, `${label}.parseError`, true),
		configuration,
		combinedStatus,
	};
}

function parseDaylightState(value: unknown): DaylightState {
	if (!isRecord(value)) throw new ProtocolError('daylightConfiguration must be an object');
	const verified = requireBoolean(value.verified, 'daylightConfiguration.verified');
	const lastReadOk = requireBoolean(value.lastReadOk, 'daylightConfiguration.lastReadOk');
	const dataFields = [
		'requestOpcode',
		'requestOpcodeHex',
		'statusOpcode',
		'statusOpcodeHex',
		'rawPduHex',
		'rawParametersHex',
		'parsed',
	] as const;
	const hasData = dataFields.some((name) => value[name] !== undefined);
	const data = hasData ? parseDaylightData(value, 'daylightConfiguration') : undefined;
	const verifiedAt =
		value.verifiedAt === undefined
			? undefined
			: requireTimestamp(value.verifiedAt, 'daylightConfiguration.verifiedAt');
	if (verified && (!data?.parsed || !data.configuration || verifiedAt === undefined)) {
		throw new ProtocolError('verified daylightConfiguration requires parsed configuration data and verifiedAt');
	}
	if (!verified && verifiedAt !== undefined) {
		throw new ProtocolError('daylightConfiguration.verifiedAt requires verified=true');
	}
	if (lastReadOk && !verified) {
		throw new ProtocolError('daylightConfiguration.lastReadOk=true requires verified=true');
	}

	return {
		verified,
		verifiedAt,
		lastReadAt: requireTimestamp(value.lastReadAt, 'daylightConfiguration.lastReadAt'),
		lastReadOk,
		lastError:
			value.lastError === undefined
				? undefined
				: requireString(value.lastError, 'daylightConfiguration.lastError', true),
		...(data ?? {}),
		lastObservation:
			value.lastObservation === undefined
				? undefined
				: parseDaylightData(value.lastObservation, 'daylightConfiguration.lastObservation'),
	};
}

function parseJsonObject(payload: Buffer | string, label: string): Record<string, unknown> {
	const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ProtocolError(`${label} is not valid JSON: ${(error as Error).message}`);
	}
	if (!isRecord(parsed)) {
		throw new ProtocolError(`${label} must be a JSON object`);
	}
	return parsed;
}

function requireProtocolVersion(document: Record<string, unknown>): 1 {
	if (document.protocolVersion !== PROTOCOL_VERSION) {
		throw new ProtocolError(`unsupported protocolVersion ${String(document.protocolVersion)}`);
	}
	return PROTOCOL_VERSION;
}

export function normalizeClockSeconds(value: unknown, label = 'secondsSinceMidnight'): number {
	return requireInteger(value, label, CLOCK_SECONDS_MIN, CLOCK_SECONDS_MAX);
}

export function formatClockSeconds(value: number): string {
	const secondsSinceMidnight = normalizeClockSeconds(value);
	const hours = Math.floor(secondsSinceMidnight / 3600);
	const minutes = Math.floor((secondsSinceMidnight % 3600) / 60);
	const seconds = secondsSinceMidnight % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseClockTarget(value: unknown): number {
	if (typeof value !== 'string') {
		throw new ProtocolError('clockTargetTime must be HH:MM or HH:MM:SS');
	}
	const match = CLOCK_TARGET_RE.exec(value.trim());
	if (!match) {
		throw new ProtocolError('clockTargetTime must be HH:MM or HH:MM:SS; 24:00 is not valid');
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = match[3] === undefined ? 0 : Number(match[3]);
	return hours * 3600 + minutes * 60 + seconds;
}

export function normalizeGatewayId(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (!GATEWAY_ID_RE.test(normalized)) {
		throw new ProtocolError('gatewayId must match [a-z0-9][a-z0-9_-]{0,47}');
	}
	return normalized;
}

export function normalizeTopicPrefix(value: string): string {
	const normalized = value.trim().replace(/^\/+|\/+$/g, '');
	if (!normalized || normalized.includes('+') || normalized.includes('#') || normalized.includes('//')) {
		throw new ProtocolError('topicPrefix must be a non-empty MQTT path without wildcards');
	}
	return normalized;
}

export function normalizeAddress(value: string): string {
	const normalized = value.trim().toUpperCase();
	if (!NODE_ADDRESS_RE.test(normalized)) {
		throw new ProtocolError('node address must contain exactly four hexadecimal digits');
	}
	const numeric = Number.parseInt(normalized, 16);
	if (numeric < 0x0001 || numeric > 0x7fff) {
		throw new ProtocolError('node address must be a Bluetooth Mesh unicast address');
	}
	return normalized;
}

function normalizeNodeTarget(value: string): string {
	return value === 'all' ? 'all' : normalizeAddress(value);
}

export function validateCommandId(value: string): string {
	if (!COMMAND_ID_RE.test(value)) {
		throw new ProtocolError("command id must contain 1..128 letters, digits, '.', '_', ':' or '-'");
	}
	return value;
}

export function normalizeTtl(value: number): number {
	return requireInteger(value, 'commandTtlSeconds', COMMAND_TTL_MIN, COMMAND_TTL_MAX);
}

export function createTopics(prefix: string, gatewayId: string): GatewayTopics {
	const root = `${normalizeTopicPrefix(prefix)}/${normalizeGatewayId(gatewayId)}`;
	return {
		root,
		availability: `${root}/availability`,
		gatewayInfo: `${root}/gateway/info`,
		nodeMeta: `${root}/nodes/+/meta`,
		nodeState: `${root}/nodes/+/state`,
		command: `${root}/command`,
		result: `${root}/result/+`,
	};
}

export function parseTopic(root: string, topic: string): ParsedTopic | undefined {
	if (!topic.startsWith(`${root}/`)) return undefined;
	const relative = topic.slice(root.length + 1);
	if (relative === 'availability') return { kind: 'availability' };
	if (relative === 'gateway/info') return { kind: 'gatewayInfo' };
	const nodeMatch = /^nodes\/([0-9A-Fa-f]{4})\/(meta|state)$/.exec(relative);
	if (nodeMatch?.[1] && nodeMatch[2]) {
		const address = normalizeAddress(nodeMatch[1]);
		return nodeMatch[2] === 'meta' ? { kind: 'nodeMeta', address } : { kind: 'nodeState', address };
	}
	const resultMatch = /^result\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(relative);
	if (resultMatch?.[1]) return { kind: 'result', commandId: resultMatch[1] };
	return undefined;
}

export function assertSafeRetainFlag(kind: ParsedTopic['kind'], retained: boolean): void {
	if (kind === 'result' && retained) {
		throw new ProtocolError('gateway result messages must not be retained');
	}
}

export function parseGatewayInfo(payload: Buffer | string, expectedGatewayId: string): GatewayInfo {
	const document = parseJsonObject(payload, 'gateway info');
	requireProtocolVersion(document);
	const gatewayId = normalizeGatewayId(requireString(document.gatewayId, 'gatewayId'));
	if (gatewayId !== normalizeGatewayId(expectedGatewayId)) {
		throw new ProtocolError(`gatewayId mismatch: expected ${expectedGatewayId}, received ${gatewayId}`);
	}
	if (!Array.isArray(document.nodes)) throw new ProtocolError('nodes must be an array');
	const seen = new Set<string>();
	const nodes = document.nodes.map((entry, index): GatewayNode => {
		if (!isRecord(entry)) throw new ProtocolError(`nodes[${index}] must be an object`);
		const address = normalizeAddress(requireString(entry.address, `nodes[${index}].address`));
		if (seen.has(address)) throw new ProtocolError(`duplicate node address ${address}`);
		seen.add(address);
		return {
			address,
			name: requireString(entry.name, `nodes[${index}].name`, true),
		};
	});
	const sequenceStatus = document.sequenceStatus;
	if (sequenceStatus !== undefined && !['ok', 'warning', 'critical'].includes(String(sequenceStatus))) {
		throw new ProtocolError('sequenceStatus must be ok, warning or critical');
	}
	const writePolicy = document.writePolicy;
	if (writePolicy !== undefined && !isRecord(writePolicy)) throw new ProtocolError('writePolicy must be an object');
	const localClockSeconds = normalizeClockSeconds(document.localClockSeconds, 'localClockSeconds');
	const localClock = requireString(document.localClock, 'localClock');
	if (!LAMP_CLOCK_RE.test(localClock) || localClock !== formatClockSeconds(localClockSeconds)) {
		throw new ProtocolError('localClock must match localClockSeconds as HH:MM:SS');
	}
	return {
		protocolVersion: PROTOCOL_VERSION,
		serviceVersion: requireString(document.serviceVersion, 'serviceVersion'),
		gatewayId,
		meshUuid: requireString(document.meshUuid, 'meshUuid'),
		senderAddress: normalizeAddress(requireString(document.senderAddress, 'senderAddress')),
		nodes,
		commandTopic:
			document.commandTopic === undefined ? undefined : requireString(document.commandTopic, 'commandTopic'),
		sequenceNumber: optionalInteger(document.sequenceNumber, 'sequenceNumber', 0, 0xffffff),
		sequenceRemaining: optionalInteger(document.sequenceRemaining, 'sequenceRemaining', 0, 0xffffff),
		sequenceRemainingPercent:
			document.sequenceRemainingPercent === undefined
				? undefined
				: requireFiniteNumber(document.sequenceRemainingPercent, 'sequenceRemainingPercent', 0, 100),
		sequenceStatus: sequenceStatus as GatewayInfo['sequenceStatus'],
		sequenceWarning:
			document.sequenceWarning === undefined
				? undefined
				: requireString(document.sequenceWarning, 'sequenceWarning', true),
		localClockSeconds,
		localClock,
		timestamp: requireTimestamp(document.timestamp, 'timestamp'),
		writePolicy: writePolicy as Record<string, unknown> | undefined,
	};
}

export function parseNodeMeta(payload: Buffer | string, expectedAddress: string): NodeMeta {
	const document = parseJsonObject(payload, 'node metadata');
	requireProtocolVersion(document);
	const address = normalizeAddress(requireString(document.address, 'address'));
	if (address !== normalizeAddress(expectedAddress)) {
		throw new ProtocolError(`node metadata address mismatch: topic ${expectedAddress}, payload ${address}`);
	}
	let writable: NodeMeta['writable'];
	if (document.writable !== undefined) {
		if (!isRecord(document.writable)) throw new ProtocolError('writable must be an object');
		const max = document.writable.maxBrightness;
		if (max !== undefined) {
			if (!isRecord(max)) throw new ProtocolError('writable.maxBrightness must be an object');
			writable = {
				maxBrightness: {
					minimum: optionalInteger(max.minimum, 'writable.maxBrightness.minimum', 0, 100),
					maximum: optionalInteger(max.maximum, 'writable.maxBrightness.maximum', 0, 100),
				},
			};
		}
	}
	let readable: NodeMeta['readable'];
	if (document.readable !== undefined) {
		if (!isRecord(document.readable)) throw new ProtocolError('readable must be an object');
		readable = {
			daylightConfiguration:
				document.readable.daylightConfiguration === undefined
					? undefined
					: requireBoolean(document.readable.daylightConfiguration, 'readable.daylightConfiguration'),
		};
	}
	return {
		protocolVersion: PROTOCOL_VERSION,
		address,
		name: requireString(document.name, 'name', true),
		writable,
		readable,
		supportsExplicitBlackout: requireBoolean(document.supportsExplicitBlackout, 'supportsExplicitBlackout'),
	};
}

export function parseNodeState(payload: Buffer | string, expectedAddress: string): NodeState {
	const document = parseJsonObject(payload, 'node state');
	requireProtocolVersion(document);
	const address = normalizeAddress(requireString(document.address, 'address'));
	if (address !== normalizeAddress(expectedAddress)) {
		throw new ProtocolError(`node state address mismatch: topic ${expectedAddress}, payload ${address}`);
	}
	if (document.verified !== true) throw new ProtocolError('node state must be verified=true');
	const maxBrightness = requireInteger(document.maxBrightness, 'maxBrightness', 0, 100);
	const off = requireBoolean(document.off, 'off');
	if (off !== (maxBrightness === 0)) throw new ProtocolError('off must be true exactly when maxBrightness is 0');
	const liveVerified =
		document.liveVerified === undefined ? false : requireBoolean(document.liveVerified, 'liveVerified');
	const liveFieldNames = [
		'lampClockSeconds',
		'lampClock',
		'liveBrightnessRaw',
		'liveBrightnessPercentEstimate',
		'liveVerifiedAt',
	] as const;
	const hasAnyLiveField = liveFieldNames.some((name) => document[name] !== undefined);
	let lampClockSeconds: number | undefined;
	let lampClock: string | undefined;
	let liveBrightnessRaw: number | undefined;
	let liveBrightnessPercentEstimate: number | undefined;
	let liveVerifiedAt: string | undefined;
	if (liveVerified) {
		lampClockSeconds = normalizeClockSeconds(document.lampClockSeconds, 'lampClockSeconds');
		lampClock = requireString(document.lampClock, 'lampClock');
		if (!LAMP_CLOCK_RE.test(lampClock) || lampClock !== formatClockSeconds(lampClockSeconds)) {
			throw new ProtocolError('lampClock must match lampClockSeconds as HH:MM:SS');
		}
		liveBrightnessRaw = requireInteger(document.liveBrightnessRaw, 'liveBrightnessRaw', 0, 0xffff);
		liveBrightnessPercentEstimate = requireFiniteNumber(
			document.liveBrightnessPercentEstimate,
			'liveBrightnessPercentEstimate',
			0,
			6553.5,
		);
		if (Math.abs(liveBrightnessPercentEstimate - liveBrightnessRaw / 10) > 0.000001) {
			throw new ProtocolError('liveBrightnessPercentEstimate must equal liveBrightnessRaw / 10');
		}
		liveVerifiedAt = requireTimestamp(document.liveVerifiedAt, 'liveVerifiedAt');
	} else if (hasAnyLiveField) {
		throw new ProtocolError('live lamp fields require liveVerified=true');
	}
	return {
		protocolVersion: PROTOCOL_VERSION,
		address,
		name: requireString(document.name, 'name', true),
		maxBrightness,
		off,
		verified: true,
		verifiedAt: requireTimestamp(document.verifiedAt, 'verifiedAt'),
		cached: document.cached === undefined ? undefined : requireBoolean(document.cached, 'cached'),
		liveVerified,
		lampClockSeconds,
		lampClock,
		liveBrightnessRaw,
		liveBrightnessPercentEstimate,
		liveVerifiedAt,
		daylightConfiguration:
			document.daylightConfiguration === undefined
				? undefined
				: parseDaylightState(document.daylightConfiguration),
	};
}

export function parseGatewayResult(payload: Buffer | string, expectedCommandId: string): GatewayResult {
	const document = parseJsonObject(payload, 'gateway result');
	requireProtocolVersion(document);
	const id = validateCommandId(requireString(document.id, 'id'));
	if (id !== validateCommandId(expectedCommandId)) {
		throw new ProtocolError(`result id mismatch: topic ${expectedCommandId}, payload ${id}`);
	}
	let action: GatewayAction | undefined;
	if (document.action !== undefined) {
		const value = requireString(document.action, 'action');
		if (
			![
				'refresh',
				'read-daylight',
				'set-max',
				'blackout',
				'restore-blackout',
				'sync-clock',
				'set-clock',
				'refresh-gateway-info',
			].includes(value)
		) {
			throw new ProtocolError(`unsupported result action ${value}`);
		}
		action = value as GatewayAction;
	}
	if (document.details !== undefined && !isRecord(document.details)) {
		throw new ProtocolError('details must be an object');
	}
	return {
		protocolVersion: PROTOCOL_VERSION,
		id,
		ok: requireBoolean(document.ok, 'ok'),
		status: requireString(document.status, 'status'),
		message: requireString(document.message, 'message', true),
		action,
		target: document.target === undefined ? undefined : requireString(document.target, 'target'),
		requested: optionalInteger(document.requested, 'requested'),
		requestedSecondsSinceMidnight: optionalInteger(
			document.requestedSecondsSinceMidnight,
			'requestedSecondsSinceMidnight',
			CLOCK_SECONDS_MIN,
			CLOCK_SECONDS_MAX,
		),
		details: document.details as Record<string, unknown> | undefined,
		timestamp: requireTimestamp(document.timestamp, 'timestamp'),
	};
}

type CommonCommandFields = Pick<RefreshCommand, 'id' | 'createdAt' | 'ttlSeconds'>;

function commonCommand(id: string, ttlSeconds: number, now: Date): CommonCommandFields {
	if (Number.isNaN(now.getTime())) throw new ProtocolError('command date is invalid');
	return {
		id: validateCommandId(id),
		createdAt: now.toISOString(),
		ttlSeconds: normalizeTtl(ttlSeconds),
	};
}

export function createRefreshCommand(id: string, target: string, ttlSeconds: number, now = new Date()): RefreshCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'refresh',
		target: normalizeNodeTarget(target),
	};
}

export function createReadDaylightCommand(
	id: string,
	target: string,
	ttlSeconds: number,
	now = new Date(),
): ReadDaylightCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'read-daylight',
		target: normalizeNodeTarget(target),
	};
}

export function createSetMaxCommand(
	id: string,
	target: string,
	value: number,
	ttlSeconds: number,
	now = new Date(),
): SetMaxCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'set-max',
		target: normalizeAddress(target),
		value: requireInteger(value, 'value', SET_MAX_MIN, SET_MAX_MAX),
	};
}

export function createBlackoutCommand(
	id: string,
	target: string,
	ttlSeconds: number,
	now = new Date(),
): BlackoutCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'blackout',
		target: normalizeNodeTarget(target),
		confirmed: true,
	};
}

export function createRestoreBlackoutCommand(id: string, ttlSeconds: number, now = new Date()): RestoreBlackoutCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'restore-blackout',
		target: 'latest',
		confirmed: true,
	};
}

export function createSyncClockCommand(
	id: string,
	target: string,
	ttlSeconds: number,
	now = new Date(),
): SyncClockCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'sync-clock',
		target: normalizeNodeTarget(target),
	};
}

export function createSetClockCommand(
	id: string,
	target: string,
	secondsSinceMidnight: number,
	ttlSeconds: number,
	now = new Date(),
): SetClockCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'set-clock',
		target: normalizeNodeTarget(target),
		secondsSinceMidnight: normalizeClockSeconds(secondsSinceMidnight),
	};
}

export function createRefreshGatewayInfoCommand(
	id: string,
	ttlSeconds: number,
	now = new Date(),
): RefreshGatewayInfoCommand {
	return {
		...commonCommand(id, ttlSeconds, now),
		action: 'refresh-gateway-info',
		target: 'gateway',
	};
}
