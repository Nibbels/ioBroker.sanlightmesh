# ioBroker.sanlightmesh 0.2.0

This is the first public GitHub release of the independent community adapter for the MQTT gateway for SANlight Mesh. It remains pre-1.0 and is installed from GitHub rather than an ioBroker repository.

## Highlights

- Native ioBroker device and state model for one exact gateway instance.
- Verified MaxBrightness read/write workflow with requested and confirmed values kept separate.
- Read-only current effective brightness with one-decimal resolution, plus lamp time and verification timestamp.
- Automatic removal of the obsolete raw-value ioBroker object while retaining MQTT API v1 compatibility.
- Clear connection, optional TLS, advanced MQTT and emergency-blackout sections in the Admin panel.
- MQTT API v1 compatibility checks, retained state ingestion and bounded command correlation.
- Multi-instance isolation for independent gateways.
- Cross-platform tests on Node.js 20, 22 and 24.

## Compatibility

Use with `sanlight-mesh-mqtt-gateway v0.2.0`. The MQTT contract remains API v1 and the live-output fields are additive.

## Important limitations

- Hardware comparison confirmed that `33.4%` in ioBroker corresponds to the SANlight app's rounded `34%` display. The value is still not calibrated watts, photon flux or PPFD.
- Emergency blackout remains disabled by default and requires the protected gateway workflow.
- Repository-based `iobroker upgrade` is unavailable because the adapter is not yet published in an ioBroker repository.
