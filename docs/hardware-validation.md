# Partial hardware validation

Test date: 2026-09-16. EC-i firmware 10.3.61 with an EC-IoT module.

These observations describe the alpha.2-based pilot and its documented local
changes. Alpha.3 packages subsequent fixes and artwork; preparing that release
does not constitute a new hardware acceptance test.

## Confirmed on hardware

- TCP port 9000 became reachable after the owner restarted the alarm following
  enabling Serial over IP.
- Waiting one second before MODE 4 negotiation works; immediate commands were
  discarded during the module's Welcome phase.
- `DEVICE ?` reports virtual keypad 32. Its web settings assign only Area 1,
  with away/stay arm and disarm permissions enabled. No settings were changed.
- Three configured motion zones each emitted ZO and ZC events during movement.
- Disarmed STATUS: `OK Status`, `RO1` or `NR1`, `AR1`, and any open zones.
  No explicit D1 or closed-zone messages were returned.
- Away-armed STATUS additionally reports `A1-U<user>`.
- Owner-operated away arm emitted EDA1-30 then A1; disarm emitted D1.
- An armed reconnect cleared cached state to unknown then restored away armed;
  the five-second collection window did not replace armed with disarmed.
- A disarmed reconnect initialized disarmed and three closed zones after the
  acknowledged, area-qualified five-second collection window.
- The test client sent only MODE 4 and status requests during the supervised
  arm/disarm test. All physical arm/disarm actions were performed by the owner.

## HOOBS monitoring pilot

- Dedicated bridge installed on HOOBS 5.1.8, Homebridge 1.8.4 and Node 20.19.1.
- Plugin 0.1.0-alpha.2 loaded and established its TCP connection from the HOOBS
  LAN interface. Controls disabled, sparse status enabled, no alarm PIN stored.
- HOOBS displayed the alarm as Disarmed and exposed all three motion zones.
- Existing bridge records were unchanged and their processes remained running.
- Idle monitoring remained connected beyond the previous 90-second expiry.
- The owner completed Apple Home pairing and supplied screenshots of the alarm
  and motion accessories. Room assignment and motion reset in Apple Home still
  need user verification.
- The HOOBS visual configuration form was verified after a local client-only
  catalogue fallback. Its PIN field requires the explicit password widget
  included in alpha.3; the alpha.2 tarball predates this schema fix.

## Supervised Apple Home controls

After the owner privately configured the PIN and confirmed the alarm user
number, controls were enabled on the dedicated bridge. The owner confirmed the
alarm was disarmed, everyone was clear of the sensors, and the keypad/app was
available for fallback.

- The owner selected Away in Apple Home. The plugin logged command acceptance
  at 22:43:52 NZST. HomeKit retained current Off while target became Away during
  the exit countdown, then current and target both became Away at 22:44:22.
- The owner confirmed Apple Home and the keypad/Elite app both showed armed.
- The owner selected Off in Apple Home. The plugin logged command acceptance
  at 22:44:46; current and target both became Off at 22:44:48.
- The owner confirmed both interfaces showed disarmed. Communication fault
  remained clear throughout. Controls were left enabled after the test.
- In a further Home/Stay arm, target became Home at 22:45:30, followed by
  confirmed current Home at 22:45:58 after the exit countdown. The owner
  confirmed Stay mode in the keypad/app, then disarmed there. Current and
  target both returned Off at 22:46:44.

The observer read the running bridge's HomeKit status and filtered command logs.
It did not send arm/disarm commands itself. These results validate one supervised
Away/Off cycle and a Home/Stay arm on this panel, not other panels or firmware.

## Interpretation and limits

AR1 is area alarm restored, not disarmed. RO1 is ready, not disarmed. An opt-in
`sparseStatus` setting uses an independently implemented collection-window
heuristic informed by the openHAB integration. It requires an ACK and matching
area readiness and alarm reports before initializing missing startup readings.
Observed armed/open/alarm/exit-delay readings take precedence. The default remains
explicit-event monitoring. Qualified polls keep unchanged readings available;
missing polls invalidate the connection even when unrelated events arrive.

There is no documented MODE 4 end-of-dump marker, so a truncated but partly valid
reply remains a limitation. This is not manufacturer-certified synchronization.
Real alarm/siren events, tamper and battery states remain unvalidated.

## References

- [AAP serial protocol reference](https://www.aap.co.nz/site/aap/ECi_Serial_Protocol_Ver_10_2_441.pdf)
- [Upstream integration](https://github.com/thanoskas/arrowhead_alarm)
- [openHAB sparse-status observations](https://github.com/glenm-nz/openhab-addons/blob/elitealarm/bundles/org.openhab.binding.elitealarm/SPECIFICATION.md#state-synchronization)
