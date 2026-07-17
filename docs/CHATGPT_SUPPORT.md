# Safe ChatGPT support context

This file may be copied into a ChatGPT conversation when installing or
troubleshooting `ioBroker.sanlightmesh`.

## Architecture

- The SANlight gateway Pi owns BlueZ, Mesh credentials, sequence state and the
  local Mosquitto broker.
- The ioBroker adapter connects only to that broker over the LAN.
- One adapter instance manages exactly one configured gateway ID.
- The adapter never needs SSH access, a private CDB, NetKey, AppKey, DeviceKey or
  BlueZ token.

## Support workflow

1. Work one diagnostic step at a time.
2. Start with read-only checks.
3. Never ask the user to publish a retained MQTT command.
4. Never request or print MQTT passwords or Mesh keys.
5. Never use brightness or clock writes to diagnose installation.
6. Normal brightness commands must stay within `20..100`.
7. Do not use blackout unless the user explicitly requests a controlled test.
8. Never replace the configured gateway ID with `+` or `#` subscriptions.
9. Distinguish adapter startup/parser failures from MQTT authentication failures.
10. Prefer a read-only `control.refresh` test before any reversible write.

## Initial diagnostic sequence

Check, in order:

1. `sanlightmesh.<instance>.info.mqttConnected`
2. `sanlightmesh.<instance>.info.gatewayOnline`
3. `sanlightmesh.<instance>.info.protocolCompatible`
4. `sanlightmesh.<instance>.info.connection`
5. `sanlightmesh.<instance>.info.lastError`
6. configured broker host, port, TLS setting, topic prefix and gateway ID
7. retained `lamps.<address>.state.*`
8. one read-only `lamps.<address>.control.refresh`

Interpretation:

- adapter repeatedly exits before logging an MQTT connection attempt: inspect a
  runtime/parser/package error;
- `mqttConnected=false`: investigate host, port, TLS, credentials and broker ACL;
- MQTT connected but gateway offline: run `sanlight-gateway doctor` on the
  gateway Pi;
- protocol incompatible: compare gateway ID and MQTT API major version;
- lamp state missing with healthy connection: inspect retained topology/state and
  run one read-only refresh.

## Known compatibility invariants

The validated ioBroker host used Node.js 22.15.0 and esbuild 0.11.23. Runtime
TypeScript source must use standalone `import type` statements rather than
inline `import { type X }` syntax.

The committed lockfile must use `https://registry.npmjs.org/` and must not
contain internal build-environment registry URLs.

## Safe information to share

- adapter version and instance number;
- ioBroker, js-controller and Node.js versions;
- configured broker hostname/IP with password removed;
- configured gateway ID and topic prefix;
- `info.*`, `gateway.info.*` and lamp metadata/state objects;
- redacted adapter logs;
- redacted gateway diagnostics from `sanlight-gateway collect-diagnostics`.

## Never share

- MQTT passwords;
- private `SANlightMesh.json`;
- NetKey, AppKey or DeviceKey values;
- gateway `.state/` contents;
- BlueZ attach/join tokens;
- `/var/lib/bluetooth/mesh` files;
- full ioBroker configuration objects containing encrypted native values.

The goal is to identify whether a problem is package/runtime compatibility,
configuration, broker authentication/ACL, gateway availability, protocol
compatibility, topology or command execution before changing anything.
