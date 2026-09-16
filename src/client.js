'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');

const MAX_LINE = 4096;
const MAX_QUEUE = 16;
const emptyState = () => ({
  mode: 'unknown', alarm: false, zones: new Map(),
  batteryLow: null, tamper: null, mainsFault: null, pending: null,
});

function positiveInteger(value, name, max = 2147483647) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`Invalid ${name}`);
  }
}

/** Single-area MODE 4 client. All errors intentionally omit received text and credentials. */
class ArrowheadClient extends EventEmitter {
  constructor({ host, port = 9000, area = 1, commandTimeoutMs = 5000,
    reconnectDelayMs = 1000, heartbeatMs = 30000, staleTimeoutMs = 90000,
    connectSettleMs = 1000 } = {}) {
    super();
    if (typeof host !== 'string' || host.length > 253 ||
        (!net.isIP(host) && !host.split('.').every(label =>
          /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) ||
        host.includes('..')) throw new TypeError('Invalid host');
    positiveInteger(port, 'port', 65535);
    positiveInteger(area, 'area', 32);
    for (const [name, value] of Object.entries({ commandTimeoutMs, reconnectDelayMs,
      heartbeatMs, staleTimeoutMs, connectSettleMs })) positiveInteger(value, name);
    this.options = { host, port, area, commandTimeoutMs, reconnectDelayMs, heartbeatMs, staleTimeoutMs, connectSettleMs };
    this.connected = false;
    this.state = emptyState();
    this._running = false;
    this._socket = null;
    this._queue = [];
    this._active = null;
    this._retry = null;
    this._health = null;
    this._connectTimer = null;
    this._settleTimer = null;
    this._buffer = '';
    this._attempt = 0;
    this._freshness = new Map();
    this._alarms = new Set();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._connect();
  }

  stop() {
    this._running = false;
    clearTimeout(this._retry);
    this._retry = null;
    this._disconnect(new Error('Client stopped'));
  }

  async control(target, userNumber, pin) {
    if (!['away', 'home', 'disarmed'].includes(target)) throw new TypeError('Invalid control target');
    if (userNumber !== undefined) positiveInteger(userNumber, 'user number', 2000);
    if (pin !== undefined && (typeof pin !== 'string' || !/^\d{3,12}$/.test(pin))) {
      throw new TypeError('Invalid PIN format');
    }
    if (target === 'disarmed' && (userNumber === undefined || pin === undefined)) {
      throw new TypeError('Disarming requires a user number and PIN');
    }
    if (!this.connected || this.state.mode === 'unknown') throw new Error('Panel unavailable');
    const command = { away: 'ARMAWAY', home: 'ARMSTAY', disarmed: 'DISARM' }[target];
    const line = target === 'disarmed' ? `${command} ${userNumber} ${pin}` : command;
    await this._request(line, new RegExp(`^OK ${command}(?: [0-9]+)?$`, 'i'));
  }

  _connect() {
    if (!this._running || this._socket) return;
    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this._socket = socket;
    this._buffer = '';
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    this._connectTimer = setTimeout(() => this._disconnect(new Error('Connection timeout')),
      this.options.commandTimeoutMs);
    socket.on('error', () => {
      if (this._socket === socket) this._disconnect(new Error('Connection failed'));
    });
    socket.on('close', () => {
      if (this._socket === socket) this._disconnect(new Error('Connection closed'));
    });
    socket.on('data', data => { if (this._socket === socket) this._read(data); });
    socket.on('connect', () => {
      if (this._socket !== socket) return;
      clearTimeout(this._connectTimer);
      // EC-i TCP modules can discard commands sent before their welcome phase
      // completes. Match the upstream client's one-second initialization wait.
      this._settleTimer = setTimeout(() => {
        this._settleTimer = null;
        if (this._socket !== socket || !this._running) return;
        // Upstream firmware may acknowledge MODE 4 with bare OK. It is accepted
        // only in this transaction; generic OK never acknowledges a control.
        this._request('MODE 4', /^(?:MODE 4|OK(?: MODE(?: 4)?)?)$/i).then(() => {
          if (this._socket !== socket || !this._running) return;
          this._lastMessage = Date.now();
          this._lastHeartbeat = Date.now();
          this._attempt = 0;
          socket.write('STATUS\n');
          this.connected = true;
          this.emit('availability', true);
          this._health = setInterval(() => this._tick(), Math.max(5,
            Math.min(1000, this.options.heartbeatMs, this.options.staleTimeoutMs / 4)));
        }).catch(() => {
          if (this._socket === socket) this._disconnect(new Error('MODE 4 negotiation failed'));
        });
      }, this.options.connectSettleMs);
    });
  }

  _request(line, acknowledgement) {
    if (!this._socket || this._socket.destroyed) return Promise.reject(new Error('Panel unavailable'));
    if (this._queue.length >= MAX_QUEUE) return Promise.reject(new Error('Command queue full'));
    return new Promise((resolve, reject) => {
      this._queue.push({ line, acknowledgement, resolve, reject, timer: null });
      this._pump();
    });
  }

  _pump() {
    if (this._active || !this._socket || !this._queue.length) return;
    const request = this._queue.shift();
    this._active = request;
    request.timer = setTimeout(() => {
      // A late reply cannot safely be associated with a later request.
      this._disconnect(new Error('Command timed out; result unknown'));
    }, this.options.commandTimeoutMs);
    this._socket.write(`${request.line}\n`);
    request.line = null;
  }

  _read(data) {
    this._buffer += data;
    let end;
    while ((end = this._buffer.indexOf('\n')) !== -1) {
      if (end > MAX_LINE) return this._disconnect(new Error('Protocol frame too large'));
      const line = this._buffer.slice(0, end).replace(/\r$/, '');
      this._buffer = this._buffer.slice(end + 1);
      if (line) this._line(line);
      if (!this._socket) return;
    }
    if (this._buffer.length > MAX_LINE) this._disconnect(new Error('Protocol frame too large'));
  }

  _line(line) {
    if (this._event(line)) {
      this._lastMessage = Date.now();
      this.emit('state', this.state);
      return;
    }
    if (/^ERR(?:\s|$)/i.test(line)) {
      // Closing also prevents a delayed ERROR from being associated with a
      // following transaction. Never expose its possibly sensitive payload.
      this._disconnect(new Error('Panel rejected request'));
      return;
    }
    const request = this._active;
    if (request && request.acknowledgement.test(line)) {
      this._lastMessage = Date.now();
      clearTimeout(request.timer);
      this._active = null;
      request.resolve();
      // Drain this packet before sending the next command. Trailing replies
      // in the same packet cannot satisfy a command not yet sent.
      queueMicrotask(() => this._pump());
    }
  }

  _event(line) {
    let match = /^([ADS])(\d{1,2})(?:-U\d{1,4})?$/.exec(line);
    if (match && Number(match[2]) === this.options.area) {
      this.state.mode = { A: 'away', D: 'disarmed', S: 'home' }[match[1]];
      this.state.pending = null;
      this._freshness.set('mode', Date.now());
      this._freshness.delete('pending');
      if (match[1] === 'D') {
        this._alarms.clear();
        this.state.alarm = false;
        this._freshness.delete('alarm');
      }
      return true;
    }
    match = /^(EDA|EDS)(\d{1,2})(?:-\d{1,5})?$/.exec(line);
    if (match && Number(match[2]) === this.options.area) {
      this.state.pending = match[1] === 'EDA' ? 'away' : 'home';
      this._freshness.set('pending', Date.now());
      return true;
    }
    match = /^(ZO|ZC|ZA|ZR)(\d{1,3})$/.exec(line);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 248) {
      const zone = Number(match[2]);
      if (match[1] === 'ZO' || match[1] === 'ZC') {
        this.state.zones.set(zone, match[1] === 'ZO');
        this._freshness.set(`zone:${zone}`, Date.now());
      } else {
        if (match[1] === 'ZA') this._alarms.add(zone);
        else this._alarms.delete(zone);
        this.state.alarm = this._alarms.size > 0;
        if (this.state.alarm) this._freshness.set('alarm', Date.now());
        else this._freshness.delete('alarm');
      }
      return true;
    }
    const system = { BF: ['batteryLow', true], BR: ['batteryLow', false],
      TA: ['tamper', true], TR: ['tamper', false], MF: ['mainsFault', true], MR: ['mainsFault', false] }[line];
    if (Array.isArray(system)) {
      this.state[system[0]] = system[1];
      this._freshness.set(system[0], Date.now());
      return true;
    }
    return false;
  }

