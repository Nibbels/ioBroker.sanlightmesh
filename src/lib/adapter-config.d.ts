declare global {
	namespace ioBroker {
		interface AdapterConfig {
			mqttHost: string;
			mqttPort: number;
			mqttTls: boolean;
			mqttRejectUnauthorized: boolean;
			mqttCaPath: string;
			mqttUsername: string;
			mqttPassword: string;
			topicPrefix: string;
			gatewayId: string;
			commandTtlSeconds: number;
			brightnessDebounceMs: number;
			allowBlackout: boolean;
		}
	}
}

export {};
