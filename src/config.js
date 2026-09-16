'use strict';
const net = require('node:net');

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function parseConfig(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object');
  const host = input.host;
  if (typeof host !== 'string' || host.length > 253 || (!net.isIP(host) && !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host)) || host.includes('..')) {
    throw new Error('host must be an IP address or hostname without a scheme or port');
  }
  if (input.enableControl !== undefined && typeof input.enableControl !== 'boolean') throw new Error('enableControl must be a boolean');
  const enableControl = input.enableControl === true;
  if (input.sparseStatus !== undefined && typeof input.sparseStatus !== 'boolean') throw new Error('sparseStatus must be a boolean');
  if (input.pin !== undefined && typeof input.pin !== 'string') throw new Error('pin must be a string');
  if (input.pinEnvironment !== undefined && (typeof input.pinEnvironment !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.pinEnvironment))) {
    throw new Error('pinEnvironment must be a valid environment variable name');
  }
  if (input.pin !== undefined && input.pinEnvironment !== undefined) throw new Error('Use pin or pinEnvironment, not both');
  const pin = input.pinEnvironment ? env[input.pinEnvironment] : input.pin;
  if (pin !== undefined && pin !== '' && (typeof pin !== 'string' || !/^\d{3,12}$/.test(pin))) throw new Error('PIN must contain 3 to 12 digits');
  if (enableControl && !pin) throw new Error('A PIN is required when controls are enabled');
  const zones = input.zones === undefined ? [] : input.zones;
  if (!Array.isArray(zones) || zones.length > 148) throw new Error('zones must be an array with at most 148 entries');
  const ids = new Set();
  const parsedZones = zones.map(zone => {
    if (!zone || typeof zone !== 'object' || Array.isArray(zone)) throw new Error('Each zone must be an object');
    const id = integer(zone.id, 'Zone id', 1, 248);
    if (ids.has(id)) throw new Error('Zone ids must be unique');
    ids.add(id);
    if (typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 64) throw new Error('Zone name must be 1 to 64 characters');
    const type = zone.type === undefined ? 'motion' : zone.type;
    if (!['motion', 'contact'].includes(type)) throw new Error('Zone type must be motion or contact');
    return { id, name: zone.name.trim(), type };
  });
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 64)) throw new Error('name must be 1 to 64 characters');
  return {
    host, port: integer(input.port === undefined ? 9000 : input.port, 'port', 1, 65535),
    area: integer(input.area === undefined ? 1 : input.area, 'area', 1, 32),
    name: input.name === undefined ? 'Arrowhead Alarm' : input.name.trim(), enableControl,
    userNumber: integer(input.userNumber === undefined ? 1 : input.userNumber, 'userNumber', 1, 2000),
    pin: pin || '', zones: parsedZones, sparseStatus: input.sparseStatus === true,
  };
}
module.exports = { parseConfig };
