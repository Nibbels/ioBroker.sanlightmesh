/**
 * Native ioBroker adapter for the SANlight Mesh MQTT Gateway.
 * One adapter instance intentionally manages exactly one configured gateway.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as utils from '@iobroker/adapter-core';
import mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';

import {
	CLOCK_SECONDS_MAX,
	CLOCK_SECONDS_MIN,
	PROTOCOL_VERSION,
	assertSafeRetainFlag,
	ProtocolError,
	createBlackoutCommand,
	createReadDaylightCommand,
	createRefreshCommand,
	createRefreshGatewayInfoCommand,
	createRestoreBlackoutCommand,
	createSetClockCommand,
	createSetMaxCommand,
	createSyncClockCommand,
	createTopics,
	formatClockSeconds,
	normalizeAddress,
	normalizeClockSeconds,
	normalizeGatewayId,
	normalizeTopicPrefix,
	normalizeTtl,
	parseClockTarget,
	parseDaylightData,
	parseGatewayInfo,
	parseGatewayResult,
	parseNodeMeta,
	parseNodeState,
	parseTopic,
} from './lib/protocol';
import type {
	DaylightData,
	DaylightState,
	GatewayAction,
	GatewayCommand,
	GatewayInfo,
	GatewayResult,
	GatewayTopics,
	NodeMeta,
	NodeState,
} from './lib/protocol';
import { analyzeDaylightConfiguration, buildDaylightFleetSummary } from './lib/daylight';
import type { DaylightFleetEntry } from './lib/daylight';

interface PendingCommand {
	id: string;
	action: GatewayAction;
	target: string;
	statusBase: string;
	timeout: NodeJS.Timeout;
}

interface BrightnessRequest {
	value: number;
}

const MAX_PENDING_COMMANDS = 128;
const MQTT_SUBSCRIPTION_RETRY_MS = 5000;

class Sanlightmesh extends utils.Adapter {
	private client: MqttClient | undefined;
	private topics: GatewayTopics | undefined;
	private gatewayId = '';
	private mqttConnected = false;
	private gatewayOnline = false;
	private protocolCompatible = false;
	private shuttingDown = false;
	private readonly knownNodes = new Set<string>();
	private readonly presentNodes = new Set<string>();
	private readonly daylightByNode = new Map<string, DaylightFleetEntry>();
	private readonly pendingCommands = new Map<string, PendingCommand>();
	private readonly brightnessTimers = new Map<string, NodeJS.Timeout>();
	private readonly brightnessRequests = new Map<string, BrightnessRequest>();
	private subscriptionRetryTimer: NodeJS.Timeout | undefined;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({ ...options, name: 'sanlightmesh' });
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		await this.initializeBaseObjects();
		await this.resetRuntimeStates();
		try {
			this.gatewayId = normalizeGatewayId(this.config.gatewayId);
			const topicPrefix = normalizeTopicPrefix(this.config.topicPrefix || 'sanlightmesh/v1');
			this.topics = createTopics(topicPrefix, this.gatewayId);
			normalizeTtl(Number(this.config.commandTtlSeconds));
			if (!this.config.mqttHost?.trim()) throw new ProtocolError('MQTT broker host is required');
			const port = Number(this.config.mqttPort);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				throw new ProtocolError('MQTT broker port must be an integer from 1 to 65535');
			}
		} catch (error) {
			const message = `Configuration error: ${(error as Error).message}`;
			await this.setLastError(message);
			this.log.error(message);
			return;
		}

		await this.loadKnownLampObjects();
		this.subscribeStates('gateway.control.*');
		this.subscribeStates('lamps.*.control.*');
		this.connectMqtt();
	}

	private async initializeBaseObjects(): Promise<void> {
		await this.ensureObject('gateway', {
			type: 'device',
			common: {
				name: { en: 'SANlight Mesh gateway', de: 'SANlight Mesh Gateway' },
			},
			native: {},
		});
		await this.ensureObject('gateway.info', {
			type: 'channel',
			common: {
				name: { en: 'Gateway information', de: 'Gateway-Informationen' },
			},
			native: {},
		});
		await this.ensureObject('gateway.control', {
			type: 'channel',
			common: { name: { en: 'Gateway controls', de: 'Gateway-Steuerung' } },
			native: {},
		});
		await this.ensureObject('gateway.daylight', {
			type: 'channel',
			common: { name: { en: 'Daylight schedule overview', de: 'Tageslichtplan-Übersicht' } },
			native: {},
		});
		await this.ensureObject('lamps', {
			type: 'folder',
			common: { name: { en: 'Lamps', de: 'Lampen' } },
			native: {},
		});
		await this.ensureObject('commands', {
			type: 'channel',
			common: { name: { en: 'Last command', de: 'Letzter Befehl' } },
			native: {},
		});

		const states: Array<[string, ioBroker.StateObject['common']]> = [
			['gateway.info.id', this.stateCommon('Gateway ID', 'Gateway-ID', 'string', 'text', false, '')],
			[
				'gateway.info.protocolVersion',
				this.stateCommon('Protocol version', 'Protokollversion', 'number', 'value', false, 0),
			],
			[
				'gateway.info.serviceVersion',
				this.stateCommon('Gateway service version', 'Gateway-Service-Version', 'string', 'text', false, ''),
			],
			['gateway.info.meshUuid', this.stateCommon('Mesh UUID', 'Mesh-UUID', 'string', 'text', false, '')],
			[
				'gateway.info.senderAddress',
				this.stateCommon('Sender address', 'Sender-Adresse', 'string', 'text', false, ''),
			],
			[
				'gateway.info.sequenceNumber',
				this.stateCommon('Sequence number', 'Sequence Number', 'number', 'value', false, 0),
			],
			[
				'gateway.info.sequenceRemaining',
				this.stateCommon(
					'Sequence numbers remaining',
					'Verbleibende Sequence Numbers',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'gateway.info.sequenceRemainingPercent',
				this.stateCommon(
					'Sequence budget remaining',
					'Verbleibendes Sequence-Budget',
					'number',
					'value',
					false,
					0,
					'%',
				),
			],
			[
				'gateway.info.sequenceStatus',
				this.stateCommon('Sequence status', 'Sequence-Status', 'string', 'text', false, ''),
			],
			[
				'gateway.info.sequenceWarning',
				this.stateCommon('Sequence warning', 'Sequence-Warnung', 'string', 'text', false, ''),
			],
			[
				'gateway.info.localClockSeconds',
				{
					...this.stateCommon(
						'Gateway local clock in seconds since midnight',
						'Lokale Gateway-Uhr in Sekunden seit Mitternacht',
						'number',
						'value',
						false,
						0,
						's',
					),
					min: CLOCK_SECONDS_MIN,
					max: CLOCK_SECONDS_MAX,
					step: 1,
				},
			],
			[
				'gateway.info.localClock',
				this.stateCommon('Gateway local clock', 'Lokale Gateway-Uhr', 'string', 'text', false, ''),
			],
			[
				'gateway.info.lastSeen',
				this.stateCommon(
					'Gateway info timestamp',
					'Zeitstempel der Gateway-Information',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'gateway.control.refreshAll',
				this.stateCommon('Refresh all lamps', 'Alle Lampen aktualisieren', 'boolean', 'button', true, false),
			],
			[
				'gateway.control.readAllDaylight',
				this.stateCommon(
					'Read daylight schedules from all lamps',
					'Tageslichtpläne aller Lampen lesen',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'gateway.control.refreshInfo',
				this.stateCommon(
					'Refresh gateway information',
					'Gateway-Informationen aktualisieren',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'gateway.control.syncAllClocksNow',
				this.stateCommon(
					'Synchronize all lamp clocks now',
					'Alle Lampenuhren jetzt synchronisieren',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'gateway.control.clockTargetSeconds',
				{
					...this.stateCommon(
						'Clock target in seconds since midnight',
						'Ziel-Uhrzeit in Sekunden seit Mitternacht',
						'number',
						'level',
						true,
						0,
						's',
					),
					min: CLOCK_SECONDS_MIN,
					max: CLOCK_SECONDS_MAX,
					step: 1,
				},
			],
			[
				'gateway.control.clockTargetTime',
				this.stateCommon(
					'Clock target (HH:MM or HH:MM:SS)',
					'Ziel-Uhrzeit (HH:MM oder HH:MM:SS)',
					'string',
					'text',
					true,
					'00:00:00',
				),
			],
			[
				'gateway.control.applyClockTargetToAll',
				this.stateCommon(
					'Apply clock target to all lamps',
					'Ziel-Uhrzeit auf alle Lampen anwenden',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'gateway.control.blackoutAll',
				this.stateCommon('Blackout all lamps', 'Blackout für alle Lampen', 'boolean', 'button', true, false),
			],
			[
				'gateway.control.restoreLatestBlackout',
				this.stateCommon(
					'Restore latest blackout',
					'Letzten Blackout wiederherstellen',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'gateway.daylight.analysisVersion',
				this.stateCommon(
					'Daylight analysis version',
					'Version der Tageslicht-Auswertung',
					'number',
					'value',
					false,
					1,
				),
			],
			[
				'gateway.daylight.verifiedLampCount',
				this.stateCommon(
					'Verified daylight schedules',
					'Verifizierte Tageslichtpläne',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'gateway.daylight.distinctConfigurationCount',
				this.stateCommon(
					'Distinct daylight configurations',
					'Unterschiedliche Tageslichtkonfigurationen',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'gateway.daylight.distinctSchemaCount',
				this.stateCommon(
					'Distinct daylight schemas',
					'Unterschiedliche Lichtschemata',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'gateway.daylight.distinctScheduleCount',
				this.stateCommon(
					'Distinct daylight schedules',
					'Unterschiedliche Tageslichtpläne',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'gateway.daylight.conflict',
				this.stateCommon(
					'Daylight schedule conflict',
					'Konflikt zwischen Tageslichtplänen',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'gateway.daylight.configurationConflict',
				this.stateCommon(
					'Daylight configuration conflict',
					'Konflikt zwischen Tageslichtkonfigurationen',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'gateway.daylight.schemaConflict',
				this.stateCommon(
					'Daylight schema conflict',
					'Konflikt zwischen Lichtschemata',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'gateway.daylight.summary',
				this.stateCommon(
					'Daylight schedule summary',
					'Zusammenfassung der Tageslichtpläne',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'gateway.daylight.summaryJson',
				this.stateCommon(
					'Daylight schedule summary JSON',
					'Tageslichtplan-Zusammenfassung als JSON',
					'string',
					'json',
					false,
					'{}',
				),
			],
			[
				'gateway.daylight.lastEvaluatedAt',
				this.stateCommon(
					'Daylight summary timestamp',
					'Zeitstempel der Tageslichtplan-Auswertung',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'commands.pending',
				this.stateCommon('Command pending', 'Befehl ausstehend', 'boolean', 'indicator.working', false, false),
			],
			[
				'commands.lastCommandId',
				this.stateCommon('Last command ID', 'Letzte Befehls-ID', 'string', 'text', false, ''),
			],
			['commands.lastAction', this.stateCommon('Last action', 'Letzte Aktion', 'string', 'text', false, '')],
			['commands.lastTarget', this.stateCommon('Last target', 'Letztes Ziel', 'string', 'text', false, '')],
			['commands.lastStatus', this.stateCommon('Last status', 'Letzter Status', 'string', 'text', false, '')],
			['commands.lastMessage', this.stateCommon('Last message', 'Letzte Meldung', 'string', 'text', false, '')],
			[
				'commands.lastOk',
				this.stateCommon(
					'Last command successful',
					'Letzter Befehl erfolgreich',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'commands.lastResultAt',
				this.stateCommon(
					'Last result timestamp',
					'Zeitstempel des letzten Ergebnisses',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'commands.lastError',
				this.stateCommon('Last command error', 'Letzter Befehlsfehler', 'string', 'text', false, ''),
			],
		];
		for (const [id, common] of states) await this.ensureObject(id, { type: 'state', common, native: {} });
		await Promise.all([
			this.extendObjectAsync('gateway.info.localClockSeconds', { common: { role: 'value' } }),
			this.extendObjectAsync('gateway.control.clockTargetSeconds', { common: { role: 'level' } }),
		]);
		await this.initializeClockTargetPair('gateway.control');
		await this.updateFleetDaylightSummary();
	}

	private stateCommon(
		nameEn: string,
		nameDe: string,
		type: ioBroker.CommonType,
		role: string,
		write: boolean,
		def: ioBroker.StateValue,
		unit?: string,
	): ioBroker.StateObject['common'] {
		return {
			name: { en: nameEn, de: nameDe },
			type,
			role,
			read: true,
			write,
			def,
			...(unit ? { unit } : {}),
		};
	}

	private async ensureObject(id: string, object: ioBroker.SettableObject): Promise<void> {
		await this.setObjectNotExistsAsync(id, object);
	}

	private async resetRuntimeStates(): Promise<void> {
		await Promise.all([
			this.setStateAsync('info.connection', false, true),
			this.setStateAsync('info.mqttConnected', false, true),
			this.setStateAsync('info.gatewayOnline', false, true),
			this.setStateAsync('info.protocolCompatible', false, true),
			this.setStateAsync('info.lastError', '', true),
			this.setStateAsync('commands.pending', false, true),
		]);
	}

	private async loadKnownLampObjects(): Promise<void> {
		const objects = await this.getAdapterObjectsAsync();
		const prefix = `${this.namespace}.lamps.`;
		for (const [id, object] of Object.entries(objects)) {
			if (object.type !== 'device' || !id.startsWith(prefix)) continue;
			const relative = id.slice(prefix.length);
			if (relative.includes('.')) continue;
			try {
				const address = normalizeAddress(relative);
				this.knownNodes.add(address);
				await this.removeLegacyLampTimeMsObject(address);
			} catch {
				this.log.warn(`Ignoring invalid existing lamp object ${id}`);
			}
		}
	}

	private connectMqtt(): void {
		if (!this.topics) return;
		const protocol = this.config.mqttTls ? 'mqtts' : 'mqtt';
		const url = `${protocol}://${this.config.mqttHost.trim()}:${Number(this.config.mqttPort)}`;
		const options: IClientOptions = {
			protocolVersion: 5,
			clean: true,
			resubscribe: false,
			reconnectPeriod: 5000,
			connectTimeout: 10_000,
			keepalive: 60,
			clientId: `iobroker-sanlightmesh-${this.instance}-${randomUUID().slice(0, 8)}`,
			username: this.config.mqttUsername || undefined,
			password: this.config.mqttPassword || undefined,
			rejectUnauthorized: this.config.mqttRejectUnauthorized !== false,
		};
		if (this.config.mqttTls && this.config.mqttCaPath?.trim()) {
			try {
				options.ca = readFileSync(this.config.mqttCaPath.trim());
			} catch (error) {
				const message = `Cannot read MQTT CA file: ${(error as Error).message}`;
				void this.setLastError(message);
				this.log.error(message);
				return;
			}
		}

		this.log.info(
			`Connecting to MQTT broker ${this.config.mqttHost.trim()}:${Number(this.config.mqttPort)} for gateway ${this.gatewayId}`,
		);
		const client = mqtt.connect(url, options);
		this.client = client;
		client.on('connect', () => {
			this.clearSubscriptionRetry();
			void this.subscribeMqttTopics(client);
		});
		client.on('message', (topic, payload, packet) => void this.onMqttMessage(topic, payload, packet.retain));
		client.on('reconnect', () => this.log.debug('Reconnecting to MQTT broker'));
		client.on('offline', () => {
			this.clearSubscriptionRetry();
			void this.setMqttConnected(false);
		});
		client.on('close', () => {
			this.clearSubscriptionRetry();
			void this.setMqttConnected(false);
		});
		client.on('error', (error) => {
			void this.setLastError(`MQTT error: ${error.message}`);
			this.log.warn(`MQTT error: ${error.message}`);
		});
	}

	private async subscribeMqttTopics(client: MqttClient): Promise<void> {
		try {
			await this.onMqttConnect(client);
		} catch (error) {
			if (this.shuttingDown || this.client !== client || !client.connected) return;
			const message = `MQTT subscription error: ${(error as Error).message}`;
			await this.setMqttConnected(false);
			await this.setLastError(message);
			this.log.error(`${message}; retrying subscriptions in ${MQTT_SUBSCRIPTION_RETRY_MS / 1000} seconds`);
			this.scheduleSubscriptionRetry(client);
		}
	}

	private scheduleSubscriptionRetry(client: MqttClient): void {
		if (this.subscriptionRetryTimer || this.shuttingDown || this.client !== client || !client.connected) return;
		this.subscriptionRetryTimer = setTimeout(() => {
			this.subscriptionRetryTimer = undefined;
			if (this.shuttingDown || this.client !== client || !client.connected) return;
			void this.subscribeMqttTopics(client);
		}, MQTT_SUBSCRIPTION_RETRY_MS);
	}

	private clearSubscriptionRetry(): void {
		if (!this.subscriptionRetryTimer) return;
		clearTimeout(this.subscriptionRetryTimer);
		this.subscriptionRetryTimer = undefined;
	}

	private async onMqttConnect(client: MqttClient): Promise<void> {
		const topics = this.topics;
		if (!topics || this.shuttingDown || this.client !== client || !client.connected) return;
		for (const topic of [
			topics.availability,
			topics.gatewayInfo,
			topics.nodeMeta,
			topics.nodeState,
			topics.result,
		]) {
			if (this.shuttingDown || this.client !== client || !client.connected) return;
			await new Promise<void>((resolve, reject) => {
				client.subscribe(topic, { qos: 1, rap: true, rh: 0 }, (error, grants) => {
					if (error) return reject(error);
					const grant = grants?.find((entry) => entry.topic === topic);
					if (!grant || grant.qos === 128)
						return reject(new Error(`Broker rejected subscription to ${topic}`));
					resolve();
				});
			});
		}
		if (this.shuttingDown || this.client !== client || !client.connected) return;
		this.clearSubscriptionRetry();
		await this.setMqttConnected(true);
		await this.setLastError('');
		this.log.info(`Subscribed exclusively to gateway ${this.gatewayId} below ${topics.root}`);
	}

	private async onMqttMessage(topic: string, payload: Buffer, retained: boolean): Promise<void> {
		if (!this.topics) return;
		const parsedTopic = parseTopic(this.topics.root, topic);
		if (!parsedTopic) {
			this.log.warn(`Ignoring unexpected MQTT topic ${topic}`);
			return;
		}
		try {
			assertSafeRetainFlag(parsedTopic.kind, retained);
			switch (parsedTopic.kind) {
				case 'availability':
					await this.handleAvailability(payload);
					break;
				case 'gatewayInfo':
					await this.handleGatewayInfo(parseGatewayInfo(payload, this.gatewayId));
					break;
				case 'nodeMeta':
					await this.handleNodeMeta(parseNodeMeta(payload, parsedTopic.address));
					break;
				case 'nodeState':
					await this.handleNodeState(parseNodeState(payload, parsedTopic.address));
					break;
				case 'result':
					await this.handleResult(parseGatewayResult(payload, parsedTopic.commandId));
					break;
			}
		} catch (error) {
			const message = `Rejected MQTT message on ${topic}: ${(error as Error).message}`;
			await this.setLastError(message);
			this.log.warn(message);
		}
	}

	private async handleAvailability(payload: Buffer): Promise<void> {
		const value = payload.toString('utf8');
		if (value !== 'online' && value !== 'offline')
			throw new ProtocolError('availability must be online or offline');
		this.gatewayOnline = value === 'online';
		await this.setStateAsync('info.gatewayOnline', this.gatewayOnline, true);
		if (!this.gatewayOnline) await this.markAllLampsUnavailable();
		await this.updateConnectionState();
	}

	private async handleGatewayInfo(info: GatewayInfo): Promise<void> {
		this.protocolCompatible = info.protocolVersion === PROTOCOL_VERSION;
		await Promise.all([
			this.setStateAsync('info.protocolCompatible', this.protocolCompatible, true),
			this.setStateAsync('gateway.info.id', info.gatewayId, true),
			this.setStateAsync('gateway.info.protocolVersion', info.protocolVersion, true),
			this.setStateAsync('gateway.info.serviceVersion', info.serviceVersion, true),
			this.setStateAsync('gateway.info.meshUuid', info.meshUuid, true),
			this.setStateAsync('gateway.info.senderAddress', info.senderAddress, true),
			this.setStateAsync('gateway.info.sequenceNumber', info.sequenceNumber ?? 0, true),
			this.setStateAsync('gateway.info.sequenceRemaining', info.sequenceRemaining ?? 0, true),
			this.setStateAsync('gateway.info.sequenceRemainingPercent', info.sequenceRemainingPercent ?? 0, true),
			this.setStateAsync('gateway.info.sequenceStatus', info.sequenceStatus ?? '', true),
			this.setStateAsync('gateway.info.sequenceWarning', info.sequenceWarning ?? '', true),
			this.setStateAsync('gateway.info.localClockSeconds', info.localClockSeconds, true),
			this.setStateAsync('gateway.info.localClock', info.localClock, true),
			this.setStateAsync('gateway.info.lastSeen', info.timestamp, true),
		]);
		const present = new Set<string>();
		this.presentNodes.clear();
		for (const node of info.nodes) {
			present.add(node.address);
			this.presentNodes.add(node.address);
			await this.ensureLamp(node.address, node.name);
			await this.setStateAsync(`lamps.${node.address}.info.present`, true, true);
		}
		for (const address of this.knownNodes) {
			if (present.has(address)) continue;
			await this.setStateAsync(`lamps.${address}.info.present`, false, true);
			await this.setStateAsync(`lamps.${address}.state.available`, false, true);
			await this.setStateAsync(`lamps.${address}.state.liveVerified`, false, true);
		}
		await this.updateFleetDaylightSummary();
		await this.updateConnectionState();
	}

	private async handleNodeMeta(meta: NodeMeta): Promise<void> {
		await this.ensureLamp(meta.address, meta.name);
		await Promise.all([
			this.setStateAsync(`lamps.${meta.address}.info.address`, meta.address, true),
			this.setStateAsync(`lamps.${meta.address}.info.name`, meta.name, true),
			this.setStateAsync(`lamps.${meta.address}.info.present`, true, true),
			this.setStateAsync(
				`lamps.${meta.address}.info.supportsExplicitBlackout`,
				meta.supportsExplicitBlackout,
				true,
			),
			this.setStateAsync(
				`lamps.${meta.address}.info.minimumBrightness`,
				meta.writable?.maxBrightness?.minimum ?? 20,
				true,
			),
			this.setStateAsync(
				`lamps.${meta.address}.info.maximumBrightness`,
				meta.writable?.maxBrightness?.maximum ?? 100,
				true,
			),
			this.setStateAsync(
				`lamps.${meta.address}.info.supportsDaylightRead`,
				meta.readable?.daylightConfiguration ?? false,
				true,
			),
		]);
	}

	private async handleNodeState(state: NodeState): Promise<void> {
		await this.ensureLamp(state.address, state.name);
		const updates: Array<Promise<unknown>> = [
			this.setStateAsync(`lamps.${state.address}.state.maxBrightness`, state.maxBrightness, true),
			this.setStateAsync(`lamps.${state.address}.state.off`, state.off, true),
			this.setStateAsync(`lamps.${state.address}.state.verified`, true, true),
			this.setStateAsync(`lamps.${state.address}.state.verifiedAt`, state.verifiedAt, true),
			this.setStateAsync(`lamps.${state.address}.state.available`, true, true),
			this.setStateAsync(`lamps.${state.address}.state.cached`, state.cached ?? false, true),
			this.setStateAsync(`lamps.${state.address}.state.liveVerified`, state.liveVerified, true),
		];
		if (
			state.liveVerified &&
			state.lampClockSeconds !== undefined &&
			state.lampClock !== undefined &&
			state.liveBrightnessRaw !== undefined &&
			state.liveBrightnessPercentEstimate !== undefined &&
			state.liveVerifiedAt !== undefined
		) {
			updates.push(
				this.setStateAsync(`lamps.${state.address}.state.lampClockSeconds`, state.lampClockSeconds, true),
				this.setStateAsync(`lamps.${state.address}.state.lampClock`, state.lampClock, true),
				this.setStateAsync(
					`lamps.${state.address}.state.liveBrightnessPercentEstimate`,
					state.liveBrightnessPercentEstimate,
					true,
				),
				this.setStateAsync(`lamps.${state.address}.state.liveVerifiedAt`, state.liveVerifiedAt, true),
			);
		}
		await Promise.all(updates);
		await this.applyDaylightState(state.address, state.daylightConfiguration);
		const pendingForNode = [...this.pendingCommands.values()].some((command) => command.target === state.address);
		if (!pendingForNode && state.maxBrightness >= 20) {
			await this.setStateAsync(`lamps.${state.address}.control.maxBrightness`, state.maxBrightness, true);
		}
	}

	private async applyDaylightState(address: string, daylight: DaylightState | undefined): Promise<void> {
		const base = `lamps.${address}.daylight`;
		if (!daylight) {
			this.daylightByNode.delete(address);
			await Promise.all([
				this.setStateAsync(`${base}.verified`, false, true),
				this.setStateAsync(`${base}.verifiedAt`, '', true),
				this.setStateAsync(`${base}.lastReadAt`, '', true),
				this.setStateAsync(`${base}.lastReadOk`, false, true),
				this.setStateAsync(`${base}.lastError`, '', true),
				this.setStateAsync(`${base}.analysisVersion`, 1, true),
				this.setStateAsync(`${base}.analysisValid`, false, true),
				this.setStateAsync(`${base}.analysisError`, '', true),
				this.setStateAsync(`${base}.profileId`, 0, true),
				this.setStateAsync(`${base}.profileName`, '', true),
				this.setStateAsync(`${base}.valueCount`, 0, true),
				this.setStateAsync(`${base}.onHours`, 0, true),
				this.setStateAsync(`${base}.offHours`, 0, true),
				this.setStateAsync(`${base}.schema`, '', true),
				this.setStateAsync(`${base}.cycleType`, '', true),
				this.setStateAsync(`${base}.lightWindowCount`, 0, true),
				this.setStateAsync(`${base}.configurationFingerprint`, '', true),
				this.setStateAsync(`${base}.scheduleFingerprint`, '', true),
				this.setStateAsync(`${base}.configurationJson`, '{}', true),
				this.setStateAsync(`${base}.valuesJson`, '[]', true),
				this.setStateAsync(`${base}.parserLayout`, '', true),
				this.setStateAsync(`${base}.rawPduHex`, '', true),
				this.setStateAsync(`${base}.rawParametersHex`, '', true),
				this.setStateAsync(`${base}.gatewayJson`, '{}', true),
			]);
			await this.updateFleetDaylightSummary();
			return;
		}

		const commonUpdates: Array<Promise<unknown>> = [
			this.setStateAsync(`${base}.verified`, daylight.verified, true),
			this.setStateAsync(`${base}.verifiedAt`, daylight.verifiedAt ?? '', true),
			this.setStateAsync(`${base}.lastReadAt`, daylight.lastReadAt, true),
			this.setStateAsync(`${base}.lastReadOk`, daylight.lastReadOk, true),
			this.setStateAsync(`${base}.lastError`, daylight.lastError ?? '', true),
			this.setStateAsync(`${base}.parserLayout`, daylight.parserLayout ?? '', true),
			this.setStateAsync(`${base}.rawPduHex`, daylight.rawPduHex ?? '', true),
			this.setStateAsync(`${base}.rawParametersHex`, daylight.rawParametersHex ?? '', true),
			this.setStateAsync(`${base}.gatewayJson`, JSON.stringify(daylight), true),
		];

		if (daylight.verified && daylight.parsed && daylight.configuration && daylight.verifiedAt) {
			const configuration = daylight.configuration;
			commonUpdates.push(
				this.setStateAsync(`${base}.profileId`, configuration.id, true),
				this.setStateAsync(`${base}.profileName`, configuration.name, true),
				this.setStateAsync(`${base}.valueCount`, configuration.valueCount, true),
				this.setStateAsync(`${base}.configurationJson`, JSON.stringify(configuration), true),
				this.setStateAsync(`${base}.valuesJson`, JSON.stringify(configuration.values), true),
			);
			try {
				const analysis = analyzeDaylightConfiguration(configuration);
				this.daylightByNode.set(address, {
					address,
					profileId: configuration.id,
					profileName: configuration.name,
					verifiedAt: daylight.verifiedAt,
					lastReadOk: daylight.lastReadOk,
					analysis,
				});
				commonUpdates.push(
					this.setStateAsync(`${base}.analysisVersion`, analysis.analysisVersion, true),
					this.setStateAsync(`${base}.analysisValid`, true, true),
					this.setStateAsync(`${base}.analysisError`, '', true),
					this.setStateAsync(`${base}.onHours`, analysis.onHours, true),
					this.setStateAsync(`${base}.offHours`, analysis.offHours, true),
					this.setStateAsync(`${base}.schema`, analysis.schema, true),
					this.setStateAsync(`${base}.cycleType`, analysis.cycleType, true),
					this.setStateAsync(`${base}.lightWindowCount`, analysis.lightWindowCount, true),
					this.setStateAsync(`${base}.configurationFingerprint`, analysis.configurationFingerprint, true),
					this.setStateAsync(`${base}.scheduleFingerprint`, analysis.scheduleFingerprint, true),
				);
			} catch (error) {
				this.daylightByNode.delete(address);
				commonUpdates.push(
					this.setStateAsync(`${base}.analysisVersion`, 1, true),
					this.setStateAsync(`${base}.analysisValid`, false, true),
					this.setStateAsync(`${base}.analysisError`, (error as Error).message, true),
					this.setStateAsync(`${base}.onHours`, 0, true),
					this.setStateAsync(`${base}.offHours`, 0, true),
					this.setStateAsync(`${base}.schema`, '', true),
					this.setStateAsync(`${base}.cycleType`, '', true),
					this.setStateAsync(`${base}.lightWindowCount`, 0, true),
					this.setStateAsync(`${base}.configurationFingerprint`, '', true),
					this.setStateAsync(`${base}.scheduleFingerprint`, '', true),
				);
			}
		} else {
			this.daylightByNode.delete(address);
			commonUpdates.push(
				this.setStateAsync(`${base}.analysisVersion`, 1, true),
				this.setStateAsync(`${base}.analysisValid`, false, true),
				this.setStateAsync(`${base}.analysisError`, '', true),
				this.setStateAsync(`${base}.profileId`, 0, true),
				this.setStateAsync(`${base}.profileName`, '', true),
				this.setStateAsync(`${base}.valueCount`, 0, true),
				this.setStateAsync(`${base}.configurationJson`, '{}', true),
				this.setStateAsync(`${base}.valuesJson`, '[]', true),
				this.setStateAsync(`${base}.onHours`, 0, true),
				this.setStateAsync(`${base}.offHours`, 0, true),
				this.setStateAsync(`${base}.schema`, '', true),
				this.setStateAsync(`${base}.cycleType`, '', true),
				this.setStateAsync(`${base}.lightWindowCount`, 0, true),
				this.setStateAsync(`${base}.configurationFingerprint`, '', true),
				this.setStateAsync(`${base}.scheduleFingerprint`, '', true),
			);
		}

		await Promise.all(commonUpdates);
		await this.updateFleetDaylightSummary();
	}

	private async updateFleetDaylightSummary(): Promise<void> {
		const entries = [...this.daylightByNode.values()].filter((entry) => this.presentNodes.has(entry.address));
		const summary = buildDaylightFleetSummary(entries);
		await Promise.all([
			this.setStateAsync('gateway.daylight.analysisVersion', summary.analysisVersion, true),
			this.setStateAsync('gateway.daylight.verifiedLampCount', summary.verifiedLampCount, true),
			this.setStateAsync('gateway.daylight.distinctScheduleCount', summary.distinctScheduleCount, true),
			this.setStateAsync('gateway.daylight.distinctConfigurationCount', summary.distinctConfigurationCount, true),
			this.setStateAsync('gateway.daylight.distinctSchemaCount', summary.distinctSchemaCount, true),
			this.setStateAsync('gateway.daylight.conflict', summary.conflict, true),
			this.setStateAsync('gateway.daylight.configurationConflict', summary.configurationConflict, true),
			this.setStateAsync('gateway.daylight.schemaConflict', summary.schemaConflict, true),
			this.setStateAsync('gateway.daylight.summary', summary.summary, true),
			this.setStateAsync('gateway.daylight.summaryJson', JSON.stringify(summary), true),
			this.setStateAsync('gateway.daylight.lastEvaluatedAt', new Date().toISOString(), true),
		]);
	}

	private async handleResult(result: GatewayResult): Promise<void> {
		await this.applyLiveReportedResult(result);
		await this.applyDaylightReportedResult(result);
		const pending = this.pendingCommands.get(result.id);
		if (pending) {
			clearTimeout(pending.timeout);
			this.pendingCommands.delete(result.id);
		}
		await this.writeGlobalResult(result);
		const statusBase = pending?.statusBase ?? this.statusBaseForResult(result);
		if (statusBase === 'gateway.command') await this.ensureGatewayCommandChannel();
		if (statusBase?.startsWith('lamps.')) {
			const address = result.target ? normalizeAddress(result.target) : undefined;
			if (address && !this.knownNodes.has(address)) await this.ensureLamp(address, `SANlight ${address}`);
		}
		if (statusBase) await this.writeCommandStatus(statusBase, result, false);
		await this.applyPerLampClockResults(result);
		await this.applyPerLampDaylightResults(result);
		await this.setStateAsync('commands.pending', this.pendingCommands.size > 0, true);
		if (!result.ok) await this.setStateAsync('commands.lastError', result.message, true);
	}

	private async applyLiveReportedResult(result: GatewayResult): Promise<void> {
		const liveReported = result.details?.liveReported;
		if (!liveReported || typeof liveReported !== 'object' || Array.isArray(liveReported)) return;

		for (const [rawAddress, value] of Object.entries(liveReported)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			try {
				const address = normalizeAddress(rawAddress);
				if (!this.knownNodes.has(address)) await this.ensureLamp(address, `SANlight ${address}`);
				const report = value as Record<string, unknown>;
				const seconds = normalizeClockSeconds(report.lampClockSeconds, 'lampClockSeconds');
				if (report.lampClock !== formatClockSeconds(seconds)) {
					throw new ProtocolError('lampClock does not match lampClockSeconds');
				}
				if (
					typeof report.liveBrightnessRaw !== 'number' ||
					!Number.isInteger(report.liveBrightnessRaw) ||
					report.liveBrightnessRaw < 0 ||
					report.liveBrightnessRaw > 0xffff ||
					typeof report.liveBrightnessPercentEstimate !== 'number' ||
					!Number.isFinite(report.liveBrightnessPercentEstimate) ||
					Math.abs(report.liveBrightnessPercentEstimate - report.liveBrightnessRaw / 10) > 0.000001
				) {
					throw new ProtocolError('live brightness result is inconsistent');
				}
				await Promise.all([
					this.setStateAsync(`lamps.${address}.state.lampClockSeconds`, seconds, true),
					this.setStateAsync(`lamps.${address}.state.lampClock`, report.lampClock, true),
					this.setStateAsync(
						`lamps.${address}.state.liveBrightnessPercentEstimate`,
						report.liveBrightnessPercentEstimate,
						true,
					),
					this.setStateAsync(`lamps.${address}.state.liveVerified`, true, true),
					this.setStateAsync(`lamps.${address}.state.liveVerifiedAt`, result.timestamp, true),
					this.setStateAsync(`lamps.${address}.state.available`, true, true),
				]);
			} catch (error) {
				this.log.warn(`Ignored malformed live result for lamp ${rawAddress}: ${(error as Error).message}`);
			}
		}
	}

	private async applyDaylightReportedResult(result: GatewayResult): Promise<void> {
		if (result.action !== 'read-daylight') return;
		const daylightReported = result.details?.daylightReported;
		if (!daylightReported || typeof daylightReported !== 'object' || Array.isArray(daylightReported)) return;

		for (const [rawAddress, value] of Object.entries(daylightReported)) {
			try {
				const address = normalizeAddress(rawAddress);
				if (!this.knownNodes.has(address)) await this.ensureLamp(address, `SANlight ${address}`);
				const report = parseDaylightData(value, `daylightReported.${address}`);
				if (!report.parsed || !report.configuration) continue;
				await this.applyDaylightState(address, {
					...report,
					verified: true,
					verifiedAt: result.timestamp,
					lastReadAt: result.timestamp,
					lastReadOk: true,
				});
			} catch (error) {
				this.log.warn(`Ignored malformed daylight result for lamp ${rawAddress}: ${(error as Error).message}`);
			}
		}
	}

	private async applyPerLampClockResults(result: GatewayResult): Promise<void> {
		if (result.target !== 'all' || (result.action !== 'sync-clock' && result.action !== 'set-clock')) return;
		const nodes = result.details?.nodes;
		if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return;

		for (const [rawAddress, value] of Object.entries(nodes)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			try {
				const address = normalizeAddress(rawAddress);
				const nodeStatus = (value as Record<string, unknown>).status;
				if (typeof nodeStatus !== 'string') continue;
				if (!this.knownNodes.has(address)) await this.ensureLamp(address, `SANlight ${address}`);
				const nodeResult: GatewayResult = {
					...result,
					ok: nodeStatus === 'verified',
					status: nodeStatus,
					target: address,
					message: `Clock command ${nodeStatus} for lamp ${address}.`,
				};
				await this.writeCommandStatus(`lamps.${address}.command`, nodeResult, false);
			} catch (error) {
				this.log.warn(`Ignored malformed clock result for lamp ${rawAddress}: ${(error as Error).message}`);
			}
		}
	}

	private async applyPerLampDaylightResults(result: GatewayResult): Promise<void> {
		if (result.action !== 'read-daylight' || result.target !== 'all') return;
		const reportedRaw = result.details?.daylightReported;
		const errorsRaw = result.details?.errors;
		const reported =
			reportedRaw && typeof reportedRaw === 'object' && !Array.isArray(reportedRaw)
				? (reportedRaw as Record<string, unknown>)
				: {};
		const errors =
			errorsRaw && typeof errorsRaw === 'object' && !Array.isArray(errorsRaw)
				? (errorsRaw as Record<string, unknown>)
				: {};
		const addresses = new Set<string>(this.presentNodes);
		for (const rawAddress of [...Object.keys(reported), ...Object.keys(errors)]) {
			try {
				addresses.add(normalizeAddress(rawAddress));
			} catch (error) {
				this.log.warn(
					`Ignored invalid lamp address ${rawAddress} in daylight result: ${(error as Error).message}`,
				);
			}
		}

		for (const address of [...addresses].sort()) {
			if (!this.knownNodes.has(address)) await this.ensureLamp(address, `SANlight ${address}`);
			let status = 'failed';
			let ok = false;
			let message =
				typeof errors[address] === 'string'
					? String(errors[address])
					: `No daylight configuration was returned for lamp ${address}.`;
			const rawReport = reported[address];
			if (rawReport !== undefined) {
				try {
					const report = parseDaylightData(rawReport, `daylightReported.${address}`);
					if (report.parsed) {
						status = 'verified';
						ok = true;
						message = `Daylight configuration verified for lamp ${address}.`;
					} else {
						status = 'partial';
						message = report.parseError || `Raw daylight response retained for lamp ${address}.`;
					}
				} catch (error) {
					message = `Malformed daylight result for lamp ${address}: ${(error as Error).message}`;
				}
			}
			await this.writeCommandStatus(
				`lamps.${address}.command`,
				{
					...result,
					ok,
					status,
					target: address,
					message,
				},
				false,
			);
		}
	}

	private statusBaseForResult(result: GatewayResult): string | undefined {
		if (result.target && /^[0-9A-Fa-f]{4}$/.test(result.target))
			return `lamps.${result.target.toUpperCase()}.command`;
		if (result.target === 'all' || result.target === 'latest' || result.target === 'gateway')
			return 'gateway.command';
		return undefined;
	}

	private async writeGlobalResult(result: GatewayResult): Promise<void> {
		await Promise.all([
			this.setStateAsync('commands.lastCommandId', result.id, true),
			this.setStateAsync('commands.lastAction', result.action ?? '', true),
			this.setStateAsync('commands.lastTarget', result.target ?? '', true),
			this.setStateAsync('commands.lastStatus', result.status, true),
			this.setStateAsync('commands.lastMessage', result.message, true),
			this.setStateAsync('commands.lastOk', result.ok, true),
			this.setStateAsync('commands.lastResultAt', result.timestamp, true),
			this.setStateAsync('commands.lastError', result.ok ? '' : result.message, true),
		]);
	}

	private async writeCommandStatus(base: string, result: GatewayResult, pending: boolean): Promise<void> {
		await Promise.all([
			this.setStateAsync(`${base}.pending`, pending, true),
			this.setStateAsync(`${base}.lastStatus`, result.status, true),
			this.setStateAsync(`${base}.lastMessage`, result.message, true),
			this.setStateAsync(`${base}.lastCommandId`, result.id, true),
			this.setStateAsync(`${base}.lastResultAt`, result.timestamp, true),
			this.setStateAsync(`${base}.lastError`, result.ok ? '' : result.message, true),
		]);
	}

	private async ensureLamp(address: string, name: string): Promise<void> {
		const normalized = normalizeAddress(address);
		const displayName = name || `SANlight ${normalized}`;
		const isNew = !this.knownNodes.has(normalized);
		this.knownNodes.add(normalized);
		await this.setObjectNotExistsAsync(`lamps.${normalized}`, {
			type: 'device',
			common: { name: displayName },
			native: { gatewayId: this.gatewayId, address: normalized },
		});
		await this.extendObjectAsync(`lamps.${normalized}`, {
			common: { name: displayName },
		});
		for (const [channel, labelEn, labelDe] of [
			['info', 'Information', 'Information'],
			['state', 'Verified state', 'Verifizierter Zustand'],
			['daylight', 'Daylight schedule', 'Tageslichtplan'],
			['control', 'Controls', 'Steuerung'],
			['command', 'Command status', 'Befehlsstatus'],
		] as const) {
			await this.setObjectNotExistsAsync(`lamps.${normalized}.${channel}`, {
				type: 'channel',
				common: { name: { en: labelEn, de: labelDe } },
				native: {},
			});
		}

		await this.removeLegacyLiveBrightnessRawObject(normalized);

		const lampStates: Array<[string, ioBroker.StateObject['common']]> = [
			['info.address', this.stateCommon('Mesh address', 'Mesh-Adresse', 'string', 'text', false, normalized)],
			['info.name', this.stateCommon('Lamp name', 'Lampenname', 'string', 'text', false, displayName)],
			[
				'info.present',
				this.stateCommon(
					'Present in gateway topology',
					'In Gateway-Topologie vorhanden',
					'boolean',
					'indicator',
					false,
					true,
				),
			],
			[
				'info.supportsExplicitBlackout',
				this.stateCommon(
					'Supports explicit blackout',
					'Unterstützt expliziten Blackout',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'info.minimumBrightness',
				this.stateCommon(
					'Minimum normal brightness',
					'Minimale normale Helligkeit',
					'number',
					'value.brightness',
					false,
					20,
					'%',
				),
			],
			[
				'info.maximumBrightness',
				this.stateCommon(
					'Maximum brightness',
					'Maximale Helligkeit',
					'number',
					'value.brightness',
					false,
					100,
					'%',
				),
			],
			[
				'info.supportsDaylightRead',
				this.stateCommon(
					'Supports daylight schedule read',
					'Unterstützt das Lesen des Tageslichtplans',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'state.maxBrightness',
				this.stateCommon(
					'Verified maximum brightness',
					'Verifizierte maximale Helligkeit',
					'number',
					'value.brightness',
					false,
					0,
					'%',
				),
			],
			['state.off', this.stateCommon('Verified off', 'Verifiziert aus', 'boolean', 'indicator', false, false)],
			[
				'state.verified',
				this.stateCommon('State verified', 'Zustand verifiziert', 'boolean', 'indicator', false, false),
			],
			[
				'state.verifiedAt',
				this.stateCommon('Verified timestamp', 'Zeitstempel der Verifizierung', 'string', 'date', false, ''),
			],
			[
				'state.liveBrightnessPercentEstimate',
				this.stateCommon(
					'Current effective brightness',
					'Aktuelle effektive Helligkeit',
					'number',
					'value.brightness',
					false,
					0,
					'%',
				),
			],
			[
				'state.lampClockSeconds',
				{
					...this.stateCommon(
						'Lamp clock in seconds since midnight',
						'Lampenuhr in Sekunden seit Mitternacht',
						'number',
						'value',
						false,
						0,
						's',
					),
					min: CLOCK_SECONDS_MIN,
					max: CLOCK_SECONDS_MAX,
					step: 1,
				},
			],
			['state.lampClock', this.stateCommon('Lamp clock', 'Lampenuhr', 'string', 'text', false, '')],
			[
				'state.liveVerified',
				this.stateCommon(
					'Live lamp state verified',
					'Aktueller Lampenzustand verifiziert',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'state.liveVerifiedAt',
				this.stateCommon(
					'Live lamp state timestamp',
					'Zeitstempel des aktuellen Lampenzustands',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'state.available',
				this.stateCommon(
					'Lamp state available',
					'Lampenzustand verfügbar',
					'boolean',
					'indicator.reachable',
					false,
					false,
				),
			],
			[
				'state.cached',
				this.stateCommon(
					'State restored from gateway cache',
					'Zustand aus Gateway-Cache',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'daylight.verified',
				this.stateCommon(
					'Daylight configuration verified',
					'Tageslichtkonfiguration verifiziert',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'daylight.verifiedAt',
				this.stateCommon(
					'Daylight configuration verification timestamp',
					'Zeitstempel der Tageslichtkonfiguration',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'daylight.lastReadAt',
				this.stateCommon(
					'Last daylight read timestamp',
					'Zeitstempel des letzten Tageslicht-Lesevorgangs',
					'string',
					'date',
					false,
					'',
				),
			],
			[
				'daylight.lastReadOk',
				this.stateCommon(
					'Last daylight read successful',
					'Letzter Tageslicht-Lesevorgang erfolgreich',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'daylight.lastError',
				this.stateCommon(
					'Last daylight read error',
					'Letzter Tageslicht-Lesefehler',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'daylight.analysisVersion',
				this.stateCommon(
					'Daylight analysis version',
					'Version der Tageslicht-Auswertung',
					'number',
					'value',
					false,
					1,
				),
			],
			[
				'daylight.analysisValid',
				this.stateCommon(
					'Daylight schedule analysis valid',
					'Tageslichtplan-Auswertung gültig',
					'boolean',
					'indicator',
					false,
					false,
				),
			],
			[
				'daylight.analysisError',
				this.stateCommon(
					'Daylight analysis error',
					'Fehler der Tageslicht-Auswertung',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'daylight.profileId',
				this.stateCommon('Daylight profile ID', 'Tageslichtprofil-ID', 'number', 'value', false, 0),
			],
			[
				'daylight.profileName',
				this.stateCommon('Daylight profile name', 'Name des Tageslichtprofils', 'string', 'text', false, ''),
			],
			[
				'daylight.valueCount',
				this.stateCommon(
					'Daylight datapoint count',
					'Anzahl der Tageslicht-Datenpunkte',
					'number',
					'value',
					false,
					0,
				),
			],
			[
				'daylight.onHours',
				this.stateCommon(
					'Scheduled light hours',
					'Geplante Lichtstunden',
					'number',
					'value.interval',
					false,
					0,
					'h',
				),
			],
			[
				'daylight.offHours',
				this.stateCommon(
					'Scheduled dark hours',
					'Geplante Dunkelstunden',
					'number',
					'value.interval',
					false,
					0,
					'h',
				),
			],
			[
				'daylight.schema',
				this.stateCommon(
					'Rounded light:dark schema',
					'Gerundetes Licht:Dunkel-Schema',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'daylight.cycleType',
				this.stateCommon(
					'Cultivation cycle classification',
					'Anbauzyklus-Klassifizierung',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'daylight.lightWindowCount',
				this.stateCommon('Light window count', 'Anzahl der Lichtfenster', 'number', 'value', false, 0),
			],
			[
				'daylight.configurationFingerprint',
				this.stateCommon(
					'Configuration fingerprint',
					'Konfigurations-Fingerabdruck',
					'string',
					'text',
					false,
					'',
				),
			],
			[
				'daylight.scheduleFingerprint',
				this.stateCommon('Schedule fingerprint', 'Zeitplan-Fingerabdruck', 'string', 'text', false, ''),
			],
			[
				'daylight.configurationJson',
				this.stateCommon(
					'Daylight configuration JSON',
					'Tageslichtkonfiguration als JSON',
					'string',
					'json',
					false,
					'{}',
				),
			],
			[
				'daylight.valuesJson',
				this.stateCommon(
					'Daylight datapoints JSON',
					'Tageslicht-Datenpunkte als JSON',
					'string',
					'json',
					false,
					'[]',
				),
			],
			[
				'daylight.gatewayJson',
				this.stateCommon(
					'Complete gateway daylight JSON',
					'Vollständiges Gateway-Tageslicht-JSON',
					'string',
					'json',
					false,
					'{}',
				),
			],
			[
				'daylight.parserLayout',
				this.stateCommon('Gateway parser layout', 'Gateway-Parser-Layout', 'string', 'text', false, ''),
			],
			[
				'daylight.rawPduHex',
				this.stateCommon('Raw daylight PDU', 'Rohes Tageslicht-PDU', 'string', 'text', false, ''),
			],
			[
				'daylight.rawParametersHex',
				this.stateCommon('Raw daylight parameters', 'Rohe Tageslicht-Parameter', 'string', 'text', false, ''),
			],
			[
				'control.maxBrightness',
				{
					...this.stateCommon(
						'Requested maximum brightness',
						'Angeforderte maximale Helligkeit',
						'number',
						'level.dimmer',
						true,
						20,
						'%',
					),
					min: 20,
					max: 100,
					step: 1,
				},
			],
			[
				'control.refresh',
				this.stateCommon('Refresh lamp', 'Lampe aktualisieren', 'boolean', 'button', true, false),
			],
			[
				'control.readDaylight',
				this.stateCommon('Read daylight schedule', 'Tageslichtplan lesen', 'boolean', 'button', true, false),
			],
			[
				'control.syncClockNow',
				this.stateCommon(
					'Synchronize lamp clock now',
					'Lampenuhr jetzt synchronisieren',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'control.clockTargetSeconds',
				{
					...this.stateCommon(
						'Clock target in seconds since midnight',
						'Ziel-Uhrzeit in Sekunden seit Mitternacht',
						'number',
						'level',
						true,
						0,
						's',
					),
					min: CLOCK_SECONDS_MIN,
					max: CLOCK_SECONDS_MAX,
					step: 1,
				},
			],
			[
				'control.clockTargetTime',
				this.stateCommon(
					'Clock target (HH:MM or HH:MM:SS)',
					'Ziel-Uhrzeit (HH:MM oder HH:MM:SS)',
					'string',
					'text',
					true,
					'00:00:00',
				),
			],
			[
				'control.applyClockTarget',
				this.stateCommon(
					'Apply lamp clock target',
					'Ziel-Uhrzeit auf Lampe anwenden',
					'boolean',
					'button',
					true,
					false,
				),
			],
			[
				'control.blackout',
				this.stateCommon('Explicit blackout', 'Expliziter Blackout', 'boolean', 'button', true, false),
			],
			[
				'command.pending',
				this.stateCommon('Command pending', 'Befehl ausstehend', 'boolean', 'indicator.working', false, false),
			],
			['command.lastStatus', this.stateCommon('Last status', 'Letzter Status', 'string', 'text', false, '')],
			['command.lastMessage', this.stateCommon('Last message', 'Letzte Meldung', 'string', 'text', false, '')],
			[
				'command.lastCommandId',
				this.stateCommon('Last command ID', 'Letzte Befehls-ID', 'string', 'text', false, ''),
			],
			[
				'command.lastResultAt',
				this.stateCommon(
					'Last result timestamp',
					'Zeitstempel des letzten Ergebnisses',
					'string',
					'date',
					false,
					'',
				),
			],
			['command.lastError', this.stateCommon('Last error', 'Letzter Fehler', 'string', 'text', false, '')],
		];
		for (const [suffix, common] of lampStates) {
			await this.setObjectNotExistsAsync(`lamps.${normalized}.${suffix}`, {
				type: 'state',
				common,
				native: {},
			});
		}
		await Promise.all([
			this.extendObjectAsync(`lamps.${normalized}.state.lampClockSeconds`, { common: { role: 'value' } }),
			this.extendObjectAsync(`lamps.${normalized}.control.clockTargetSeconds`, { common: { role: 'level' } }),
			this.extendObjectAsync(`lamps.${normalized}.state.liveBrightnessPercentEstimate`, {
				common: this.stateCommon(
					'Current effective brightness',
					'Aktuelle effektive Helligkeit',
					'number',
					'value.brightness',
					false,
					0,
					'%',
				),
			}),
			this.extendObjectAsync(`lamps.${normalized}.state.liveVerified`, {
				common: this.stateCommon(
					'Live lamp state verified',
					'Aktueller Lampenzustand verifiziert',
					'boolean',
					'indicator',
					false,
					false,
				),
			}),
			this.extendObjectAsync(`lamps.${normalized}.state.liveVerifiedAt`, {
				common: this.stateCommon(
					'Live lamp state timestamp',
					'Zeitstempel des aktuellen Lampenzustands',
					'string',
					'date',
					false,
					'',
				),
			}),
		]);
		await this.initializeClockTargetPair(`lamps.${normalized}.control`);
		if (isNew) {
			await Promise.all([
				this.setStateAsync(`lamps.${normalized}.info.address`, normalized, true),
				this.setStateAsync(`lamps.${normalized}.info.name`, displayName, true),
				this.setStateAsync(`lamps.${normalized}.info.present`, true, true),
			]);
		}
	}

	private async removeLegacyLiveBrightnessRawObject(address: string): Promise<void> {
		const id = `lamps.${address}.state.liveBrightnessRaw`;
		try {
			if (!(await this.getObjectAsync(id))) return;
			await this.delObjectAsync(id);
			this.log.debug(`Removed deprecated ioBroker state ${id}`);
		} catch (error) {
			this.log.warn(`Could not remove deprecated ioBroker state ${id}: ${(error as Error).message}`);
		}
	}

	private async removeLegacyLampTimeMsObject(address: string): Promise<void> {
		const id = `lamps.${address}.state.lampTimeMs`;
		try {
			if (!(await this.getObjectAsync(id))) return;
			await this.delObjectAsync(id);
			this.log.debug(`Removed deprecated ioBroker state ${id}`);
		} catch (error) {
			this.log.warn(`Could not remove deprecated ioBroker state ${id}: ${(error as Error).message}`);
		}
	}

	private async ensureGatewayCommandChannel(): Promise<void> {
		await this.setObjectNotExistsAsync('gateway.command', {
			type: 'channel',
			common: {
				name: { en: 'Gateway command status', de: 'Gateway-Befehlsstatus' },
			},
			native: {},
		});
		for (const [suffix, common] of [
			[
				'pending',
				this.stateCommon('Command pending', 'Befehl ausstehend', 'boolean', 'indicator.working', false, false),
			],
			['lastStatus', this.stateCommon('Last status', 'Letzter Status', 'string', 'text', false, '')],
			['lastMessage', this.stateCommon('Last message', 'Letzte Meldung', 'string', 'text', false, '')],
			['lastCommandId', this.stateCommon('Last command ID', 'Letzte Befehls-ID', 'string', 'text', false, '')],
			[
				'lastResultAt',
				this.stateCommon(
					'Last result timestamp',
					'Zeitstempel des letzten Ergebnisses',
					'string',
					'date',
					false,
					'',
				),
			],
			['lastError', this.stateCommon('Last error', 'Letzter Fehler', 'string', 'text', false, '')],
		] as Array<[string, ioBroker.StateObject['common']]>) {
			await this.setObjectNotExistsAsync(`gateway.command.${suffix}`, {
				type: 'state',
				common,
				native: {},
			});
		}
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack || this.shuttingDown) return;
		const relative = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
		try {
			if (relative === 'gateway.control.refreshAll') {
				await this.ackButton(relative);
				await this.sendCommand(
					createRefreshCommand(this.newCommandId('refresh', 'all'), 'all', this.commandTtl()),
				);
				return;
			}
			if (relative === 'gateway.control.readAllDaylight') {
				await this.ackButton(relative);
				await this.sendCommand(
					createReadDaylightCommand(this.newCommandId('read-daylight', 'all'), 'all', this.commandTtl()),
				);
				return;
			}
			if (relative === 'gateway.control.refreshInfo') {
				await this.ackButton(relative);
				await this.sendCommand(
					createRefreshGatewayInfoCommand(
						this.newCommandId('refresh-gateway-info', 'gateway'),
						this.commandTtl(),
					),
				);
				return;
			}
			if (relative === 'gateway.control.syncAllClocksNow') {
				await this.ackButton(relative);
				await this.sendCommand(
					createSyncClockCommand(this.newCommandId('sync-clock', 'all'), 'all', this.commandTtl()),
				);
				return;
			}
			if (relative === 'gateway.control.clockTargetSeconds') {
				await this.updateClockTargetFromSeconds('gateway.control', state.val);
				return;
			}
			if (relative === 'gateway.control.clockTargetTime') {
				await this.updateClockTargetFromText('gateway.control', state.val);
				return;
			}
			if (relative === 'gateway.control.applyClockTargetToAll') {
				await this.ackButton(relative);
				const seconds = await this.readClockTargetSeconds('gateway.control');
				await this.sendCommand(
					createSetClockCommand(this.newCommandId('set-clock', 'all'), 'all', seconds, this.commandTtl()),
				);
				return;
			}
			if (relative === 'gateway.control.blackoutAll') {
				await this.ackButton(relative);
				this.requireBlackoutEnabled();
				await this.sendCommand(
					createBlackoutCommand(this.newCommandId('blackout', 'all'), 'all', this.commandTtl()),
				);
				return;
			}
			if (relative === 'gateway.control.restoreLatestBlackout') {
				await this.ackButton(relative);
				this.requireBlackoutEnabled();
				await this.sendCommand(
					createRestoreBlackoutCommand(this.newCommandId('restore-blackout', 'latest'), this.commandTtl()),
				);
				return;
			}
			const match =
				/^lamps\.([0-9A-Fa-f]{4})\.control\.(maxBrightness|refresh|readDaylight|blackout|syncClockNow|clockTargetSeconds|clockTargetTime|applyClockTarget)$/.exec(
					relative,
				);
			if (!match?.[1] || !match[2]) return;
			const address = normalizeAddress(match[1]);
			if (match[2] === 'maxBrightness') {
				const value = Number(state.val);
				createSetMaxCommand('validation', address, value, this.commandTtl());
				await this.setStateAsync(relative, value, true);
				this.scheduleBrightness(address, value);
			} else if (match[2] === 'refresh') {
				await this.ackButton(relative);
				await this.sendCommand(
					createRefreshCommand(this.newCommandId('refresh', address), address, this.commandTtl()),
				);
			} else if (match[2] === 'readDaylight') {
				await this.ackButton(relative);
				await this.sendCommand(
					createReadDaylightCommand(this.newCommandId('read-daylight', address), address, this.commandTtl()),
				);
			} else if (match[2] === 'syncClockNow') {
				await this.ackButton(relative);
				await this.sendCommand(
					createSyncClockCommand(this.newCommandId('sync-clock', address), address, this.commandTtl()),
				);
			} else if (match[2] === 'clockTargetSeconds') {
				await this.updateClockTargetFromSeconds(`lamps.${address}.control`, state.val);
			} else if (match[2] === 'clockTargetTime') {
				await this.updateClockTargetFromText(`lamps.${address}.control`, state.val);
			} else if (match[2] === 'applyClockTarget') {
				await this.ackButton(relative);
				const seconds = await this.readClockTargetSeconds(`lamps.${address}.control`);
				await this.sendCommand(
					createSetClockCommand(this.newCommandId('set-clock', address), address, seconds, this.commandTtl()),
				);
			} else {
				await this.ackButton(relative);
				this.requireBlackoutEnabled();
				await this.sendCommand(
					createBlackoutCommand(this.newCommandId('blackout', address), address, this.commandTtl()),
				);
			}
		} catch (error) {
			const invalidBrightness = /^lamps\.([0-9A-Fa-f]{4})\.control\.maxBrightness$/.exec(relative);
			if (invalidBrightness?.[1])
				await this.restoreBrightnessControl(normalizeAddress(invalidBrightness[1]), relative);
			const message = (error as Error).message;
			await this.setLastError(message);
			this.log.warn(`Rejected state write ${relative}: ${message}`);
		}
	}

	private async restoreBrightnessControl(address: string, stateId: string): Promise<void> {
		const reported = await this.getStateAsync(`lamps.${address}.state.maxBrightness`);
		const value =
			typeof reported?.val === 'number' && reported.val >= 20 && reported.val <= 100 ? reported.val : 20;
		await this.setStateAsync(stateId, value, true);
	}

	private async updateClockTargetFromSeconds(base: string, value: ioBroker.StateValue): Promise<void> {
		try {
			const seconds = normalizeClockSeconds(value, 'clockTargetSeconds');
			await this.writeClockTargetPair(base, seconds);
		} catch (error) {
			await this.restoreClockTargetPair(base);
			throw error;
		}
	}

	private async updateClockTargetFromText(base: string, value: ioBroker.StateValue): Promise<void> {
		try {
			const seconds = parseClockTarget(value);
			await this.writeClockTargetPair(base, seconds);
		} catch (error) {
			await this.restoreClockTargetPair(base);
			throw error;
		}
	}

	private async writeClockTargetPair(base: string, seconds: number): Promise<void> {
		await Promise.all([
			this.setStateAsync(`${base}.clockTargetSeconds`, seconds, true),
			this.setStateAsync(`${base}.clockTargetTime`, formatClockSeconds(seconds), true),
		]);
	}

	private async restoreClockTargetPair(base: string): Promise<void> {
		const numeric = await this.getStateAsync(`${base}.clockTargetSeconds`);
		if (
			typeof numeric?.val === 'number' &&
			Number.isInteger(numeric.val) &&
			numeric.val >= CLOCK_SECONDS_MIN &&
			numeric.val <= CLOCK_SECONDS_MAX
		) {
			await this.writeClockTargetPair(base, numeric.val);
			return;
		}
		const text = await this.getStateAsync(`${base}.clockTargetTime`);
		try {
			await this.writeClockTargetPair(base, parseClockTarget(text?.val));
		} catch {
			await this.writeClockTargetPair(base, 0);
		}
	}

	private async readClockTargetSeconds(base: string): Promise<number> {
		const state = await this.getStateAsync(`${base}.clockTargetSeconds`);
		return normalizeClockSeconds(state?.val, 'clockTargetSeconds');
	}

	private async initializeClockTargetPair(base: string): Promise<void> {
		const numeric = await this.getStateAsync(`${base}.clockTargetSeconds`);
		if (
			typeof numeric?.val === 'number' &&
			Number.isInteger(numeric.val) &&
			numeric.val >= CLOCK_SECONDS_MIN &&
			numeric.val <= CLOCK_SECONDS_MAX
		) {
			const formatted = formatClockSeconds(numeric.val);
			const text = await this.getStateAsync(`${base}.clockTargetTime`);
			if (text?.val !== formatted) await this.writeClockTargetPair(base, numeric.val);
			return;
		}
		const text = await this.getStateAsync(`${base}.clockTargetTime`);
		try {
			await this.writeClockTargetPair(base, parseClockTarget(text?.val));
		} catch {
			await this.writeClockTargetPair(base, 0);
		}
	}

	private scheduleBrightness(address: string, value: number): void {
		const existing = this.brightnessTimers.get(address);
		if (existing) clearTimeout(existing);
		this.brightnessRequests.set(address, { value });
		const delay = Math.max(0, Math.min(5000, Number(this.config.brightnessDebounceMs) || 0));
		const timer = setTimeout(() => {
			this.brightnessTimers.delete(address);
			const request = this.brightnessRequests.get(address);
			this.brightnessRequests.delete(address);
			if (!request) return;
			void this.sendCommand(
				createSetMaxCommand(this.newCommandId('set-max', address), address, request.value, this.commandTtl()),
			).catch((error) => {
				const message = (error as Error).message;
				void this.setLastError(message);
				this.log.warn(`Brightness command for ${address} was not sent: ${message}`);
			});
		}, delay);
		this.brightnessTimers.set(address, timer);
	}

	private commandTtl(): number {
		return normalizeTtl(Number(this.config.commandTtlSeconds));
	}

	private newCommandId(action: GatewayAction, target: string): string {
		return `${action}-${target}-${Date.now()}-${randomUUID().slice(0, 8)}`;
	}

	private requireBlackoutEnabled(): void {
		if (!this.config.allowBlackout)
			throw new Error('Explicit blackout is disabled in the adapter instance configuration');
	}

	private async ackButton(id: string): Promise<void> {
		await this.setStateAsync(id, false, true);
	}

	private async sendCommand(command: GatewayCommand): Promise<void> {
		const client = this.client;
		const topics = this.topics;
		if (!client || !topics || !this.mqttConnected) throw new Error('MQTT broker is not connected');
		if (!this.gatewayOnline) throw new Error(`Gateway ${this.gatewayId} is offline`);
		if (!this.protocolCompatible) throw new Error(`Gateway protocol is not compatible with v${PROTOCOL_VERSION}`);
		if (this.pendingCommands.has(command.id)) throw new Error(`Command ID ${command.id} is already pending`);
		if (this.pendingCommands.size >= MAX_PENDING_COMMANDS)
			throw new Error(`Too many pending commands (${MAX_PENDING_COMMANDS}); wait for results before retrying`);
		await this.ensureGatewayCommandChannel();
		const statusBase = /^[0-9A-F]{4}$/.test(command.target) ? `lamps.${command.target}.command` : 'gateway.command';
		const timeoutMs = Math.max(10_000, command.ttlSeconds * 1000 + 5000);
		const timeout = setTimeout(() => void this.commandTimedOut(command.id), timeoutMs);
		this.pendingCommands.set(command.id, {
			id: command.id,
			action: command.action,
			target: command.target,
			statusBase,
			timeout,
		});
		await Promise.all([
			this.setStateAsync('commands.pending', true, true),
			this.setStateAsync('commands.lastCommandId', command.id, true),
			this.setStateAsync('commands.lastAction', command.action, true),
			this.setStateAsync('commands.lastTarget', command.target, true),
			this.setStateAsync('commands.lastStatus', 'pending', true),
			this.setStateAsync('commands.lastMessage', 'Command published; waiting for verified gateway result.', true),
			this.setStateAsync('commands.lastError', '', true),
			this.setStateAsync(`${statusBase}.pending`, true, true),
			this.setStateAsync(`${statusBase}.lastCommandId`, command.id, true),
			this.setStateAsync(`${statusBase}.lastStatus`, 'pending', true),
			this.setStateAsync(`${statusBase}.lastMessage`, 'Waiting for gateway result.', true),
			this.setStateAsync(`${statusBase}.lastError`, '', true),
		]);
		try {
			await new Promise<void>((resolve, reject) => {
				client.publish(topics.command, JSON.stringify(command), { qos: 1, retain: false }, (error) =>
					error ? reject(error) : resolve(),
				);
			});
		} catch (error) {
			clearTimeout(timeout);
			this.pendingCommands.delete(command.id);
			await this.setStateAsync(`${statusBase}.pending`, false, true);
			await this.setStateAsync('commands.pending', this.pendingCommands.size > 0, true);
			throw error;
		}
	}

	private async commandTimedOut(commandId: string): Promise<void> {
		const pending = this.pendingCommands.get(commandId);
		if (!pending) return;
		this.pendingCommands.delete(commandId);
		const message =
			'No gateway result arrived before the adapter timeout. Refresh state before deciding whether to retry.';
		await Promise.all([
			this.setStateAsync(`${pending.statusBase}.pending`, false, true),
			this.setStateAsync(`${pending.statusBase}.lastStatus`, 'adapter-timeout', true),
			this.setStateAsync(`${pending.statusBase}.lastMessage`, message, true),
			this.setStateAsync(`${pending.statusBase}.lastError`, message, true),
			this.setStateAsync('commands.pending', this.pendingCommands.size > 0, true),
			this.setStateAsync('commands.lastStatus', 'adapter-timeout', true),
			this.setStateAsync('commands.lastMessage', message, true),
			this.setStateAsync('commands.lastError', message, true),
		]);
	}

	private async setMqttConnected(value: boolean): Promise<void> {
		this.mqttConnected = value;
		await this.setStateAsync('info.mqttConnected', value, true);
		if (!value) {
			this.gatewayOnline = false;
			await this.setStateAsync('info.gatewayOnline', false, true);
			await this.markAllLampsUnavailable();
		}
		await this.updateConnectionState();
	}

	private async updateConnectionState(): Promise<void> {
		await this.setStateAsync(
			'info.connection',
			this.mqttConnected && this.gatewayOnline && this.protocolCompatible,
			true,
		);
	}

	private async markAllLampsUnavailable(): Promise<void> {
		await Promise.all(
			[...this.knownNodes].flatMap((address) => [
				this.setStateAsync(`lamps.${address}.state.available`, false, true),
				this.setStateAsync(`lamps.${address}.state.liveVerified`, false, true),
			]),
		);
	}

	private async setLastError(message: string): Promise<void> {
		await this.setStateAsync('info.lastError', message, true);
	}

	private onUnload(callback: () => void): void {
		this.shuttingDown = true;
		this.clearSubscriptionRetry();
		for (const timer of this.brightnessTimers.values()) clearTimeout(timer);
		this.brightnessTimers.clear();
		for (const pending of this.pendingCommands.values()) clearTimeout(pending.timeout);
		this.pendingCommands.clear();
		const finish = (): void => callback();
		if (!this.client) return finish();
		try {
			this.client.end(false, {}, finish);
		} catch (error) {
			this.log.warn(`MQTT shutdown warning: ${(error as Error).message}`);
			finish();
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Sanlightmesh(options);
} else {
	(() => new Sanlightmesh())();
}
