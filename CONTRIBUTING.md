# Contributing

This is an experimental native Homebridge plugin for single-area Arrowhead EC-i
installations with Serial over IP networking, such as an EC-IoT module. Real
hardware testing is needed before making compatibility
claims. Please open an issue describing a proposed feature or a reproducible
problem before a substantial change.

## Development

Use Node.js 20 or later and a compatible Homebridge release, at least 1.8.4 and
below version 3. Clone the repository, install development dependencies, and run
the checks defined in `package.json`. The plugin uses CommonJS and has no
production package dependencies.

Keep protocol parsing and TCP connection handling separate from the Homebridge
adapter. Use a local TCP simulator for protocol tests and the actual Homebridge
HAP API for accessory behavior tests. Development checks must not require a
live alarm or real credentials.

Changes should preserve these properties:

- Controls stay disabled unless explicitly enabled with valid credentials.
- No arm or disarm command is sent on startup or replayed after reconnect.
- Unknown, disconnected, or stale state never becomes a false disarmed or clear
  reading.
- Acknowledgement and confirmed panel state remain separate.
- Real PINs and commands containing real credentials never appear in logs, test fixtures, or reports. Tests use synthetic credentials only.
- The whole-panel scope of control commands is explicit. Multi-area control is
  outside this release's supported scope.

Add focused regression coverage for behavioral changes. In pull requests,
explain the problem, resulting behavior, checks performed, and any hardware
validation separately. Identify EC-i panel and network-module firmware versions
when reporting hardware results. Do not describe simulator success as physical-device testing.

## Issue reports

Include version information, a minimal redacted configuration, expected and
observed behavior, and reproduction steps. Include whether the issue occurs
with controls disabled. Never share a real PIN or a raw serial capture containing
credentials. Security issues should follow [SECURITY.md](SECURITY.md).

## License and attribution

Contributions are offered under the repository's MIT license. Preserve upstream
copyright and permission notices, and identify any new third-party source used.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
