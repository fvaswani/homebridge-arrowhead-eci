'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { HomebridgeAPI } = require('./helpers/homebridge');
const { ArrowheadPlatform } = require('../src/platform');
const { parseConfig } = require('../src/config');

class FakeClient extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.connected = false; this.commands = [];
    this.state = { mode: 'unknown', alarm: false, pending: null, zones: new Map(), tamper: null };
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  async control(...args) { this.commands.push(args); if (this.fail) throw new Error('test failure'); }
}
function setup(config = {}, cached = []) {
  const api = new HomebridgeAPI();
  const registered = []; const removed = []; const logs = [];
  const register = api.registerPlatformAccessories.bind(api);
  api.registerPlatformAccessories = (p, a, list) => { register(p,a,list); registered.push(...list); };
  api.unregisterPlatformAccessories = (_p, _a, list) => removed.push(...list);
  api.updatePlatformAccessories = () => {};
  const log = { info: x => logs.push(x), warn: x => logs.push(x), error: x => logs.push(x) };
  const platform = new ArrowheadPlatform(log, { host: '192.0.2.10', ...config }, api, FakeClient);
  cached.forEach(a => platform.configureAccessory(a));
  api.emit('didFinishLaunching');
  const alarm = [...platform.cached.values()].find(a => a.getService(api.hap.Service.SecuritySystem));
  return { api, platform, registered, removed, logs, alarm, client: platform.client };
}
function status(x, mode = 'disarmed') {
  x.client.connected = true; x.client.state.mode = mode; x.client.emit('state');
}
function current(x) { return x.alarm.getService(x.api.hap.Service.SecuritySystem).getCharacteristic(x.api.hap.Characteristic.SecuritySystemCurrentState); }
function target(x) { return x.alarm.getService(x.api.hap.Service.SecuritySystem).getCharacteristic(x.api.hap.Characteristic.SecuritySystemTargetState); }

test('validates configuration without leaking secret input', () => {
  for (const config of [ { host: 'x\nDISARM' }, { enableControl: 'false' }, { port: 0 }, { area: 33 }, { userNumber: 2001 }, { zones: [{id:1,name:'a'},{id:1,name:'b'}] }, { pin:'SECRET\n' }, { pin:'', pinEnvironment:'PIN' }, { enableControl:true } ]) {
    assert.throws(() => parseConfig({ host: '192.0.2.1', ...config }), e => !e.message.includes('SECRET'));
  }
  assert.equal(parseConfig({host:'localhost'}).enableControl, false);
  assert.equal(parseConfig({host:'localhost',pinEnvironment:'PIN',enableControl:true},{PIN:'0123'}).pin,'0123');
});

test('registers native HAP alarm and configured motion/contact services', () => {
  const x = setup({ zones:[{id:1,name:'Hall',type:'motion'},{id:2,name:'Door',type:'contact'}] });
  assert.equal(x.registered.length,3); assert.equal(x.client.started,true);
  assert.equal(x.registered[1].getService(x.api.hap.Service.MotionSensor).displayName,'Hall');
  assert.equal(x.registered[2].getService(x.api.hap.Service.ContactSensor).displayName,'Door');
  assert.deepEqual(target(x).props.validValues,[0,1,3]);
  x.api.emit('shutdown'); assert.equal(x.client.stopped,true);
});

test('initial unknown and disconnected state return HomeKit communication errors', async () => {
  const x=setup();
  await assert.rejects(current(x).handleGetRequest());
  status(x,'away'); assert.equal(await current(x).handleGetRequest(),1);
  x.client.connected=false; x.client.emit('availability',false);
  await assert.rejects(current(x).handleGetRequest());
  await assert.rejects(target(x).handleGetRequest());
});

test('read-only by default rejects actual HomeKit set request without sending commands',async () => {
  const x=setup(); status(x);
  await assert.rejects(target(x).handleSetRequest(1));
  assert.equal(x.client.commands.length,0);
});

test('control ACK does not fabricate armed state; exit delay and actual event update separately',async () => {
  const x=setup({ enableControl:true, pin:'0123' }); status(x);
  await target(x).handleSetRequest(1);
  assert.deepEqual(x.client.commands,[['away',1,'0123']]);
  assert.equal(await current(x).handleGetRequest(),3);
  x.client.state.pending='away'; x.client.emit('state');
  assert.equal(await target(x).handleGetRequest(),1);
  assert.equal(await current(x).handleGetRequest(),3);
  x.client.state.pending=null; x.client.state.mode='away'; x.client.emit('state');
  assert.equal(await current(x).handleGetRequest(),1);
  assert.ok(x.logs.every(line=>!line.includes('0123')));
});

