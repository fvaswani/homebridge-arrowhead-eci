'use strict';
// Tests exercise the real API in Homebridge 1.x (lib) and 2.x (dist).
// Production code receives the API from Homebridge and imports no internals.
const path = require('node:path');
const root = path.dirname(require.resolve('homebridge'));
module.exports = {
  ...require(path.join(root, 'api.js')),
  ...require(path.join(root, 'platformAccessory.js')),
};
