# ioBroker object model

One adapter instance owns exactly one configured gateway. Object IDs therefore do not need to repeat the gateway ID, while every device records the gateway ID in its native metadata.

## Connection states

| State                     | Meaning                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `info.mqttConnected`      | MQTT transport is connected                                          |
| `info.gatewayOnline`      | retained gateway availability is `online`                            |
| `info.protocolCompatible` | retained gateway info uses MQTT API v1 and the configured gateway ID |
| `info.connection`         | all three conditions above are true; write commands are allowed      |
| `info.lastError`          | last adapter-level validation, configuration or MQTT error           |

## Gateway

`gateway.info.*` exposes service version, Mesh UUID, canonical sender address, sequence-number budget and the last gateway-info timestamp.

`gateway.control.*` provides:

- `refreshAll`
- `blackoutAll`
- `restoreLatestBlackout`

Blackout and restore are rejected unless explicit blackout is enabled in the instance configuration.

## Lamp devices

Each address in retained `gateway/info` becomes a device below `lamps.<ADDRESS>`.

### `info`

Stable metadata such as address, name, topology presence and supported brightness limits.

A node missing from a newer topology is marked `present=false` and `available=false`. Objects are not automatically deleted because ioBroker scripts, aliases, history and custom settings may refer to them.

### `state`

Verified gateway reports:

- `maxBrightness` — configured daily-profile scaling limit
- `off`
- `verified`
- `verifiedAt`
- `liveBrightnessPercentEstimate` — current effective brightness with one decimal place
- `lampTimeMs`
- `lampClock`
- `liveVerified`
- `liveVerifiedAt`
- `available`
- `cached`

The live fields are read-only and remain separate from MaxBrightness. The
percentage was hardware-compared with the SANlight app: `33.4%` in ioBroker
appears there as the rounded value `34%`. The raw vendor field remains
transport-internal and is not a separate ioBroker object. Existing
`state.liveBrightnessRaw` objects from earlier development versions are removed
automatically.

When `liveVerified=false`, the numeric live states retain their last received values
but must be treated as stale or unavailable. Use `liveVerifiedAt` for age and do
not interpret the estimate as calibrated power, photon flux or PPFD.

### `control`

User-writable targets and buttons:

- `maxBrightness` — normal range `20..100`
- `refresh`
- `blackout`

The control target is separate from the verified report. A requested value never overwrites `state.maxBrightness` before gateway readback.

### `command`

Bounded operational status for the last command affecting the lamp. There is no permanent state per MQTT command ID.

## Global command status

`commands.*` records the currently pending condition and the last command/result across the whole adapter instance. This makes dashboards and troubleshooting possible without reproducing the generic MQTT adapter's unbounded `result/<COMMAND_ID>` object tree.
