# Releasing the adapter

The adapter is installed directly from GitHub and is not yet part of an ioBroker repository. A GitHub release therefore provides an immutable, reviewable source revision but does not make `iobroker upgrade` available.

## Release checklist

1. Confirm the gateway and adapter use the intended MQTT API version.
2. Confirm `package.json`, `package-lock.json` and `io-package.json` contain the same version.
3. Run:

    ```bash
    npm ci
    npm test
    npm run build
    ```

4. Confirm GitHub Actions is green on the exact release commit.
5. Update a real instance from that commit and verify:
    - MQTT connection;
    - gateway availability and protocol compatibility;
    - one read-only lamp refresh;
    - live-output states;
    - no Admin schema warning.
6. Create the annotated tag `v0.2.0` on the tested commit.
7. Create a GitHub release from the tag and paste `docs/RELEASE_NOTES_0.2.0.md`.

Do not move or recreate a published release tag. A later correction receives a new patch version.

## Installation sources

Current development branch:

```bash
iobroker url https://github.com/Nibbels/ioBroker.sanlightmesh --debug
```

Immutable `v0.2.0` release after the tag is published:

```bash
iobroker url Nibbels/ioBroker.sanlightmesh#v0.2.0 sanlightmesh --debug
```

The normal repository-based `iobroker upgrade sanlightmesh` command remains unavailable until the adapter is accepted into an ioBroker repository.
