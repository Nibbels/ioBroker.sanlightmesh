import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ProtocolError,
	createRefreshGatewayInfoCommand,
	createSetClockCommand,
	createSyncClockCommand,
	formatClockSeconds,
	parseClockTarget,
	parseGatewayInfo,
	parseNodeState,
} from '../src/lib/protocol';

const now = new Date('2026-07-17T18:30:00.000Z');

test('clock text accepts HH:MM and HH:MM:SS', () => {
	assert.equal(parseClockTarget('06:30'), 23_400);
	assert.equal(parseClockTarget('23:59:59'), 86_399);
	assert.equal(formatClockSeconds(23_400), '06:30:00');
	assert.throws(() => parseClockTarget('24:00'), ProtocolError);
	assert.throws(() => parseClockTarget('6:30'), ProtocolError);
});

test('set-clock transports strict integer seconds', () => {
	assert.deepEqual(createSetClockCommand('set-1', '0003', 21_600, 30, now), {
		id: 'set-1',
		action: 'set-clock',
		target: '0003',
		secondsSinceMidnight: 21_600,
		createdAt: now.toISOString(),
		ttlSeconds: 30,
	});
	assert.throws(() => createSetClockCommand('set-2', '0003', 21_600.5, 30, now), ProtocolError);
	assert.throws(() => createSetClockCommand('set-3', '0003', 86_400, 30, now), ProtocolError);
});

test('sync and gateway-info refresh have no clock payload', () => {
	assert.deepEqual(createSyncClockCommand('sync-1', 'all', 30, now), {
		id: 'sync-1',
		action: 'sync-clock',
		target: 'all',
		createdAt: now.toISOString(),
		ttlSeconds: 30,
	});
	assert.deepEqual(createRefreshGatewayInfoCommand('info-1', 30, now), {
		id: 'info-1',
		action: 'refresh-gateway-info',
		target: 'gateway',
		createdAt: now.toISOString(),
		ttlSeconds: 30,
	});
});

test('gateway info validates its local clock snapshot', () => {
	const payload = JSON.stringify({
		protocolVersion: 1,
		serviceVersion: '0.3.0',
		gatewayId: 'sanlight-pi',
		meshUuid: 'b7aec9a0-ecf8-4c89-8cc6-420368cd1f70',
		senderAddress: '2800',
		nodes: [],
		localClockSeconds: 66_615,
		localClock: '18:30:15',
		timestamp: '2026-07-17T18:30:15+02:00',
	});
	assert.equal(parseGatewayInfo(payload, 'sanlight-pi').localClock, '18:30:15');
	assert.throws(() => parseGatewayInfo(payload.replace('18:30:15', '18:30:16'), 'sanlight-pi'), ProtocolError);
});

test('node state requires whole-second lamp clock fields', () => {
	const document = {
		protocolVersion: 1,
		address: '0003',
		name: 'Lamp',
		maxBrightness: 80,
		off: false,
		verified: true,
		verifiedAt: '2026-07-17T16:30:15Z',
		liveVerified: true,
		lampClockSeconds: 66_615,
		lampClock: '18:30:15',
		liveBrightnessRaw: 334,
		liveBrightnessPercentEstimate: 33.4,
		liveVerifiedAt: '2026-07-17T16:30:15Z',
	};
	assert.equal(parseNodeState(JSON.stringify(document), '0003').lampClockSeconds, 66_615);
	const legacy = { ...document, lampTimeMs: 66_615_000 } as Record<string, unknown>;
	delete legacy.lampClockSeconds;
	assert.throws(() => parseNodeState(JSON.stringify(legacy), '0003'), ProtocolError);
});
