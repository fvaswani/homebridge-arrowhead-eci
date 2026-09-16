'use strict';
const { ArrowheadPlatform } = require('./src/platform');
module.exports = (api) => api.registerPlatform('homebridge-arrowhead-eci', 'ArrowheadECi', ArrowheadPlatform);
