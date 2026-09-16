'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: sleep } = require('node:timers/promises');
const { ArrowheadClient } = require('../src/client');

async function until(predicate, timeout = 1500) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) assert.fail('Timed out waiting for simulated panel state');
    await sleep(5);
  }
}

async function simulator(t, handler, options = {}) {
  const sockets = [];
  const lines = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.on('error', () => {});
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', data => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        lines.push({ line, connection: sockets.indexOf(socket) });
        handler(line, socket, sockets.length);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new ArrowheadClient({ host: '127.0.0.1', port: server.address().port,
    commandTimeoutMs: 150, reconnectDelayMs: 30, heartbeatMs: 1000,
    staleTimeoutMs: 3000, connectSettleMs: 10, snapshotWindowMs: 30, ...options });
  t.after(async () => {
    client.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  client.start();
  return { client, sockets, lines };
}

function normalHandshake(line, socket) {
  if (line === 'MODE 4') socket.write('OK MODE 4\r\n');
  else if (line === 'STATUS') socket.write('OK Status\nRO1\nAR1\nD1\nZC001\nBR\nTR\nMR\n');
}

test('validates network and timing configuration without leaking values', () => {
  for (const host of ['', 'bad\nSTATUS', 'example..com', '-bad.local', 'a'.repeat(64) + '.local', 'https://host']) {
    assert.throws(() => new ArrowheadClient({ host }), { message: 'Invalid host' });
  }
  for (const options of [{ port: 0 }, { port: '9000' }, { port: 65536 }, { area: 33 },
    { commandTimeoutMs: 0 }, { heartbeatMs: Infinity }, { reconnectDelayMs: -1 }]) {
    assert.throws(() => new ArrowheadClient({ host: 'localhost', ...options }));
  }
  for (const host of ['localhost', 'panel.local', '192.0.2.1', '::1']) {
    assert.equal(new ArrowheadClient({ host }).state.mode, 'unknown');
  }
});

test('fragmented CRLF mode negotiation and STATUS populate only observed states', async t => {
  const { client, lines } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') {
      socket.write('OK MO');
      setTimeout(() => socket.write('DE 4\r'), 5);
      setTimeout(() => socket.write('\n'), 10);
    } else if (line === 'STATUS') {
      socket.write('D1-U1\r\nZO0');
      setTimeout(() => socket.write('01\nZC002\nBF\nTA\nMF\n'), 5);
    }
  });
  await until(() => client.state.zones.size === 2);
  assert.equal(client.connected, true);
  assert.equal(client.state.mode, 'disarmed');
  assert.equal(client.state.zones.get(1), true);
  assert.equal(client.state.zones.get(2), false);
  assert.equal(client.state.zones.has(3), false);
  assert.equal(client.state.batteryLow, true);
  assert.equal(client.state.tamper, true);
  assert.equal(client.state.mainsFault, true);
  assert.deepEqual(lines.slice(0, 2).map(record => record.line), ['MODE 4', 'STATUS']);
});

test('availability after MODE success does not invent disarmed or sensor state', async t => {
  const { client } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK\n');
  });
  await until(() => client.connected);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.batteryLow, null);
  assert.equal(client.state.zones.size, 0);
  await assert.rejects(client.control('away'), /unavailable/);
});

test('interleaved events never acknowledge controls and ACK never arms the panel', async t => {
  let armSocket;
  const { client } = await simulator(t, (line, socket) => {
    normalHandshake(line, socket);
    if (line === 'ARMAWAY') {
      armSocket = socket;
      socket.write('ZO002\nEDA1-30\nOK STATUS\nOK\n');
    }
  });
  await until(() => client.state.mode === 'disarmed');
  let completed = false;
  const request = client.control('away').then(() => { completed = true; });
  await until(() => client.state.pending === 'away');
  assert.equal(completed, false);
  assert.equal(client.state.mode, 'disarmed');
  armSocket.write('OK ArmAway\n');
  await request;
  assert.equal(client.state.mode, 'disarmed');
  assert.equal(client.state.pending, 'away');
  armSocket.write('A1-U4\n');
  await until(() => client.state.mode === 'away');
  assert.equal(client.state.pending, null);
});

