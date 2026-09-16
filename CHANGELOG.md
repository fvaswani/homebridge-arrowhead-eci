# Changelog

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
