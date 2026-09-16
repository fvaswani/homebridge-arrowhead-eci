# homebridge-arrowhead-eci

Expose an Arrowhead EC-i alarm panel to Apple Home using Homebridge and local
Serial over IP networking, such as an EC-IoT network module. Configured zones
appear as motion or contact sensors. No Home Assistant, cloud account, or Python
runtime is required.

**Experimental. The first hardware test found incomplete startup status reporting.**
The published 0.1.0-alpha.1 package also needs a connection startup timing fix.
HOOBS is an intended target, but this release has not been certified or verified
on a live HOOBS installation. It is not listed in the npm registry or claimed to
be available in the HOOBS plugin catalog.

## Supported scope

- A **single-area EC-i installation only**, with a Serial over IP network
  interface, such as an EC-IoT module, on the local network.
- Serial over IP enabled by the installer, with MODE 4 available. The plugin
  negotiates MODE 4 when it connects. Serial authentication is not supported.
- Node.js 20 or later and Homebridge 1.8.4 or later, below version 3.
- Manually configured zone numbers and names, with `motion` or `contact` types.
  At most 148 zones may be configured; start with fewer installer-selected zones.
- Panel status, away arming, stay/home arming, disarming, and zone activity.
  Alarm controls are disabled by default.

The upstream integration describes firmware 10.3.50 and later. That is an
upstream compatibility statement, not hardware validation for this plugin.
A partial monitoring test on firmware 10.3.61 confirmed MODE 4 and live zone
events, but did not validate complete startup state. See [hardware validation](docs/hardware-validation.md).

**Arm and disarm commands affect the whole panel and all its areas.** Setting
`area` chooses the area whose status is observed; it does not restrict commands
to that area. Do not enable this plugin on a multi-area installation.

## Validation status

The automated tests cover the TCP protocol, actual Homebridge HAP services,
and an end-to-end simulator connection. They pass with Homebridge 1.8.4 on Node
20 and Homebridge 2.4.0 on Node 22 and 24. Both Homebridge versions also load and
register the packaged platform in an isolated startup check. These are software
checks, not real EC-i panel, Apple Home pairing, or live HOOBS acceptance tests.

## Before connecting

Ask your alarm installer to confirm the installation has one area, enable
Serial over IP, and confirm MODE 4 is available. Confirm the panel address,
TCP port, area number, and zone numbers with them. If serial authentication is
required by your setup, this release is unsuitable.

Adding a host and starting the platform opens a local TCP connection, negotiates
MODE 4, and requests status. The plugin sends no automatic arm or disarm command
at startup. Begin with `enableControl: false` while checking status and sensors.

The serial connection is unencrypted. When controls are enabled, the panel PIN
travels over this local connection in plaintext. Keep it on a trusted network,
and never forward TCP port 9000, or a replacement serial port, to the internet.

## Installation

This prerelease is distributed as a package tarball for manual installation.
It has **not been published to npm**, so installing by package name from the npm
registry will not work yet.

