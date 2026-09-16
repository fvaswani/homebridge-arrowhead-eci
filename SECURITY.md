# Security

This experimental plugin connects to a local alarm interface. Only the current
prerelease is considered for fixes; there is no supported production release or
security audit claim.

## Reporting a vulnerability

Use the repository's **Security > Advisories > Report a vulnerability** option
if private reporting is available. If it is unavailable, open a public issue
asking the maintainer to arrange a private reporting channel, without including
the vulnerability details or exploit instructions. Do not post a PIN, private
configuration, raw control command, or unredacted network capture publicly.

Include affected versions, reproduction steps using synthetic credentials, the
impact, and any suggested fix in the private report.

## Deployment considerations

- Serial over IP uses plaintext. A control command sends the panel PIN over the
  local connection. The plugin does not add transport encryption.
- Keep the interface on a trusted local network. Never expose its serial TCP
  port, normally 9000, through internet port forwarding.
- Serial authentication is not supported by this release.
- Controls are off by default. Enable them only after validating status and
  sensors with the installer on a single-area panel.
- `pinEnvironment` keeps the PIN out of the Homebridge configuration, but the
  bridge process and its administrators still have access to it. If `pin` is
  used instead, restrict access to the configuration and its backups.
- Keep PINs out of logs, issue reports, screenshots, and repository commits.

Alarm control commands act on all panel areas, regardless of the configured
status area. Multi-area installations are unsupported. See the README's
acceptance checklist before using controls.
