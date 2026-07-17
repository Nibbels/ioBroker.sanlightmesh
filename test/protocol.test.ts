import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ProtocolError,
	assertSafeRetainFlag,
	createBlackoutCommand,
	createRefreshCommand,
	createRestoreBlackoutCommand,
	createSetMaxCommand,
	createTopics,
	normalizeAddress,
	normalizeGatewayId,
	normalizeTopicPrefix,
	normalizeTtl,
	parseGatewayInfo,
	parseGatewayResult,
	parseNodeMeta,
	parseNodeState,
	parseTopic,
} from '../src/lib/protocol';

const now = new Date('2026-07-15T15:30:00Z');

test('creates exact per-gateway topics without a broad wildcard', () => {
	const topics = createTopics('sanlightmesh/v1', 'room-a');
	assert.equal(topics.root, 'sanlightmesh/v1/room-a');
	assert.equal(topics.nodeState, 'sanlightmesh/v1/room-a/nodes/+/state');
	assert.equal(topics.result, 'sanlightmesh/v1/room-a/result/+');
	assert.ok(!Object.values(topics).includes('sanlightmesh/v1/#'));
});

test('parses only supported topics beneath the configured gateway root', () => {
	const root = 'sanlightmesh/v1/room-a';
	assert.deepEqual(parseTopic(root, `${root}/nodes/0003/state`), { kind: 'nodeState', address: '0003' });
	assert.equal(parseTopic(root, 'sanlightmesh/v1/room-b/nodes/0003/state'), undefined);
	assert.equal(parseTopic(root, `${root}/nodes/0003/private`), undefined);
});

test('rejects invalid gateway roots, addresses and command lifetimes', () => {
	assert.equal(normalizeGatewayId(' Room-A '), 'room-a');
	assert.equal(normalizeTopicPrefix('/sanlightmesh/v1/'), 'sanlightmesh/v1');
	assert.equal(normalizeAddress('00a3'), '00A3');
	assert.equal(normalizeTtl(30), 30);
	assert.throws(() => normalizeGatewayId('room/a'), ProtocolError);
	assert.throws(() => normalizeTopicPrefix('sanlightmesh/+/v1'), ProtocolError);
	assert.throws(() => normalizeAddress('8000'), ProtocolError);
	assert.throws(() => normalizeTtl(0), ProtocolError);
});

test('creates safe commands and keeps blackout explicit', () => {
	assert.deepEqual(createRefreshCommand('refresh-1', 'all', 30, now), {
		id: 'refresh-1',
		action: 'refresh',
		target: 'all',
		createdAt: now.toISOString(),
		ttlSeconds: 30,
	});
	assert.deepEqual(createSetMaxCommand('set-1', '0003', 68, 30, now), {
		id: 'set-1',
		action: 'set-max',
		target: '0003',
		value: 68,
		createdAt: now.toISOString(),
		ttlSeconds: 30,
	});
	assert.equal(createBlackoutCommand('blackout-1', '0003', 30, now).confirmed, true);
	assert.equal(createRestoreBlackoutCommand('restore-1', 30, now).target, 'latest');
	assert.throws(() => createSetMaxCommand('set-zero', '0003', 0, 30, now), ProtocolError);
});

test('validates gateway identity and topology', () => {
	const info = parseGatewayInfo(
		JSON.stringify({
			protocolVersion: 1,
			serviceVersion: '0.1.1',
			gatewayId: 'room-a',
			meshUuid: 'mesh-id',
			senderAddress: '2800',
			nodes: [
				{ address: '0002', name: 'Left' },
				{ address: '0003', name: 'Right' },
			],
			sequenceNumber: 1048672,
			sequenceRemaining: 15728543,
			sequenceRemainingPercent: 93.75,
			sequenceStatus: 'ok',
			writePolicy: {},
			timestamp: '2026-07-15T15:44:53Z',
		}),
		'room-a',
	);
	assert.equal(info.nodes.length, 2);
	assert.throws(() => parseGatewayInfo(JSON.stringify({ ...info, gatewayId: 'room-b' }), 'room-a'), /mismatch/);
	assert.throws(
		() => parseGatewayInfo(JSON.stringify({ ...info, nodes: [info.nodes[0], info.nodes[0]] }), 'room-a'),
		/duplicate node address/,
	);
});