1. Download `homebridge-arrowhead-eci-0.1.0-alpha.1.tgz` from the
   [GitHub releases page](https://github.com/fvaswani/homebridge-arrowhead-eci/releases).
2. Install the downloaded file into the environment running your Homebridge
   instance. For a standard global Homebridge installation, use:

   ```sh
   npm install -g /absolute/path/to/homebridge-arrowhead-eci-0.1.0-alpha.1.tgz
   ```

3. Add the platform configuration below, replace the example address, and restart
   that Homebridge instance.
4. Add or open the Homebridge bridge in Apple Home to view the alarm and zones.

For HOOBS, use the manual package installation process appropriate to your
installed HOOBS version and bridge. A global npm installation may not target a
HOOBS-managed bridge. This release does not claim a tested HOOBS installer path
or catalog entry.

## Configuration

Merge this platform into your existing `platforms` array. `192.0.2.10` is a
placeholder address. Use your network module's local address and your actual zone
numbers. The environment variable is only needed if you later enable controls.

```json
{
  "platforms": [
    {
      "platform": "ArrowheadECi",
      "name": "Arrowhead Alarm",
      "host": "192.0.2.10",
      "port": 9000,
      "area": 1,
      "enableControl": false,
      "userNumber": 1,
      "pinEnvironment": "ARROWHEAD_PIN",
      "zones": [
        { "id": 1, "name": "Hallway", "type": "motion" }
      ]
    }
  ]
}
```

| Setting | Purpose |
| --- | --- |
| `platform` | Must be `ArrowheadECi`. |
| `name` | Display name for the alarm accessory. |
| `host` | Local address of the Serial over IP interface, such as the EC-IoT module. Configuring it starts a connection when Homebridge starts. |
| `port` | Serial over IP TCP port, normally `9000`. |
| `area` | Area to observe, normally `1`. It does not limit the scope of alarm commands. |
| `enableControl` | Defaults to `false`. Enables user-requested arm and disarm commands when `true`. |
| `userNumber` | Panel user number used for controls. |
| `pinEnvironment` | Name of the environment variable containing the panel PIN. |
| `pin` | Alternative PIN in configuration. Use this or `pinEnvironment`, never both. |
| `zones` | Up to 148 zones. Each entry has its actual numeric `id`, a `name`, and `type` of `motion` or `contact`. |

The 148-zone limit reserves room for the bridge and alarm accessory within the
HomeKit bridge accessory budget. Other accessories on the same bridge also use
that budget, so configure fewer zones where appropriate and start with the
ones your installer recommends.

Credentials are required only when `enableControl` is `true`. To enable controls,
set the `ARROWHEAD_PIN` variable in the environment of the process that runs your
bridge, and set `enableControl` to `true`. A variable set in an interactive shell
may not reach a background service. Alternatively, remove `pinEnvironment` and
supply `pin` as a string in the configuration. Treat the configuration as
sensitive if it contains a PIN, and never include it in a public issue.

HomeKit does not provide a separate read-only security-system accessory type.
With controls disabled, Apple Home may still display alarm buttons; the plugin
rejects those requests. Read-only operation still connects to the panel and
requests status.

## How state and controls behave

The alarm accessory reports confirmed panel state. Away and home/stay targets
send the corresponding panel request when controls are enabled; disarm sends a
disarm request. A command acknowledgement means the request was accepted, not
that arming or disarming has completed. The current state changes only when the
panel reports it. Night arming is not supported in this initial scope.

Unknown or stale state produces a HomeKit communication error. A disconnected
panel is not assumed to be disarmed, and an unknown zone is not assumed to be
clear. The plugin reconnects after network loss, clears stale state, and obtains
fresh status. It never replays a previous arm or disarm command after reconnect.

Motion zones map to HomeKit motion sensors; contact zones map to contact sensors.
Use the correct type and verify the active/clear behavior against the physical
zone during installation.

## Installer acceptance checklist

Complete this with the installer before relying on the integration. Automated
simulator checks cannot establish real panel compatibility.

- [ ] Confirm one area only, supported connection settings, and the correct zone
  mapping. Leave controls disabled.
- [ ] Compare Apple Home's status with the keypad while the system is disarmed,
  then while armed through the keypad.
- [ ] Walk-test every configured PIR and open/close every configured contact.
  Check both active and clear states, names, and zone numbers.
- [ ] If controls are wanted, configure a suitable panel user and enable them.
  In an agreed test window, verify away arming, stay/home arming, and disarming.
- [ ] Check entry and exit delays. Confirm Apple Home reflects actual panel
  state throughout those delays and after completion.
- [ ] Test alarm indication and clearing under the installer's agreed test
  procedure, accounting for any monitoring service.
- [ ] Interrupt and restore the network connection. Confirm unavailable state
  during the outage, fresh status after recovery, and no repeated alarm command.
- [ ] Restart the bridge and verify status recovery with no automatic arm/disarm.
- [ ] If EliteCloud is used, verify its status and controls still work while the
  plugin is connected, and repeat after reconnecting. Coexistence is unverified.

Retain the keypad and existing alarm controls as the operational reference while
evaluating this prerelease.

## Troubleshooting and reports

If accessories show no response, confirm the local address, Serial over IP port,
MODE 4 availability, single-area configuration, and network reachability. If
status works but controls fail, check `enableControl`, the panel user number,
and the PIN source. Do not enable serial authentication to troubleshoot this
plugin; authenticated serial sessions are not supported.

Report reproducible issues at
[GitHub Issues](https://github.com/fvaswani/homebridge-arrowhead-eci/issues).
Include plugin, Node.js, Homebridge or HOOBS, EC-i panel, and network-module
(such as EC-IoT) firmware versions, plus a redacted configuration and the
observed sequence. Omit PINs, raw serial commands, and unredacted packet captures. See [SECURITY.md](SECURITY.md) for
private security reporting and [CONTRIBUTING.md](CONTRIBUTING.md) for development.

## Credits and license

MIT licensed. Protocol behavior was informed by
[Thanos Kasolas's Arrowhead Home Assistant integration](https://github.com/thanoskas/arrowhead_alarm)
at commit `0dd21b597ed557b7aca8b94afd7bb05d70469b87`.
See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the
preserved upstream copyright and license. This is an independent community
project with no claimed endorsement by Arrowhead, HOOBS, or the upstream author.
