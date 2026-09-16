'use strict';
const { parseConfig } = require('./config');
const { ArrowheadClient } = require('./client');
const PLUGIN = 'homebridge-arrowhead-eci';
const PLATFORM = 'ArrowheadECi';

class ArrowheadPlatform {
  constructor(log, config, api, Client = ArrowheadClient) {
    this.log = log;
    this.api = api;
    this.cached = new Map();
    this.updaters = [];
    if (!config) return;
    // Do not interpolate raw config or validation input into logs.
    try {
      this.config = parseConfig(config);
      this.client = new Client({ host: this.config.host, port: this.config.port, area: this.config.area,
        sparseStatus: this.config.sparseStatus, zoneIds: this.config.zones.map(zone => zone.id) });
    } catch (error) {
      log.error(`Arrowhead configuration: ${error.message}`);
      return;
    }
    this.client.on('state', () => this.refresh());
    this.client.on('availability', (available) => {
      log.info(available ? 'Alarm connection available' : 'Alarm connection unavailable');
      this.refresh();
    });
    api.on('didFinishLaunching', () => {
      this.setup();
      log.info(this.config.enableControl ? 'Alarm controls enabled; commands affect the whole panel' : 'Alarm controls disabled; monitoring only');
      this.client.start();
    });
    api.on('shutdown', () => this.client.stop());
  }

  configureAccessory(accessory) {
    this.cached.set(accessory.UUID, accessory);
    if (this.client) return;
    // Failed configuration must not expose persisted readings as live state.
    const { Service, Characteristic: C } = this.api.hap;
    for (const [type, values] of [
      [Service.SecuritySystem, [C.SecuritySystemCurrentState, C.SecuritySystemTargetState, C.StatusTampered]],
      [Service.MotionSensor, [C.MotionDetected]],
      [Service.ContactSensor, [C.ContactSensorState]],
    ]) {
      const service = accessory.getService(type);
      if (!service) continue;
      for (const characteristic of values) {
        service.getCharacteristic(characteristic)
          .onGet(() => { throw this.unavailable(); })
          .updateValue(this.unavailable());
      }
      if (type === Service.SecuritySystem) {
        service.getCharacteristic(C.SecuritySystemTargetState).onSet(() => { throw this.unavailable(); });
      }
      service.getCharacteristic(C.StatusFault).onGet(() => 1).updateValue(1);
    }
  }

  setup() {
    const active = new Set();
    const create = (key, name) => {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN}:${this.config.host}:${this.config.port}:${key}`);
      let accessory = this.cached.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(name, uuid);
        this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [accessory]);
        this.cached.set(uuid, accessory);
      }
      active.add(uuid);
      accessory.displayName = name;
      accessory.getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Arrowhead Alarm Products')
        .setCharacteristic(this.api.hap.Characteristic.Model, 'EC-i (experimental bridge)')
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, `eci-${uuid.slice(0, 8)}`)
        .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, require('../package.json').version.split('-')[0]);
      return accessory;
    };
    const alarm = create(`area-${this.config.area}`, this.config.name);
    this.setupAlarm(alarm);
    for (const zone of this.config.zones) {
      const accessory = create(`zone-${zone.id}`, zone.name);
      this.setupZone(accessory, zone);
    }
    const removed = [...this.cached.values()].filter(a => !active.has(a.UUID));
    if (removed.length) {
      this.api.unregisterPlatformAccessories(PLUGIN, PLATFORM, removed);
      for (const accessory of removed) this.cached.delete(accessory.UUID);
    }
    this.api.updatePlatformAccessories([...this.cached.values()]);
    this.refresh();
  }

  unavailable() { return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  requireKnown(value) {
    if (!this.client.connected || value === null || value === undefined || value === 'unknown') throw this.unavailable();
    return value;
  }
  readMode() {
    const state = this.client.state;
    if (this.client.connected && state.alarm) return this.api.hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
    this.requireKnown(state.mode);
    return { home: 0, away: 1, disarmed: 3 }[state.mode];
  }
  readTarget() {
    this.requireKnown(this.client.state.mode);
    return { home: 0, away: 1, disarmed: 3 }[this.client.state.pending || this.client.state.mode];
  }
  bind(service, characteristic, getter) {
    const item = service.getCharacteristic(characteristic).onGet(getter);
    this.updaters.push(() => {
      try { item.updateValue(getter()); }
      catch { item.updateValue(this.unavailable()); }
    });
    return item;
  }
  setupAlarm(accessory) {
    const { Service, Characteristic: C, HAPStatus, HapStatusError } = this.api.hap;
    const service = accessory.getService(Service.SecuritySystem) || accessory.addService(Service.SecuritySystem, this.config.name);
    service.setCharacteristic(C.Name, this.config.name);
    this.bind(service, C.SecuritySystemCurrentState, () => this.readMode());
    this.bind(service, C.SecuritySystemTargetState, () => this.readTarget())
      .setProps({ validValues: [0, 1, 3] })
      .onSet(async value => {
        if (!this.config.enableControl) throw new HapStatusError(HAPStatus.READ_ONLY_CHARACTERISTIC);
        const target = { 0: 'home', 1: 'away', 3: 'disarmed' }[value];
        if (!target) throw new HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST);
        this.requireKnown(this.client.state.mode);
        try {
          await this.client.control(target, this.config.userNumber, this.config.pin);
          // ACK means accepted. CurrentState is updated only by panel events.
          this.log.info('Alarm command accepted; waiting for confirmed panel state');
        } catch {
          this.log.warn('Alarm command failed or timed out; check the panel state before retrying');
          throw this.unavailable();
        }
      });
    this.bind(service, C.StatusFault, () => this.client.connected && this.client.state.mode !== 'unknown' ? 0 : 1);
    this.bind(service, C.StatusTampered, () => this.requireKnown(this.client.state.tamper) ? 1 : 0);
  }
  setupZone(accessory, zone) {
    const { Service, Characteristic: C } = this.api.hap;
    const type = zone.type === 'motion' ? Service.MotionSensor : Service.ContactSensor;
    const oldType = zone.type === 'motion' ? Service.ContactSensor : Service.MotionSensor;
    const old = accessory.getService(oldType);
    if (old) accessory.removeService(old);
    const service = accessory.getService(type) || accessory.addService(type, zone.name);
    service.setCharacteristic(C.Name, zone.name);
    const valueType = zone.type === 'motion' ? C.MotionDetected : C.ContactSensorState;
    this.bind(service, valueType, () => {
      const value = this.requireKnown(this.client.state.zones.get(zone.id));
      return zone.type === 'motion' ? value : (value ? 1 : 0);
    });
    this.bind(service, C.StatusFault, () => this.client.connected && this.client.state.zones.has(zone.id) ? 0 : 1);
  }
  refresh() { for (const update of this.updaters) update(); }
}
module.exports = { ArrowheadPlatform };
