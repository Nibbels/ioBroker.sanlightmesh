# Changelog

All notable changes to this project are documented here. The adapter is pre-1.0;
MQTT protocol compatibility and configuration changes must be called out
explicitly.

## Unreleased

- Add dedicated read-only daylight-profile controls for one lamp and all lamps;
  normal refresh behavior remains unchanged.
- Parse and retain the gateway's complete daylight configuration object,
  including profile metadata, datapoints, parser layout and raw protocol data.
- Derive script-friendly light and dark hours, rounded `light:dark` schemas,
  cycle classifications, light-window counts and stable fingerprints from the
  actual datapoints rather than trusting the profile name.
- Add gateway-wide schedule, schema and configuration difference indicators plus
  a JSON fleet summary for automation and surveillance use.
- Evaluate effective plant-light exposure at the SANlight 20% threshold, ignore
  always-dark lamps when combining exposure, and expose combined hours, schema,
  cycle type and light-window count.
- Raise a cultivation conflict only when at least one active lamp remains below
  13 light hours but the union of active lamp schedules reaches the 13..15 hour
  transition range or beyond; differing schedules at 13+ hours remain
  informational.
- Add an explicit `transition` classification for 13..15 light hours and cover
  shifted flowering schedules, all-dark exclusions, mixed flowering/vegetative
  profiles, unusual rounded schedules, multiple windows and metadata-only changes.

## 0.3.0 - 2026-07-18

- Hardware-validate the current effective brightness scale against the SANlight app: `33.4%` in ioBroker is shown as the rounded value `34%` in the app.
- Stop exposing the low-level raw brightness value as an ioBroker object, automatically remove the former `state.liveBrightnessRaw` object, and retain the raw field internally for MQTT API v1 validation and compatibility.
- Add explicit per-lamp and all-lamp clock synchronization and arbitrary clock
  targets with paired seconds and `HH:MM:SS` inputs.
- Add a gateway-local clock snapshot and a no-Mesh `refreshInfo` control.
- Replace `state.lampTimeMs` with whole-second `state.lampClockSeconds`, keep
  `state.lampClock` at `HH:MM:SS`, and automatically remove the obsolete object.
- Keep clock values snapshot-based and require an explicit sync or apply action
  for every clock write; do not add periodic lamp polling.
- Accept additive `sync-clock`, `set-clock` and `refresh-gateway-info` commands
  within pre-stable MQTT API v1.
- Hardware-validate single-lamp and all-lamp refresh, synchronization and arbitrary targets, including invalid-input restoration and automatic one-shot control reset.
- Confirm that both validated lamp clocks restart at `00:00:00` after power restoration and can be recovered with one verified all-lamp synchronization.

## 0.2.0 - 2026-07-17

- Prepare the first public GitHub release and keep `package.json`,
  `package-lock.json`, `io-package.json` and ioBroker news on one validated
  version.
- Add release notes and a repeatable release checklist.
- Use community-gateway wording in package metadata to avoid presenting the
  integration as an official SANlight product.
- Add read-only ioBroker states for lamp time, current effective brightness with
  one-decimal resolution, validity and verification timestamp; keep them
  explicitly separate from configured MaxBrightness.
- Explicitly set `i18n: false` in the Admin JSON configuration because the
  current panel embeds its English labels directly and does not use external
  translation files; add a package validation guard for this schema
  requirement.
- Clarify that this is an unofficial community gateway integration, use
  SANlight only as a compatibility reference, and simplify the Admin host and
  emergency-blackout wording without changing stored settings.
- Complete the advanced MQTT layout by placing the topic prefix on its own row
  and the two timing controls side by side.
- Document the correct custom GitHub update path with `iobroker url` and clarify
  that repository-based `iobroker upgrade` cannot update this unreleased
  adapter.
- Restore Prettier formatting for the Admin JSON configuration and package
  metadata.
- Reorganize the Admin configuration into clear connection, optional TLS,
  advanced MQTT and safety sections without changing native setting keys or
  defaults; hide certificate settings until TLS is enabled.
- Refine npm discovery keywords and omit the maintainer-only `AI_CONTEXT.md`
  file from the published package.
- Simplify the public README and operational guide, separate required settings
  from advanced defaults, and remove maintainer-oriented material from the
  normal user path.
- Complete the first live end-to-end validation against the self-contained
  SANlight gateway and local Mosquitto topology.
- Confirm MQTT transport, gateway availability, MQTT API v1 compatibility,
  retained lamp state, read-only refresh and reversible writes on two real
  lamps.
- Replace internal build-environment package URLs in `package-lock.json` with
  the public npm registry and add a regression guard.
- Keep runtime TypeScript imports compatible with ioBroker's validated esbuild
  0.11.23 environment and add a regression guard.
- Add human-oriented installation, update and troubleshooting documentation.
- Ignore generated `build-test/` output.
- Run compiled unit tests through a cross-platform Node launcher so Windows on
  Node.js 20 does not depend on shell glob expansion.
- Upgrade GitHub Actions to the Node.js 24-based `checkout` and `setup-node`
  releases.
- Include formatting in the normal local `npm test` release gate.
- Replace the obsolete central-broker architecture image with the supported
  gateway-local Mosquitto topology.
- Keep runtime compatibility details in `AI_CONTEXT.md` and direct user-facing
  troubleshooting to redacted ChatGPT/GitHub Issue workflows.
- Document `localhost` as a valid broker host when ioBroker and the complete
  gateway are intentionally installed on the same Pi.

## 0.1.0 - 2026-07-15

- Add the first native ioBroker adapter for SANlight Mesh MQTT API v1.
- Isolate every adapter instance to one exact gateway ID.
- Add MQTT 5 subscriptions, retained topology/state ingestion and verified
  command/result correlation.
- Add structured gateway, lamp and command objects without permanent per-command
  object growth.
- Add requested-versus-verified brightness handling, bounded pending commands
  and slider debouncing.
- Keep explicit blackout disabled by default.
- Add Admin JSON configuration, protocol tests, CI, security guidance and
  AI-assisted support instructions.
