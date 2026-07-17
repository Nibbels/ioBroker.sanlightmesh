# ioBroker.sanlightmesh 0.3.0

This release adds explicit manual lamp-clock controls to the independent
community adapter for the MQTT gateway for SANlight Mesh. It remains pre-1.0
and is installed from GitHub rather than an ioBroker repository.

## Highlights

- Read the last observed lamp clock as whole seconds since midnight and as an `HH:MM:SS` snapshot.
- Synchronize one lamp or all lamps to the gateway Raspberry Pi's current local time.
- Apply an arbitrary seconds-since-midnight or `HH:MM[:SS]` target with a separate explicit apply action.
- Refresh the gateway local-clock reference without a Bluetooth Mesh operation.
- Keep target inputs separate from verified lamp state and reject invalid values such as `24:00` or `86400`.
- Automatically remove the obsolete `state.lampTimeMs` object and use `state.lampClockSeconds`.
- Continue presenting current effective brightness as the hardware-compared one-decimal percentage while keeping the raw vendor field transport-internal.
- Hardware-validate single-lamp and all-lamp operations, a lamp power cycle and recovery synchronization on two real lamps.

## Compatibility

Use with `sanlight-mesh-mqtt-gateway v0.3.0`. The MQTT topic contract remains
API v1, but this is a coordinated pre-1.0 compatibility change: external
`lampTimeMs` is replaced by `lampClockSeconds` plus second-resolution
`lampClock`. Update the gateway and adapter together.

Existing native connection settings are retained during an update. MaxBrightness
control, live effective-output reporting and protected blackout behavior remain
unchanged.

## Power-loss behavior

On the validated two-lamp reference setup, restoring lamp power reset both lamp
clocks to `00:00:00`. The adapter never synchronizes them automatically. After
a power interruption, wait until the lamps are reachable and explicitly trigger
`gateway.control.syncAllClocksNow`.

## Important limitations

- Clock values are snapshots and do not tick inside ioBroker.
- There is no automatic synchronization, drift alarm, NTP check, timezone or DST policy, or periodic lamp polling.
- All-lamp commands are sequential and may remain `pending` for more than 25 seconds; wait for the final result.
- Repository-based `iobroker upgrade` remains unavailable because the adapter is not yet published in an ioBroker repository.

## Installation

After the tag is published, install or update the immutable release with:

```bash
iobroker url Nibbels/ioBroker.sanlightmesh#v0.3.0 sanlightmesh --debug
```
