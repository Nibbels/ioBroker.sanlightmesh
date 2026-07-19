# ioBroker.sanlightmesh 0.4.0

This release adds read-only monitoring and interpretation of the daylight
configuration stored in each SANlight lamp. The independent community adapter
remains pre-1.0 and is installed from GitHub rather than an ioBroker repository.

## Highlights

- Read one lamp with `lamps.<address>.control.readDaylight` or all known lamps
  with `gateway.control.readAllDaylight`; both are explicit one-shot operations
  and normal refresh remains unchanged.
- Expose verified profile ID, name, ordered datapoints, raw protocol data,
  fingerprints and complete JSON objects as native ioBroker states.
- Derive script-friendly `onHours`, `offHours`, rounded `light:dark` schema,
  light-window count and cycle classification from the actual datapoints rather
  than trusting the profile name.
- Use the SANlight 20% effective-light threshold, so the validated 12:12 profile
  reports exactly 12 light and 12 dark hours.
- Classify one-window schedules as `flowering`, `transition` or `vegetative`, and
  expose `alwaysDark`, `alwaysOn` and `custom` for the corresponding edge cases.
- Combine the effective light windows of all active lamps, ignore always-dark
  lamps for plant exposure, and expose fleet-wide combined hours and schema.
- Separate informational schedule/configuration/schema differences from the
  actionable `gateway.daylight.conflict` flowering-risk alarm.
- Preserve full JSON and analysis diagnostics so JavaScript and TypeScript
  automation can implement stricter zone-specific policy.

## Conflict model

The actionable conflict is intentionally narrower than a raw profile mismatch.
It becomes true when at least one active lamp individually remains below 13
effective light hours, but the union of active lamp schedules reaches 13 hours
or more. This detects accidental flowering exposure from shifted 12:12 lamps or
a 12:12 lamp combined with an 18:6 lamp.

Always-dark lamps are excluded from combined plant exposure. Different profiles
where every active lamp already has at least 13 light hours remain informational
rather than an alarm. Multi-zone installations should use `summaryJson` and an
address-to-zone mapping instead of treating the gateway-wide result as one room.

## Compatibility

Use with `sanlight-mesh-mqtt-gateway v0.4.0`. MQTT API v1 remains in place and
the release adds the coordinated `read-daylight` command plus optional retained
daylight state. Existing connection settings, MaxBrightness controls, live
output, manual clock controls and blackout protection are retained.

A v0.3.0 gateway does not provide the daylight command or state; update both
repositories together to use this feature.

## Hardware validation

The adapter was tested on the real two-lamp setup with:

- identical 12:12 profiles and no conflict;
- mixed 18:6 and 12:12 profiles, producing a verified flowering-risk conflict;
- an always-dark lamp plus a 12:12 lamp, producing 12:12 combined exposure with
  no actionable conflict; and
- one-shot control reset, retained state processing and singular/plural conflict
  messages.

The final release candidate passes 28 unit tests, TypeScript checking, package
metadata validation, Prettier, build and package dry-run checks.

## Important limitations

- Daylight reads are snapshots and are not triggered periodically.
- `cycleType` is an automation hint, not a horticultural guarantee.
- The profile name is metadata only and is never used for classification.
- Gateway-wide conflict analysis cannot know tent or room membership. Use
  `summaryJson` for custom grouping in multi-zone installations.
- Repository-based `iobroker upgrade` remains unavailable because the adapter is
  not yet published in an ioBroker repository.

## Installation

After the tag is published, install or update the immutable release with:

```bash
iobroker url Nibbels/ioBroker.sanlightmesh#v0.4.0 sanlightmesh --debug
```

Restart the instance after installation when the ioBroker host does not restart
it automatically, then trigger one read-only all-lamp daylight read and verify
`gateway.daylight` plus the per-lamp `daylight` states.