test('serializes controls and accepts confirmed stay and disarm state independently', async t => {
  let armSocket;
  const { client, lines } = await simulator(t, (line, socket) => {
    normalHandshake(line, socket);
    if (line === 'ARMSTAY') armSocket = socket;
    if (line.startsWith('DISARM')) socket.write('OK Disarm\n');
  });
  await until(() => client.state.mode === 'disarmed');
  const first = client.control('home');
  const second = client.control('disarmed', 1, '1234');
  await until(() => armSocket);
  assert.equal(lines.filter(r => r.line.startsWith('DISARM')).length, 0);
  armSocket.write('EDS1-30\nS1\nOK ArmStay\n');
  await Promise.all([first, second]);
  assert.equal(client.state.mode, 'home');
  assert.equal(client.state.pending, null);
  assert.equal(lines.at(-1).line, 'DISARM 1 1234');
  armSocket.write('D1-U1\n');
  await until(() => client.state.mode === 'disarmed');
});

test('alarm restores track all active zones; disarm clears active alarms', async t => {
  const { client, sockets } = await simulator(t, normalHandshake);
  await until(() => client.state.mode === 'disarmed');
  sockets[0].write('ZA001\nZA002\nZR001\n');
  await until(() => client.state.alarm);
  assert.equal(client.state.alarm, true);
  sockets[0].write('ZR002\n');
  await until(() => !client.state.alarm);
  sockets[0].write('ZA003\n');
  await until(() => client.state.alarm);
  sockets[0].write('D1\n');
  await until(() => !client.state.alarm);
  sockets[0].write('BR\nTR\nMR\nconstructor\n__proto__\nZO999\nA2\n');
  await sleep(20);
  assert.equal(client.state.mode, 'disarmed');
  assert.equal(client.state.zones.has(999), false);
  assert.equal(Object.hasOwn(client.state, 'undefined'), false);
  assert.equal(client.state.batteryLow, false);
});

test('rejects newline injection, malformed credentials and unsupported targets before writing', async t => {
  const { client, lines } = await simulator(t, normalHandshake);
  await until(() => client.state.mode === 'disarmed');
  const before = lines.length;
  for (const args of [['away\nDISARM'], ['disarmed'], ['disarmed', 0, '1234'],
    ['disarmed', '1', '1234'], ['disarmed', 2001, '1234'],
    ['disarmed', 1, '1234\nARMAWAY'], ['disarmed', 1, 1234], ['away', 1, 'bad']]) {
    await assert.rejects(client.control(...args));
  }
  assert.equal(lines.length, before);
});

test('MODE rejection or unsolicited state cannot establish a ready session', async t => {
  const { client, lines } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('D1\nZO001\nOK ArmAway\nERR 2\n');
  });
  await until(() => lines.length >= 2);
  assert.equal(client.connected, false);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(lines.some(record => record.line === 'STATUS'), false);
  await assert.rejects(client.control('away'), /unavailable/);
});

test('control timeout closes connection, rejects queued commands, resets state and never replays', async t => {
  let firstSocket;
  const { client, sockets, lines } = await simulator(t, (line, socket, connection) => {
    if (line === 'MODE 4') socket.write('MODE 4\n');
    if (line === 'STATUS' && connection === 1) socket.write('A1\nZO001\nBF\nTA\nMF\n');
    if (line === 'ARMAWAY') firstSocket = socket;
  }, { commandTimeoutMs: 60 });
  await until(() => client.state.mode === 'away');
  const first = client.control('away');
  const second = client.control('disarmed', 1, '9876');
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.ok(results.every(result => !result.reason.message.includes('9876')));
  await until(() => sockets.length >= 2 && client.connected);
  assert.equal(firstSocket.destroyed, true);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
  assert.equal(client.state.batteryLow, null);
  assert.equal(client.state.tamper, null);
  assert.equal(client.state.mainsFault, null);
  assert.equal(lines.filter(r => r.line === 'ARMAWAY').length, 1);
  assert.equal(lines.filter(r => r.line.startsWith('DISARM')).length, 0);
});