test('rejects payload addresses that do not match their MQTT topic', () => {
	const meta = {
		protocolVersion: 1,
		address: '0003',
		name: 'Right',
		writable: { maxBrightness: { minimum: 20, maximum: 100 } },
		supportsExplicitBlackout: true,
	};
	assert.equal(parseNodeMeta(JSON.stringify(meta), '0003').name, 'Right');
	assert.throws(() => parseNodeMeta(JSON.stringify(meta), '0002'), /mismatch/);
	const state = {
		protocolVersion: 1,
		address: '0003',
		name: 'Right',
		maxBrightness: 68,
		off: false,
		verified: true,
		verifiedAt: '2026-07-15T15:44:52Z',
	};
	assert.equal(parseNodeState(JSON.stringify(state), '0003').maxBrightness, 68);
	assert.equal(parseNodeState(JSON.stringify(state), '0003').liveVerified, false);
	assert.throws(() => parseNodeState(JSON.stringify({ ...state, off: true }), '0003'), /off must be true/);
});

test('parses verified live lamp brightness separately from MaxBrightness', () => {
	const state = parseNodeState(
		JSON.stringify({
			protocolVersion: 1,
			address: '0003',
			name: 'Right',
			maxBrightness: 68,
			off: false,
			verified: true,
			verifiedAt: '2026-07-16T20:00:00Z',
			liveVerified: true,
			lampTimeMs: 61265168,
			lampClock: '17:01:05.168',
			liveBrightnessRaw: 461,
			liveBrightnessPercentEstimate: 46.1,
			liveVerifiedAt: '2026-07-16T20:00:01Z',
		}),
		'0003',
	);
	assert.equal(state.maxBrightness, 68);
	assert.equal(state.liveBrightnessRaw, 461);
	assert.equal(state.liveBrightnessPercentEstimate, 46.1);
	assert.equal(state.lampClock, '17:01:05.168');
});

test('rejects inconsistent or incomplete live brightness state', () => {
	const base = {
		protocolVersion: 1,
		address: '0003',
		name: 'Right',
		maxBrightness: 68,
		off: false,
		verified: true,
		verifiedAt: '2026-07-16T20:00:00Z',
		liveVerified: true,
		lampTimeMs: 61265168,
		lampClock: '17:01:05.168',
		liveBrightnessRaw: 461,
		liveBrightnessPercentEstimate: 46.1,
		liveVerifiedAt: '2026-07-16T20:00:01Z',
	};
	assert.throws(
		() => parseNodeState(JSON.stringify({ ...base, lampClock: '17:01:05.169' }), '0003'),
		/lampClock must match/,
	);
	assert.throws(
		() => parseNodeState(JSON.stringify({ ...base, liveBrightnessPercentEstimate: 46.2 }), '0003'),
		/must equal liveBrightnessRaw \/ 10/,
	);
	assert.throws(
		() => parseNodeState(JSON.stringify({ ...base, liveVerified: false }), '0003'),
		/live brightness fields require/,
	);
});

test('requires result topic and payload command IDs to match', () => {
	const result = {
		protocolVersion: 1,
		id: 'set-1',
		ok: true,
		status: 'verified',
		message: 'ok',
		action: 'set-max',
		target: '0003',
		requested: 68,
		details: { reported: { '0003': 68 } },
		timestamp: '2026-07-15T15:44:52Z',
	};
	assert.equal(parseGatewayResult(JSON.stringify(result), 'set-1').status, 'verified');
	assert.throws(() => parseGatewayResult(JSON.stringify(result), 'set-2'), /mismatch/);
});

test('rejects retained result publications while allowing retained state', () => {
	assert.doesNotThrow(() => assertSafeRetainFlag('nodeState', true));
	assert.doesNotThrow(() => assertSafeRetainFlag('gatewayInfo', true));
	assert.throws(() => assertSafeRetainFlag('result', true), /must not be retained/);
	assert.doesNotThrow(() => assertSafeRetainFlag('result', false));
});
