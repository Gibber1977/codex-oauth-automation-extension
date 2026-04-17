const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/fetch-login-code.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep8;`)(globalScope);

test('step 8 refreshes CPA oauth via step 7 replay before submitting verification code', async () => {
  const calls = {
    ensureReady: 0,
    executeStep7: 0,
    sleep: [],
    resolveOptions: null,
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => {
      calls.ensureReady += 1;
      return { state: 'verification_page' };
    },
    executeStep7: async () => {
      calls.executeStep7 += 1;
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getPanelMode: () => 'cpa',
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      calls.resolveOptions = options;
      await options.beforeSubmit({ code: '654321' });
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldSkipLoginVerificationForCpaCallback: () => false,
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async (ms) => {
      calls.sleep.push(ms);
    },
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(typeof calls.resolveOptions.beforeSubmit, 'function');
  assert.equal(calls.ensureReady, 2);
  assert.equal(calls.executeStep7, 1);
  assert.deepStrictEqual(calls.sleep, [1200]);
  assert.equal(calls.resolveOptions.resendIntervalMs, 25000);
});

test('step 8 disables resend interval for 2925 mailbox polling', async () => {
  let capturedOptions = null;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    getMailConfig: () => ({
      provider: '2925',
      label: '2925 邮箱',
      source: 'mail-2925',
      url: 'https://2925.com',
      navigateOnReuse: false,
    }),
    getPanelMode: () => 'sub2api',
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      capturedOptions = options;
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldSkipLoginVerificationForCpaCallback: () => false,
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(capturedOptions.resendIntervalMs, 0);
  assert.equal(capturedOptions.beforeSubmit, undefined);
});