test('queue wait consumes the command deadline and expired controls are never sent or replayed', async t => {
  const timers = [];
  t.after(() => timers.forEach(clearTimeout));
  const { client, lines, sockets } = await simulator(t, (line, socket) => {
    normalHandshake(line, socket);
    if (['ARMAWAY', 'ARMSTAY', 'DISARM'].includes(line.split(' ')[0])) {
      timers.push(setTimeout(() => {
        if (!socket.destroyed) socket.write(`OK ${line.split(' ')[0]}\n`);
      }, 150));
    }
  }, { commandTimeoutMs: 400 });
  await until(() => client.state.mode === 'disarmed');
  const results = await Promise.allSettled([
    client.control('away'), client.control('home'),
    client.control('disarmed', 1, '1234'), client.control('away'),
  ]);
  assert.deepEqual(results.map(result => result.status),
    ['fulfilled', 'fulfilled', 'rejected', 'rejected']);
  await until(() => sockets.length === 2 && client.connected);
  await sleep(200);
  assert.deepEqual(lines.filter(({ line }) => /^(ARMAWAY|ARMSTAY|DISARM)/.test(line))
    .map(({ line }) => line), ['ARMAWAY', 'ARMSTAY', 'DISARM 1 1234']);
});

test('disconnect invalidates confirmed fields and stop prevents further reconnects', async t => {
  const { client, sockets } = await simulator(t, normalHandshake);
  await until(() => client.state.mode === 'disarmed');
  const availability = [];
  client.on('availability', value => availability.push(value));
  sockets[0].destroy();
  await until(() => !client.connected);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
  await until(() => sockets.length === 2 && client.connected);
  assert.ok(availability.includes(false));
  assert.ok(availability.includes(true));
  client.stop();
  await sleep(80);
  assert.equal(sockets.length, 2);
  assert.equal(client.connected, false);
});

test('heartbeats send STATUS and stale traffic invalidates an otherwise open socket', async t => {
  const { client, sockets, lines } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK\n');
    if (line === 'STATUS' && !lines.filter(r => r.line === 'STATUS').slice(1).length) socket.write('OK Status\nRO1\nAR1\nD1\n');
  }, { heartbeatMs: 15, staleTimeoutMs: 80, reconnectDelayMs: 200 });
  await until(() => client.state.mode === 'disarmed');
  await until(() => !client.connected);
  assert.equal(client.state.mode, 'unknown');
  assert.ok(lines.filter(record => record.line === 'STATUS').length >= 2);
  await until(() => sockets[0].destroyed);
});

test('zone events cannot hide missing status replies', async t => {
  const { client, sockets } = await simulator(t, normalHandshake,
    { heartbeatMs: 1000, staleTimeoutMs: 80, reconnectDelayMs: 200 });
  await until(() => client.state.mode === 'disarmed');
  const interval = setInterval(() => sockets[0].write('ZO002\n'), 15);
  t.after(() => clearInterval(interval));
  await until(() => client.state.mode === 'unknown');
  assert.equal(client.connected, false);
  assert.equal(client.state.zones.size, 0);
  assert.equal(client.state.batteryLow, null);
});

test('oversized frames fail closed without an unhandled error event', async t => {
  const { client, sockets } = await simulator(t, normalHandshake, { reconnectDelayMs: 200 });
  await until(() => client.state.mode === 'disarmed');
  sockets[0].write('X'.repeat(4097));
  await until(() => !client.connected);
  assert.equal(client.state.mode, 'unknown');
});

test('a configured single area can use area 2 while unrelated area events are ignored', async t => {
  const { client, sockets, lines } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK\n');
    if (line === 'STATUS') socket.write('D2\nA1\n');
    if (line === 'ARMAWAY') socket.write('EDA2-30\nOK ArmAway\n');
  }, { area: 2 });
  await until(() => client.state.mode === 'disarmed');
  await client.control('away');
  assert.equal(client.state.pending, 'away');
  assert.equal(lines.at(-1).line, 'ARMAWAY');
  sockets[0].write('A2-U1\n');
  await until(() => client.state.mode === 'away');
  assert.equal(client.state.pending, null);
});

