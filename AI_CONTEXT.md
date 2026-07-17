# AI continuation context — ioBroker.sanlightmesh

## Purpose

This repository implements the native ioBroker side of the two-repository
SANlight architecture.

- Gateway: `https://github.com/Nibbels/sanlight-mesh-mqtt-gateway`
- Adapter: `https://github.com/Nibbels/ioBroker.sanlightmesh`

The gateway owns Bluetooth Mesh, the private CDB, keys, BlueZ state, sequence
continuity, safety policy and verified lamp transactions. The adapter owns
ioBroker configuration, MQTT API v1 consumption, structured objects and
command/result presentation.

The supported product topology places Mosquitto on each SANlight gateway Pi.
The adapter connects to that Pi over the trusted LAN.

## Non-negotiable boundaries

1. One adapter instance manages exactly one configured gateway ID and broker
   connection.
2. Subscribe only below `sanlightmesh/v1/<gateway-id>`; never use a broad
   multi-gateway wildcard.
3. The adapter never reads the private CDB or any Mesh credential.
4. The adapter never talks to BlueZ, uses SSH or invokes gateway CLI commands.
5. Normal `set-max` remains `20..100`; zero exists only in explicit blackout.
6. Blackout is disabled by default and must use the gateway's confirmed workflow.
7. Reported brightness comes only from verified retained node state.
8. Do not create permanent ioBroker objects per command ID.
9. Missing topology nodes are marked absent/unavailable, not deleted.
10. The gateway remains the final safety authority.
11. The generic ioBroker MQTT adapter is not a runtime dependency.
12. Credentials for one gateway must not be reused to broaden access to another.

## MQTT API v1

Root:

```text
sanlightmesh/v1/<gateway-id>
```

Retained subscriptions:

- `availability`
- `gateway/info`
- `nodes/+/meta`
- `nodes/+/state`

Non-retained result subscription:

- `result/+`

Non-retained command publication:

- `command`

Actions:

- `refresh`
- `set-max`
- `blackout`
- `restore-blackout`

The client uses MQTT 5, a clean session, QoS 1 and exact subscriptions. Result
payload IDs must match result-topic IDs. Payload node addresses must match topic
addresses. Gateway information must match the configured gateway ID.

## Object design

- `info.*`: transport, availability and API health
- `gateway.info.*`: gateway identity and sequence health
- `gateway.control.*`: all-node operations
- `lamps.<ADDRESS>.info.*`: topology metadata
- `lamps.<ADDRESS>.state.*`: verified reports
- `lamps.<ADDRESS>.control.*`: requested targets/buttons
- `lamps.<ADDRESS>.command.*`: bounded last command status
- `commands.*`: bounded instance-wide command status

`info.connection` is true only when MQTT is connected, retained gateway
availability is online and MQTT API v1 is compatible.

## Runtime packaging and compatibility

The adapter is a TypeScript daemon adapter using `@iobroker/adapter-core` and
MQTT.js. `package.json` points `main` to `src/main.ts`; GitHub installations use
ioBroker js-controller's direct TypeScript runtime. Generated `build/` and
`build-test/` files are development artifacts and must not be committed.

The validated ioBroker host used:

- Node.js 22.15.0;
- npm 10.9.2;
- ioBroker runtime esbuild 0.11.23.

esbuild 0.11.23 cannot parse TypeScript 4.5 inline type-import specifiers in
runtime source. Keep runtime imports compatible:

```ts
import value from 'module';
import type { SomeType } from 'module';
```

Do not use:

```ts
import value, { type SomeType } from 'module';
```

`scripts/validate-package.mjs` contains a regression guard for this constraint.
Do not remove it unless the minimum supported ioBroker runtime is deliberately
raised and validated.

The committed `package-lock.json` must resolve through the public npm registry.
Never commit internal CI/AI/build-environment registry URLs. Package validation
contains a regression guard for known internal registry patterns.

## Instance and credential model

The gateway installer generates one ioBroker MQTT user restricted to one exact
gateway topic root. The adapter stores that password in both `encryptedNative`
and `protectedNative` configuration metadata.

Reference settings:

- broker host: stable IP/hostname of the gateway Pi;
- broker port: `1883`;
- TLS: disabled for the documented trusted-LAN topology;
- topic prefix: `sanlightmesh/v1`;
- gateway ID: exact installer value;
- command TTL: 30 seconds;
- brightness debounce: 1000 ms;
- blackout disabled initially.

A second physical gateway uses a second adapter instance, broker connection,
gateway ID and credential set.

## Validation status

Live end-to-end validation completed on 2026-07-16:

- adapter installed from GitHub on the Raspberry Pi 4 ioBroker host;
- the original lockfile installation failure was traced to internal npm registry
  URLs, corrected to `registry.npmjs.org` and guarded by package validation;
- the first runtime start exposed the old-esbuild inline-type-import parse error,
  corrected with standalone `import type` statements and guarded by validation;
- adapter connected to the separate Raspberry Pi 3 SANlight gateway's local
  Mosquitto broker;
- `mqttConnected`, `gatewayOnline`, `protocolCompatible` and `connection` became
  true;
- two lamp object trees were created and verified state was received;
- a read-only refresh completed with status `verified`;
- node `0002` was independently mapped to the SANlight app lamp “Links”;
- node `0003` was independently mapped to “Rechts”;
- both lamps accepted reversible 68% -> 67% -> 68% MaxBrightness changes with
  verified gateway readback and independent app confirmation.

The test suite passed TypeScript checking, eight protocol tests and package
metadata validation. The percentages and addresses belong only to the reference
installation.

## Development and release checks

Before committing:

```bash
npm ci
npm test
npm run format:check
```

After tests, remove or ignore generated `build-test/` output. Check:

```bash
git status --short
git diff --check
```

Before a GitHub installation test, verify that the lockfile contains no internal
registry URLs. Test through ioBroker Admin's **Install from custom URL** flow,
create/update an instance, and confirm all four health states.

Keep maintenance proportional to adoption. Do not add a cloud backend, bundled
broker, SSH control, containers, committed build output or a complex frontend
without demonstrated need.

## Documentation boundary

- `README.md`: human-oriented overview, installation and first safe test
- `INSTRUCTIONS.md`: operation, updates and troubleshooting
- `docs/OBJECT_MODEL.md`: state/object details
- `docs/CHATGPT_SUPPORT.md`: safe support workflow
- `SECURITY.md`: credential and network boundaries
- `AI_CONTEXT.md`: implementation invariants and validation history

## Development and release invariants

- `npm test` is the complete local release gate and includes TypeScript, unit,
  package-metadata and Prettier checks.
- Unit tests must be launched through `scripts/run-unit-tests.mjs`; shell globs
  are not portable to Windows with Node.js 20.
- GitHub workflows use `actions/checkout@v5` and `actions/setup-node@v5` to
  avoid deprecated Node.js 20 action runtimes.
