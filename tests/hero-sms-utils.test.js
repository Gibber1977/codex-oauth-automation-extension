const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadHeroSmsUtils({ fetchImpl, storageSeed = {} } = {}) {
  const source = fs.readFileSync('hero-sms-utils.js', 'utf8');
  const storage = {
    heroSmsPhoneRecords: storageSeed.heroSmsPhoneRecords || {},
  };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') {
            return { [key]: storage[key] };
          }
          return { ...storage };
        },
        async set(payload) {
          Object.assign(storage, payload);
        },
      },
    },
  };

  const api = new Function(
    'chrome',
    'fetch',
    'setTimeout',
    'self',
    `${source}; return self.HeroSmsUtils;`
  )(
    chrome,
    fetchImpl,
    (callback) => {
      callback();
      return 0;
    },
    {}
  );

  return { api, storage };
}

test('findOrCreateSmsActivation reuses latest matching activation with available record slots', async () => {
  const fetchCalls = [];
  const { api } = loadHeroSmsUtils({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      if (url.includes('getActiveActivations')) {
        return {
          headers: { get: () => 'application/json' },
          json: async () => ({
            status: 'success',
            data: [
              {
                activationId: 'older',
                phoneNumber: '+66911111111',
                countryCode: '52',
                serviceCode: 'dr',
                activationTime: '2026-04-18T08:00:00Z',
              },
              {
                activationId: 'newer',
                phoneNumber: '+66922222222',
                countryCode: '52',
                serviceCode: 'dr',
                activationTime: '2026-04-18T09:00:00Z',
              },
            ],
          }),
        };
      }
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success' }),
      };
    },
    storageSeed: {
      heroSmsPhoneRecords: {
        '66911111111': ['111111', '222222', '333333'],
      },
    },
  });

  const result = await api.findOrCreateSmsActivation('hero-key', '52');

  assert.equal(result.activationId, 'newer');
  assert.equal(result.phoneNumber, '+66922222222');
  assert.equal(result.activationTime, '2026-04-18T09:00:00Z');
  assert.equal(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('id=newer')), true);
  assert.equal(fetchCalls.some((url) => url.includes('action=getNumberV2')), false);
});

test('findOrCreateSmsActivation skips excluded activations and phone numbers', async () => {
  const fetchCalls = [];
  const { api } = loadHeroSmsUtils({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      if (url.includes('getActiveActivations')) {
        return {
          headers: { get: () => 'application/json' },
          json: async () => ({
            status: 'success',
            data: [
              {
                activationId: 'skip-me',
                phoneNumber: '+66944444444',
                countryCode: '52',
                serviceCode: 'dr',
                activationTime: '2026-04-18T10:00:00Z',
              },
              {
                activationId: 'keep-me',
                phoneNumber: '+66955555555',
                countryCode: '52',
                serviceCode: 'dr',
                activationTime: '2026-04-18T09:00:00Z',
              },
            ],
          }),
        };
      }
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success' }),
      };
    },
  });

  const result = await api.findOrCreateSmsActivation('hero-key', '52', {
    excludeActivationIds: ['skip-me'],
    excludePhoneNumbers: ['+66944444444'],
  });

  assert.equal(result.activationId, 'keep-me');
  assert.equal(result.phoneNumber, '+66955555555');
  assert.equal(result.activationTime, '2026-04-18T09:00:00Z');
  assert.equal(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('id=keep-me')), true);
});

test('pollSmsVerificationCode skips duplicate code and returns the next new code', async () => {
  let pollCount = 0;
  const logs = [];
  const { api, storage } = loadHeroSmsUtils({
    fetchImpl: async (url) => {
      if (url.includes('getActiveActivations')) {
        pollCount += 1;
        return {
          headers: { get: () => 'application/json' },
          json: async () => ({
            status: 'success',
            data: [{
              activationId: 'act-1',
              phoneNumber: '+66912345678',
              smsCode: pollCount === 1 ? '111111' : '222222',
            }],
          }),
        };
      }
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success' }),
      };
    },
    storageSeed: {
      heroSmsPhoneRecords: {
        '66912345678': ['111111'],
      },
    },
  });

  const code = await api.pollSmsVerificationCode(
    'hero-key',
    'act-1',
    async (_step, message, level) => {
      logs.push({ message, level });
    },
    8,
    async () => {}
  );

  assert.equal(code, '222222');
  assert.equal(logs.some(({ message }) => /检测到旧验证码/.test(message)), true);
  assert.deepStrictEqual(storage.heroSmsPhoneRecords['66912345678'], ['111111', '222222']);
});

test('pollSmsVerificationCode stops early when activation age exceeds five minutes', async () => {
  const logs = [];
  const { api } = loadHeroSmsUtils({
    fetchImpl: async () => ({
      headers: { get: () => 'application/json' },
      json: async () => ({
        status: 'success',
        data: [{
          activationId: 'act-1',
          phoneNumber: '+66912345678',
          smsCode: '111111',
        }],
      }),
    }),
    storageSeed: {
      heroSmsPhoneRecords: {
        '66912345678': ['111111'],
      },
    },
  });

  await assert.rejects(
    () => api.pollSmsVerificationCode(
      'hero-key',
      'act-1',
      async (_step, message, level) => {
        logs.push({ message, level });
      },
      8,
      async () => {},
      {
        activationTime: new Date(Date.now() - (6 * 60 * 1000)).toISOString(),
        maxActivationAgeMs: 5 * 60 * 1000,
      }
    ),
    /激活已超过 5 分钟/
  );

  assert.equal(logs.some(({ message }) => /停止继续等待短信验证码并准备更换号码/.test(message)), true);
});