test('trailing duplicate ACK in a packet cannot satisfy a command not yet sent', async t => {
  let count = 0;
  let armSocket;
  const { client } = await simulator(t, (line, socket) => {
    normalHandshake(line, socket);
    if (line === 'ARMAWAY') {
      armSocket = socket;
      count += 1;
      if (count === 1) socket.write('OK ArmAway\nOK ArmAway\n');
    }
  });
  await until(() => client.state.mode === 'disarmed');
  const first = client.control('away');
  let secondFinished = false;
  const second = client.control('away').then(() => { secondFinished = true; });
  await first;
  await until(() => count === 2);
  assert.equal(secondFinished, false);
  armSocket.write('OK ArmAway\n');
  await second;
});

test('silent MODE negotiation times out and reconnects without sending STATUS', async t => {
  const { client, sockets, lines } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('D1\n');
  }, { commandTimeoutMs: 30 });
  await until(() => sockets.length >= 2);
  assert.equal(client.connected, false);
  assert.equal(lines.some(record => record.line === 'STATUS'), false);
});

test('an expired active alarm closes the session rather than reporting no alarm', async t => {
  const { client, sockets } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK\n');
    if (line === 'STATUS') socket.write('D1\nZA001\n');
  }, { heartbeatMs: 1000, staleTimeoutMs: 80, reconnectDelayMs: 200 });
  await until(() => client.state.alarm);
  const interval = setInterval(() => {
    if (!sockets[0].destroyed) sockets[0].write('A1\nZO002\n');
  }, 15);
  t.after(() => clearInterval(interval));
  await until(() => !client.connected);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
});

test('refused connections are handled without requiring an error listener', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const client = new ArrowheadClient({ host: '127.0.0.1', port, reconnectDelayMs: 20 });
  t.after(() => client.stop());
  let unavailable = 0;
  client.on('availability', available => { if (!available) unavailable += 1; });
  client.start();
  await until(() => unavailable >= 2);
  assert.equal(client.connected, false);
  assert.equal(client.state.mode, 'unknown');
});

test('waits for the TCP module to initialize before sending its first command', async t => {
  const sockets = [];
  const commands = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.on('error', () => {});
    const readyAt = Date.now() + 200;
    socket.write('\r\nWelcome\r\n');
    socket.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        commands.push(line);
        if (Date.now() < readyAt) continue;
        normalHandshake(line, socket);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new ArrowheadClient({ host: '127.0.0.1', port: server.address().port,
    commandTimeoutMs: 150, reconnectDelayMs: 60000 });
  t.after(async () => {
    client.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  client.start();
  await until(() => client.state.mode === 'disarmed');
  assert.deepEqual(commands, ['MODE 4', 'STATUS']);
});

test('stopping during connection initialization cancels the pending handshake', async t => {
  const { client, sockets, lines } = await simulator(t, normalHandshake, { connectSettleMs: 100 });
  await until(() => sockets.length === 1);
  client.stop();
  await sleep(150);
  assert.deepEqual(lines, []);
  assert.equal(client.connected, false);
});

test('opt-in sparse snapshot initializes only after ACK, area markers and collection window', async t => {
  const { client, sockets } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK MODE 4\n');
    if (line === 'STATUS') socket.write('OK Status\nRO1\nAR1\n');
  }, { sparseStatus: true, zoneIds: [1, 2, 3], snapshotWindowMs: 100 });
  await until(() => client.connected);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
  sockets[0].write('ZO2\n');
  await until(() => client.state.mode === 'disarmed');
  assert.deepEqual([...client.state.zones].sort(), [[1, false], [2, true], [3, false]]);
  assert.equal(client.state.tamper, null);
});

test('sparse inference is disabled by default', async t => {
  const { client } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK MODE 4\n');
    if (line === 'STATUS') socket.write('OK Status\nRO1\nAR1\n');
  }, { zoneIds: [1], heartbeatMs: 60, staleTimeoutMs: 150 });
  await until(() => client.connected);
  await sleep(220);
  assert.equal(client.connected, true);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
});

