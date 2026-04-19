const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../background/fingerprint-run.js');

test('fingerprint run helper keeps the same seed within one auto run', async () => {
  let state = {
    autoRunning: true,
    autoRunCurrentRun: 3,
    autoRunSessionId: 11,
    currentFingerprintRunMarker: null,
    currentFingerprintSeed: null,
  };
  const updates = [];
  const randomValues = ['seed-one', 'seed-two'];
  const helpers = api.createFingerprintRunHelpers({
    getNow: () => 1700000000000,
    getState: async () => ({ ...state }),
    randomUUID: () => randomValues.shift() || 'seed-fallback',
    setState: async (patch) => {
      updates.push(patch);
      state = { ...state, ...patch };
    },
  });

  const first = await helpers.prepareFingerprintProfileForStep1();
  const second = await helpers.prepareFingerprintProfileForStep1();

  assert.equal(first.marker, 'auto:11:3');
  assert.equal(first.seed, 'seedone');
  assert.equal(first.refreshed, true);
  assert.equal(second.marker, 'auto:11:3');
  assert.equal(second.seed, 'seedone');
  assert.equal(second.refreshed, false);
  assert.equal(updates.length, 1);
});

test('fingerprint run helper rotates seed after auto run index changes', async () => {
  let state = {
    autoRunning: true,
    autoRunCurrentRun: 2,
    autoRunSessionId: 8,
    currentFingerprintRunMarker: 'auto:8:2',
    currentFingerprintSeed: 'seed-old',
  };
  const helpers = api.createFingerprintRunHelpers({
    getState: async () => ({ ...state }),
    randomUUID: () => 'seed-new',
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
  });

  state.autoRunCurrentRun = 3;
  const result = await helpers.prepareFingerprintProfileForStep1();

  assert.equal(result.marker, 'auto:8:3');
  assert.equal(result.seed, 'seednew');
  assert.equal(result.refreshed, true);
});

test('fingerprint run helper refreshes seed on each manual step1 start', async () => {
  let state = {
    autoRunning: false,
    autoRunCurrentRun: 0,
    autoRunSessionId: 0,
    currentFingerprintRunMarker: null,
    currentFingerprintSeed: null,
  };
  const randomValues = [
    'manual-marker-1',
    'manual-seed-1',
    'manual-marker-2',
    'manual-seed-2',
  ];
  const helpers = api.createFingerprintRunHelpers({
    getNow: () => 1700001234000,
    getState: async () => ({ ...state }),
    randomUUID: () => randomValues.shift() || 'manual-fallback',
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
  });

  const first = await helpers.prepareFingerprintProfileForStep1();
  const second = await helpers.prepareFingerprintProfileForStep1();

  assert.match(first.marker, /^manual:1700001234000:manualmarker1$/);
  assert.equal(first.seed, 'manualseed1');
  assert.equal(first.refreshed, true);
  assert.match(second.marker, /^manual:1700001234000:manualmarker2$/);
  assert.equal(second.seed, 'manualseed2');
  assert.equal(second.refreshed, true);
});