test('failed disarm and unsupported night target never claim success',async () => {
  const x=setup({ enableControl:true,pin:'0123' }); status(x,'away');
  x.client.fail=true;
  await assert.rejects(target(x).handleSetRequest(3));
  assert.equal(await current(x).handleGetRequest(),1);
  const count=x.client.commands.length;
  await assert.rejects(target(x).handleSetRequest(2));
  assert.equal(x.client.commands.length,count);
});

test('zone values unknown until received and mapped correctly',async () => {
  const x=setup({zones:[{id:1,name:'Hall'},{id:2,name:'Door',type:'contact'}]}); status(x);
  const motion=x.registered[1].getService(x.api.hap.Service.MotionSensor).getCharacteristic(x.api.hap.Characteristic.MotionDetected);
  const contact=x.registered[2].getService(x.api.hap.Service.ContactSensor).getCharacteristic(x.api.hap.Characteristic.ContactSensorState);
  await assert.rejects(motion.handleGetRequest());
  x.client.state.zones.set(1,true); x.client.state.zones.set(2,false); x.client.emit('state');
  assert.equal(await motion.handleGetRequest(),true); assert.equal(await contact.handleGetRequest(),0);
  x.client.state.zones.set(2,true); assert.equal(await contact.handleGetRequest(),1);
  x.client.connected=false; await assert.rejects(motion.handleGetRequest());
});

test('cached UUIDs reused and deleted zones removed; type changes replace service',() => {
  const x=setup({zones:[{id:1,name:'Hall'},{id:2,name:'Door'}]});
  const y=setup({zones:[{id:1,name:'Renamed',type:'contact'}]},[...x.platform.cached.values()]);
  assert.equal(y.registered.length,0); assert.equal(y.removed.length,1);
  const zone=[...y.platform.cached.values()].find(a=>a.displayName==='Renamed');
  assert.equal(zone.getService(y.api.hap.Service.MotionSensor),undefined);
  assert.ok(zone.getService(y.api.hap.Service.ContactSensor));
});

test('invalid configuration fails before any network client is created',() => {
  const x=setup({enableControl:true,pin:'SECRET'});
  assert.equal(x.client,undefined); assert.equal(x.registered.length,0);
  assert.ok(x.logs[0].includes('configuration')); assert.ok(!x.logs[0].includes('SECRET'));
});

test('triggered alarm event can be reported before the initial mode snapshot', async () => {
  const x=setup(); x.client.connected=true; x.client.state.alarm=true; x.client.emit('state');
  assert.equal(await current(x).handleGetRequest(),4);
});

test('Homebridge entry registers the expected platform', () => {
  const calls=[];
  require('../index')({registerPlatform:(...args)=>calls.push(args)});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,2),['homebridge-arrowhead-eci','ArrowheadECi']);
  assert.equal(calls[0][2],ArrowheadPlatform);
});

test('invalid config after restart cannot serve persisted safe readings or accept controls', async () => {
  const x=setup({zones:[{id:1,name:'Hall'}]}); status(x);
  x.client.state.zones.set(1,false); x.client.emit('state');
  const { PlatformAccessory } = require('./helpers/homebridge');
  const persisted=[...x.platform.cached.values()].map(a=>PlatformAccessory.deserialize(PlatformAccessory.serialize(a)));
  const y=setup({enableControl:true,pinEnvironment:'ARROWHEAD_NONEXISTENT_TEST_PIN'},persisted);
  assert.equal(y.client,undefined);
  await assert.rejects(current(y).handleGetRequest());
  await assert.rejects(target(y).handleSetRequest(3));
  const motion=persisted[1].getService(y.api.hap.Service.MotionSensor).getCharacteristic(y.api.hap.Characteristic.MotionDetected);
  await assert.rejects(motion.handleGetRequest());
});

test('client construction errors fail closed rather than crashing Homebridge', () => {
  const api=new HomebridgeAPI(); const errors=[];
  const platform=new ArrowheadPlatform({error:x=>errors.push(x)}, {host:'alarm.-local'},api);
  assert.equal(platform.client,undefined);
  assert.ok(errors[0].includes('configuration'));
});


test('sparse status is opt-in and configured zones reach the client', () => {
  assert.equal(parseConfig({host:'localhost'}).sparseStatus, false);
  assert.throws(() => parseConfig({host:'localhost', sparseStatus:'true'}));
  const x = setup({sparseStatus:true, zones:[{id:1,name:'Hall'},{id:3,name:'Lounge'}]});
  assert.equal(x.client.options.sparseStatus, true);
  assert.deepEqual(x.client.options.zoneIds,[1,3]);
});
