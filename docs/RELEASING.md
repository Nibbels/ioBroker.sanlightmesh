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
6. Create the annotated tag `v<version>` on the tested commit.
7. Create a GitHub release from the tag and paste the matching `docs/RELEASE_NOTES_<version>.md`.

Do not move, delete and recreate, or otherwise repoint a published release tag.
A later correction receives a new patch version.

## Installation sources

Current development branch:

```bash
iobroker url https://github.com/Nibbels/ioBroker.sanlightmesh --debug
```

Current immutable `v0.3.0` release after the tag is published:

```bash
iobroker url Nibbels/ioBroker.sanlightmesh#v0.3.0 sanlightmesh --debug
```

The normal repository-based `iobroker upgrade sanlightmesh` command remains unavailable until the adapter is accepted into an ioBroker repository.
