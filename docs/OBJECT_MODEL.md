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

`gateway.info.*` exposes service version, Mesh UUID, canonical sender address, sequence-number budget, a local-clock snapshot (`localClockSeconds` and `localClock`) and the gateway-info timestamp. The clock value is a snapshot and does not tick inside ioBroker.

`gateway.control.*` provides:

- `refreshAll`
- `readAllDaylight` — dedicated read-only profile query for all lamps
- `refreshInfo` — republishes gateway-local information without a Mesh operation
- `syncAllClocksNow`
- `clockTargetSeconds` / `clockTargetTime`
- `applyClockTargetToAll`
- `blackoutAll`
- `restoreLatestBlackout`

Blackout and restore are rejected unless explicit blackout is enabled in the instance configuration.

### `gateway.daylight`

Fleet-level schedule evaluation for all currently present lamps with a verified
daylight configuration:

- `analysisVersion`, `effectiveLightThreshold`
- `verifiedLampCount`, `activeLampCount`, `ignoredAlwaysDarkLampCount`
- `distinctScheduleCount`, `distinctConfigurationCount`, `distinctSchemaCount`
- `scheduleDifference` — informational: raw schedule fingerprints differ
- `configurationConflict` — informational: complete profile ID/name/datapoints differ
- `schemaConflict` — informational: rounded per-lamp schemas differ
- `combinedOnHours`, `combinedOffHours`
- `combinedSchema`, `combinedCycleType`, `combinedLightWindowCount`
- `transitionWarning`
- `conflict`, `conflictReason`
- `summary`, `summaryJson`, `lastEvaluatedAt`

The adapter unions the effective light windows of all active lamps. An
`alwaysDark` lamp contributes no plant-light exposure and is counted in
`ignoredAlwaysDarkLampCount`. The three difference indicators above are
informational and never make a command fail. `conflict` is the actionable,
gateway-wide flowering-risk alarm and is deliberately narrower than a raw
schedule difference: it becomes true only when at least one active lamp has less
than 13 effective light hours, but the union of active schedules reaches at
least 13 hours. This catches shifted 12:12 schedules or a 12:12 lamp combined
with an 18:6 lamp without treating different vegetative schedules as an alarm.

The scope is the complete configured gateway, not a tent or room. A multi-zone
installation may therefore need to parse `summaryJson` and apply its own
address-to-zone mapping.

## Lamp devices

Each address in retained `gateway/info` becomes a device below `lamps.<ADDRESS>`.

### `info`

Stable metadata such as address, name, topology presence and supported brightness limits.

`supportsDaylightRead` reflects the gateway metadata capability flag.

A node missing from a newer topology is marked `present=false` and `available=false`. Objects are not automatically deleted because ioBroker scripts, aliases, history and custom settings may refer to them.

### `state`

Verified gateway reports:

- `maxBrightness` — configured daily-profile scaling limit
- `off`
- `verified`
- `verifiedAt`
- `liveBrightnessPercentEstimate` — current effective brightness with one decimal place
- `lampClockSeconds` — observed whole seconds since lamp midnight
- `lampClock` — observed `HH:MM:SS` snapshot
- `liveVerified`
- `liveVerifiedAt`
- `available`
- `cached`

The live fields are read-only and remain separate from MaxBrightness. The
percentage was hardware-compared with the SANlight app: `33.4%` in ioBroker
appears there as the rounded value `34%`. The raw vendor field remains
transport-internal and is not a separate ioBroker object. Existing `state.liveBrightnessRaw` and `state.lampTimeMs` objects from earlier development versions are removed automatically.

When `liveVerified=false`, the numeric live states retain their last received values
but must be treated as stale or unavailable. Use `liveVerifiedAt` for age and do
not interpret the estimate as calibrated power, photon flux or PPFD.

### `daylight`

The read-only configuration and its adapter-side interpretation:

- `verified`, `verifiedAt`
- `lastReadAt`, `lastReadOk`, `lastError`
- `analysisVersion`, `effectiveLightThreshold`, `analysisValid`, `analysisError`
- `profileId`, `profileName`, `valueCount`
- `onHours`, `offHours`
- `schema`
- `cycleType`
- `lightWindowCount`
- `configurationFingerprint`, `scheduleFingerprint`
- `configurationJson`, `valuesJson`, `gatewayJson`
- `parserLayout`, `rawPduHex`, `rawParametersHex`

`configurationJson` contains the profile ID, name and ordered datapoints.
`gatewayJson` preserves the complete gateway object, including diagnostic and
combined-response fields. Scripts should require `verified=true` and
`analysisValid=true` before using derived values. If analysis is rejected,
`analysisError` explains why while the verified profile JSON remains available. `lastReadOk=false` can coexist
with `verified=true`: the gateway preserves the last valid configuration after a
newer timeout or unknown response.

The duration calculation treats the ordered datapoints as a piecewise-linear
24-hour curve and counts only portions at or above 20% brightness. This matches
the effective SANlight minimum and prevents sub-20% interpolation fragments from
inflating a 12:12 profile to 12.033 hours. `offHours` is the remainder of 24
hours; numeric values are rounded to three decimals.

For one continuous light window, `schema` rounds the effective light duration to
the nearest whole hour and derives the dark side as `24 - light`. Thus a window
from 18:02 to 20:23 is shown as `2:22`, while the numeric states remain `2.35`
and `21.65`. Multiple separate light windows use `schema=custom` even when their
total duration resembles a conventional cycle.

`cycleType` is an automation hint, not a horticultural guarantee:

- exact zero light: `alwaysDark`
- exact 24-hour light: `alwaysOn`
- one window below 13 light hours: `flowering`
- one window from 13 through 15 light hours: `transition`
- one window above 15 light hours: `vegetative`
- every multi-window schedule: `custom`

The profile name is never used for classification. Scripts with stricter rules
should use `onHours`, `offHours`, `schema`, `lightWindowCount` and the JSON data.

### `control`

User-writable targets and buttons:

- `maxBrightness` — normal range `20..100`
- `refresh`
- `readDaylight`
- `syncClockNow`
- `clockTargetSeconds` / `clockTargetTime`
- `applyClockTarget`
- `blackout`

The control target is separate from the verified report. A requested value never overwrites `state.maxBrightness` before gateway readback. Clock targets accept `HH:MM` or `HH:MM:SS`; `24:00` is invalid. Editing a clock target only updates the paired input states. A lamp write occurs only when the explicit apply or sync button is used. On the validated two-lamp setup, restoring power reset both lamp clocks to `00:00:00`; synchronization remains explicit.

### `command`

Bounded operational status for the last command affecting the lamp. There is no permanent state per MQTT command ID.

## Global command status

`commands.*` records the currently pending condition and the last command/result across the whole adapter instance. This makes dashboards and troubleshooting possible without reproducing the generic MQTT adapter's unbounded `result/<COMMAND_ID>` object tree.
