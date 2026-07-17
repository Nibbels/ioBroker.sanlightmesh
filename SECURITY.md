# Security policy

## Supported development version

Only the current `main` branch is supported during the pre-1.0 development
phase.

## Security model

The adapter is an MQTT client. It does not store SANlight Mesh keys and does not
need filesystem, SSH or BlueZ access to the gateway host.

The documented gateway installer runs Mosquitto on the SANlight gateway Pi and
generates a dedicated ioBroker username/password restricted to one exact
gateway topic root. The adapter password is declared in both `encryptedNative`
and `protectedNative`.

Never print the password in logs, issue reports, screenshots or diagnostics.

The effective ioBroker ACL is limited to:

```text
read  sanlightmesh/v1/<gateway-id>/availability
read  sanlightmesh/v1/<gateway-id>/gateway/#
read  sanlightmesh/v1/<gateway-id>/nodes/#
read  sanlightmesh/v1/<gateway-id>/result/#
write sanlightmesh/v1/<gateway-id>/command
```

One adapter instance should use one broker account and one gateway ID. Do not
broaden subscriptions or ACLs merely to discover other gateways.

## Network boundary

The documented topology uses authenticated plain MQTT on port `1883` across a
trusted private LAN/VLAN. Username/password authentication does not encrypt
traffic.

- do not expose broker port `1883` to the internet;
- use a stable local gateway address or hostname;
- use TLS when traffic crosses an untrusted or routed network;
- treat TLS or shared-broker deployments as custom topologies requiring separate
  validation.

## Safe diagnostics

Safe information may include adapter/ioBroker/Node.js versions, the broker host
with password removed, gateway ID, topic prefix, health states and redacted
logs.

Never include:

- MQTT passwords;
- private `SANlightMesh.json`;
- NetKey, AppKey or DeviceKeys;
- gateway `.state/` contents;
- BlueZ tokens or `/var/lib/bluetooth/mesh` files;
- unredacted ioBroker configuration exports.

## Supply-chain checks

The committed `package-lock.json` must use the public npm registry and must not
contain private/internal build-environment URLs. Package validation enforces
this boundary.

## Reporting

Open a GitHub security advisory or contact the repository owner privately. Do
not put credentials or private Mesh material in a public issue.
