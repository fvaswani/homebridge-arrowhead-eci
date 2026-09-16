# Partial hardware validation

Test date: 2026-09-16. EC-i firmware 10.3.61 with an EC-IoT module.

## Confirmed

- TCP port 9000 became reachable after the owner restarted the alarm following
  enabling Serial over IP.
- Sending MODE 4 immediately after connecting produced only the Welcome banner.
  Waiting one second, as the upstream client does, produced OK MODE 4.
- STATUS produced OK Status, area-ready/not-ready messages, and AR1.
- Three configured motion zones each emitted ZO and ZC events during movement.
- No arm, disarm, bypass, output-control, or programming commands were sent.

## Unresolved acceptance criteria

During this observation, repeated STATUS requests did not include explicit
D1/A1/S1 state or closed-zone snapshots. AR1 means the area is no longer in
alarm; it does not establish whether the area is armed or disarmed. Likewise,
RO1 (ready/sealed) is not a disarmed indication.

The plugin intentionally keeps missing values unknown. Current freshness
handling also expires individual readings when the panel does not repeat them.
Reliable initial state and idle-state refresh therefore remain unresolved.
Do not interpret the successful TCP connection or zone transitions as complete
alarm integration acceptance. HOOBS installation, Apple Home pairing, alarm
state transitions, and alarm controls have not been validated on this hardware.

The public serial protocol reference predates MODE 4. Its status descriptions
cannot establish how a complete MODE 4 snapshot should be delimited or how
omitted values should be interpreted on firmware 10.3.61. Obtain a current
protocol specification or an explicit supported status query before inferring
safe state from absent events.

References:
- [AAP serial protocol reference](https://www.aap.co.nz/site/aap/ECi_Serial_Protocol_Ver_10_2_441.pdf)
- [Upstream integration](https://github.com/thanoskas/arrowhead_alarm)
