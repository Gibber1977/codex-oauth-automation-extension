const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../content/fingerprint-bootstrap.js');

test('fingerprint bootstrap extracts seed from managed window name', () => {
  assert.equal(api.extractSeedFromWindowName('__MPFP__:seed-123'), 'seed-123');
  assert.equal(api.extractSeedFromWindowName('plain-name'), '');
});

test('fingerprint bootstrap builds deterministic profiles from the same seed', () => {
  const left = api.buildProfileFromSeed('seed-abc');
  const right = api.buildProfileFromSeed('seed-abc');
  const other = api.buildProfileFromSeed('seed-def');

  assert.deepStrictEqual(left, right);
  assert.notDeepStrictEqual(left, other);
});

test('fingerprint bootstrap keeps default locales in English or Chinese', () => {
  ['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5'].forEach((seed) => {
    const profile = api.buildProfileFromSeed(seed);
    assert.match(profile.locale, /^(en|zh)-/);
    assert.equal(profile.languages.every((language) => /^(en|zh)(?:-|$)/.test(language)), true);
  });
});

test('fingerprint bootstrap installs navigator and screen overrides from window name seed', () => {
  function FakeDate() {}
  FakeDate.prototype.getTimezoneOffset = function getTimezoneOffset() {
    return 0;
  };

  function FakeDateTimeFormat() {}
  FakeDateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
    return {
      locale: 'en-US',
      timeZone: 'UTC',
    };
  };

  const navigator = {};
  const screen = {};
  const mockWindow = {
    name: '__MPFP__:seed-install',
    navigator,
    screen,
    Intl: {
      DateTimeFormat: FakeDateTimeFormat,
    },
    Date: FakeDate,
  };
  mockWindow.top = mockWindow;

  const profile = api.installFingerprintFromWindowName(mockWindow);

  assert.equal(profile.seed, 'seed-install');
  assert.equal(mockWindow.navigator.webdriver, false);
  assert.equal(mockWindow.navigator.userAgent, profile.userAgent);
  assert.deepStrictEqual(mockWindow.navigator.languages, profile.languages);
  assert.equal(mockWindow.navigator.userLanguage, profile.language);
  assert.equal(mockWindow.navigator.browserLanguage, profile.language);
  assert.equal(mockWindow.screen.width, profile.screen.width);
  assert.equal(new mockWindow.Intl.DateTimeFormat().resolvedOptions().timeZone, profile.timezone);
  assert.equal(new mockWindow.Date().getTimezoneOffset(), profile.timezoneOffsetMinutes);
});

test('fingerprint bootstrap injects locale-aware Date helpers with default timezone', () => {
  function FakeDate() {}
  FakeDate.prototype.getTimezoneOffset = function getTimezoneOffset() {
    return 0;
  };
  FakeDate.prototype.toLocaleString = function toLocaleString(locales, options) {
    return JSON.stringify({ locales, options });
  };

  function FakeDateTimeFormat() {}
  FakeDateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
    return {
      locale: 'en-US',
      timeZone: 'UTC',
    };
  };

  function FakeNumberFormat() {}
  FakeNumberFormat.prototype.resolvedOptions = function resolvedOptions() {
    return {
      locale: 'en-US',
      numberingSystem: 'latn',
    };
  };

  const mockWindow = {
    name: '__MPFP__:seed-date-helpers',
    navigator: {},
    screen: {},
    Intl: {
      DateTimeFormat: FakeDateTimeFormat,
      NumberFormat: FakeNumberFormat,
    },
    Date: FakeDate,
  };
  mockWindow.top = mockWindow;

  const profile = api.installFingerprintFromWindowName(mockWindow);
  const payload = JSON.parse(new mockWindow.Date().toLocaleString());

  assert.equal(payload.locales, profile.locale);
  assert.equal(payload.options.timeZone, profile.timezone);
  assert.equal(new mockWindow.Intl.NumberFormat().resolvedOptions().locale, profile.locale);
});