  _tick() {
    if (!this.connected) return;
    const now = Date.now();
    if (now - this._lastMessage >= this.options.staleTimeoutMs) {
      this._disconnect(new Error('Panel state stale'));
      return;
    }
    let changed = false;
    for (const [key, time] of this._freshness) {
      if (now - time < this.options.staleTimeoutMs) continue;
      if (key === 'alarm') {
        this._disconnect(new Error('Alarm state stale'));
        return;
      }
      if (key.startsWith('zone:')) this.state.zones.delete(Number(key.slice(5)));
      else this.state[key] = key === 'mode' ? 'unknown' : null;
      this._freshness.delete(key);
      changed = true;
    }
    if (changed) this.emit('state', this.state);
    if (now - this._lastHeartbeat >= this.options.heartbeatMs && !this._active && !this._queue.length) {
      this._lastHeartbeat = now;
      // STATUS emits independent events, without a guaranteed terminal ACK.
      this._socket.write('STATUS\n');
    }
  }

  _disconnect(error) {
    const socket = this._socket;
    this._socket = null;
    clearTimeout(this._connectTimer);
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
    clearInterval(this._health);
    this._health = null;
    const active = this._active;
    this._active = null;
    const requests = active ? [active, ...this._queue] : this._queue;
    this._queue = [];
    for (const request of requests) {
      clearTimeout(request.timer);
      request.line = null;
      request.reject(error);
    }
    if (socket) socket.destroy();
    this.connected = false;
    this.state = emptyState();
    this._freshness.clear();
    this._alarms.clear();
    this._buffer = '';
    this.emit('availability', false);
    this.emit('state', this.state);
    if (this._running && !this._retry) {
      const delay = Math.min(60000, this.options.reconnectDelayMs * 2 ** Math.min(this._attempt++, 10));
      this._retry = setTimeout(() => {
        this._retry = null;
        this._connect();
      }, delay);
    }
  }
}

module.exports = { ArrowheadClient };
