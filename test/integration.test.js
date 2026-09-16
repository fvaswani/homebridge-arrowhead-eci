'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: sleep } = require('node:timers/promises');
const { HomebridgeAPI } = require('./helpers/homebridge');
const { ArrowheadPlatform } = require('../src/platform');
const { ArrowheadClient } = require('../src/client');

async function until(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for integration state');
    await sleep(5);
  }
}

test('actual HAP services, platform and TCP client exchange confirmed panel state and controls',
  { timeout: 10000 }, async t => {
    const commands = [];
    const sockets = new Set();
    let panel;
    const server = net.createServer(socket => {
      panel = socket;
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', data => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const command = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          commands.push(command);
          if (command === 'MODE 4') socket.write('OK MODE 4\r\n');
          if (command === 'STATUS') socket.write('D1\nZC1\nTR\n');
          if (command === 'ARMAWAY') socket.write('ZO1\nEDA1-30\n');
        }
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const api = new HomebridgeAPI();
    const registered = [];
    const logs = [];
    api.registerPlatformAccessories = (_plugin, _platform, accessories) => registered.push(...accessories);
    api.unregisterPlatformAccessories = () => {};
    api.updatePlatformAccessories = () => {};
    const log = { info: message => logs.push(message), warn: message => logs.push(message),
      error: message => logs.push(message) };
    const platform = new ArrowheadPlatform(log, {
      host: '127.0.0.1', port: server.address().port, name: 'Simulated alarm',
      enableControl: true, userNumber: 7, pin: '012345',
      zones: [{ id: 1, name: 'Simulated hall', type: 'motion' }],
    }, api);
    t.after(async () => {
      api.emit('shutdown');
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    });
    assert.ok(platform.client instanceof ArrowheadClient);
    api.emit('didFinishLaunching');
    const { Service, Characteristic: C } = api.hap;
    const alarm = registered.find(accessory => accessory.getService(Service.SecuritySystem))
      .getService(Service.SecuritySystem);
    const motion = registered.find(accessory => accessory.getService(Service.MotionSensor))
      .getService(Service.MotionSensor).getCharacteristic(C.MotionDetected);
    const current = alarm.getCharacteristic(C.SecuritySystemCurrentState);
    const target = alarm.getCharacteristic(C.SecuritySystemTargetState);
    await assert.rejects(current.handleGetRequest());
    await until(() => platform.client.state.mode === 'disarmed' && platform.client.state.zones.has(1));
    assert.deepEqual(commands, ['MODE 4', 'STATUS']);
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.DISARMED);
    assert.equal(await motion.handleGetRequest(), false);
    assert.equal(await alarm.getCharacteristic(C.StatusTampered).handleGetRequest(), 0);

    let armAccepted = false;
    const arm = target.handleSetRequest(C.SecuritySystemTargetState.AWAY_ARM)
      .then(() => { armAccepted = true; });
    await until(() => platform.client.state.pending === 'away');
    assert.equal(armAccepted, false);
    assert.equal(await motion.handleGetRequest(), true);
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.DISARMED);
    assert.equal(await target.handleGetRequest(), C.SecuritySystemTargetState.AWAY_ARM);
    panel.write('OK ArmAway\n');
    await arm;
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.DISARMED);
    panel.write('A1-U7\n');
    await until(() => platform.client.state.mode === 'away');
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.AWAY_ARM);

    const disarm = target.handleSetRequest(C.SecuritySystemTargetState.DISARM);
    await until(() => commands.includes('DISARM 7 012345'));
    panel.write('ZC1\nOK Disarm\n');
    await disarm;
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.AWAY_ARM);
    panel.write('D1-U7\n');
    await until(() => platform.client.state.mode === 'disarmed');
    assert.equal(await current.handleGetRequest(), C.SecuritySystemCurrentState.DISARMED);
    assert.equal(await motion.handleGetRequest(), false);
    assert.ok(logs.every(message => !message.includes('012345')));

    api.emit('shutdown');
    await until(() => sockets.size === 0);
    assert.equal(platform.client.connected, false);
    await assert.rejects(current.handleGetRequest());
    await assert.rejects(motion.handleGetRequest());
  });

test('queued controls fail before the HomeKit timeout instead of executing afterwards',
  { timeout: 15000 }, async t => {
    const commands = [], sockets = new Set(), timers = [];
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', data => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line === 'MODE 4') socket.write('OK MODE 4\n');
          else if (line === 'STATUS') socket.write('OK Status\nRO1\nAR1\nD1\n');
          else {
            const command = line.split(' ')[0];
            commands.push(command);
            timers.push(setTimeout(() => {
              if (!socket.destroyed) socket.write(`OK ${command}\n`);
            }, 4000));
          }
        }
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const api = new HomebridgeAPI(), registered = [];
    api.registerPlatformAccessories = (_plugin, _platform, accessories) => registered.push(...accessories);
    api.unregisterPlatformAccessories = () => {};
    api.updatePlatformAccessories = () => {};
    const platform = new ArrowheadPlatform({ info() {}, warn() {}, error() {} }, {
      host: '127.0.0.1', port: server.address().port, enableControl: true, pin: '1234',
    }, api);
    t.after(async () => {
      api.emit('shutdown');
      timers.forEach(clearTimeout);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    });
    api.emit('didFinishLaunching');
    await until(() => platform.client.state.mode === 'disarmed');
    const accessory = registered[0]._associatedHAPAccessory;
    const target = registered[0].getService(api.hap.Service.SecuritySystem)
      .getCharacteristic(api.hap.Characteristic.SecuritySystemTargetState);
    // Assign IDs without publishing a bridge or requiring HomeKit pairing.
    accessory.aid = 1;
    target.iid = 10;
    const results = await Promise.all([1, 0, 3, 1].map(value => new Promise(resolve => {
      accessory.handleSetCharacteristics({ remoteAddress: '127.0.0.1' }, {
        characteristics: [{ aid: 1, iid: 10, value }],
      }, (error, response) => resolve({ error, status: response?.characteristics[0]?.status }));
    })));
    assert.ok(results.every(result => !result.error));
    const failure = api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    assert.deepEqual(results.map(result => result.status), [0, failure, failure, failure]);
    await until(() => platform.client.connected, 4000);
    assert.deepEqual(commands, ['ARMAWAY', 'ARMSTAY']);
  });
