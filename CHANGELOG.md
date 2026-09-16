# Changelog

## 0.1.0-alpha.2

- Add opt-in `sparseStatus` startup inference after an acknowledged five-second,
  area-qualified collection window. Default remains explicit-event monitoring.
- Keep unchanged readings while qualified status replies continue; invalidate
  the connection when replies stop even if unrelated sensor events continue.
- Handle area alarm and restore events independently from armed state.
- Validate owner-operated away arm/disarm transitions and reconnects in both
  states on EC-i firmware 10.3.61. Plugin-issued controls remain untested.
- Add regressions for incomplete dumps, wrong areas, armed reconnects, active
  alarms, exit delays and idle monitoring.

- Wait one second after a TCP connection before MODE 4 negotiation. A live EC-i
  module discarded commands sent immediately while its welcome phase completed.
- Cancel the pending handshake when the client stops or disconnects.
- Add regression tests for delayed module readiness and stopping during startup.
- Document partial firmware 10.3.61 hardware results and sparse status limitations. Monitoring is running on one HOOBS 5.1.8 installation; Apple Home pairing and
  plugin-issued controls remain pending.

## 0.1.0-alpha.1

Initial experimental release.

- Native Homebridge platform for Arrowhead EC-i panels with local Serial over IP
  networking, such as an EC-IoT module, without Home Assistant.
- MODE 4 negotiation, panel status, reconnect handling, and stale-state handling.
- HomeKit security-system accessory and up to 148 manually configured
  motion/contact zones, subject to the shared bridge accessory budget.
- Optional away, stay/home, and disarm controls, disabled by default.
- Single-area scope, with explicit documentation that commands affect all areas.
- Local TCP simulator and Homebridge HAP validation approach.
- MIT licensing with upstream attribution and preserved license notice.

No real panel or live HOOBS installation has been validated. Firmware
10.3.61 and EliteCloud coexistence remain untested. Distribution is a manual
prerelease tarball; npm registry publication is pending.