test('incomplete or wrong-area snapshots never infer safe state', async t => {
  for (const response of ['RO1\nAR1\n', 'OK Status\n', 'OK Status\nRO2\nAR2\n',
    'OK Status\nRO1\n', 'OK Status\nAR1\n', 'OK Status\nRO1\nAR1\nA']) {
    await t.test(JSON.stringify(response), async sub => {
      const { client } = await simulator(sub, (line, socket) => {
        if (line === 'MODE 4') socket.write('OK MODE 4\n');
        if (line === 'STATUS') socket.write(response);
      }, { sparseStatus: true, zoneIds: [1] });
      await until(() => client.connected);
      await sleep(70);
      assert.equal(client.state.mode, 'unknown');
      assert.equal(client.state.zones.size, 0);
    });
  }
});

test('snapshot completion preserves armed, alarm and exit-delay events', async t => {
  for (const [events, mode, alarm, pending] of [
    ['A1\n', 'away', false, null], ['S1\n', 'home', false, null],
    ['AA1\n', 'unknown', true, null], ['ZA1\n', 'unknown', true, null],
    ['EDA1-30\n', 'unknown', false, 'away'], ['EDS1-30\n', 'unknown', false, 'home'],
  ]) {
    await t.test(events.trim(), async sub => {
      const { client } = await simulator(sub, (line, socket) => {
        if (line === 'MODE 4') socket.write('OK MODE 4\n');
        if (line === 'STATUS') socket.write('OK Status\nRO1\nAR1\n' + events);
      }, { sparseStatus: true, zoneIds: [1] });
      await until(() => client.connected);
      await sleep(60);
      assert.equal(client.state.mode, mode);
      assert.equal(client.state.alarm, alarm);
      assert.equal(client.state.pending, pending);
    });
  }
});

test('idle state survives repeated valid sparse replies beyond the stale timeout', async t => {
  let snapshots = 0;
  const { client } = await simulator(t, (line, socket) => {
    if (line === 'MODE 4') socket.write('OK MODE 4\n');
    if (line === 'STATUS') {
      socket.write('OK Status\nRO1\nAR1\n' + (++snapshots === 1 ? 'A1\nZC1\n' : ''));
    }
  }, { heartbeatMs: 60, staleTimeoutMs: 150, sparseStatus: true, zoneIds: [1] });
  await until(() => client.state.mode === 'away');
  await sleep(350);
  assert.ok(snapshots >= 4);
  assert.equal(client.connected, true);
  assert.equal(client.state.mode, 'away');
  assert.equal(client.state.zones.get(1), false);
});

test('disconnect during snapshot cancels inference and armed reconnect restores from new data', async t => {
  const { client, sockets } = await simulator(t, (line, socket, connection) => {
    if (line === 'MODE 4') socket.write('OK MODE 4\n');
    if (line === 'STATUS') {
      socket.write('OK Status\nRO1\nAR1\n' + (connection > 1 ? 'A1\nZO1\n' : ''));
    }
  }, { sparseStatus: true, zoneIds: [1], snapshotWindowMs: 80, reconnectDelayMs: 150 });
  await until(() => client.connected);
  sockets[0].destroy();
  await until(() => !client.connected);
  await sleep(100);
  assert.equal(client.state.mode, 'unknown');
  assert.equal(client.state.zones.size, 0);
  await until(() => sockets.length === 2 && client.state.mode === 'away');
  await sleep(120);
  assert.equal(client.state.mode, 'away');
  assert.equal(client.state.zones.get(1), true);
});

test('area alarm restore never means disarmed and does not clear a zone alarm', async t => {
  const { client, sockets } = await simulator(t, normalHandshake);
  await until(() => client.state.mode === 'disarmed');
  sockets[0].write('A1\nAA1\nZA1\nAR1\n');
  await until(() => client.state.mode === 'away');
  assert.equal(client.state.alarm, true);
  sockets[0].write('ZR1\n');
  await until(() => !client.state.alarm);
  assert.equal(client.state.mode, 'away');
});
