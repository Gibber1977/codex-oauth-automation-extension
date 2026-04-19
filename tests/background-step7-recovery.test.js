const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/fetch-login-code.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep8;`)(globalScope);

test('step 8 submits login verification directly without replaying step 7', async () => {
  const calls = {
    ensureReady: 0,
    ensureReadyOptions: [],
    rerunStep7: 0,
    resolveOptions: null,
    setStates: [],
  };
  const realDateNow = Date.now;
  Date.now = () => 123456;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async (options) => {
      calls.ensureReady += 1;
      calls.ensureReadyOptions.push(options || null);
      return { state: 'verification_page', displayedEmail: 'display.user@example.com' };
    },
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 5000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      calls.resolveOptions = options;
    },
    reuseOrCreateTab: async () => {},
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  try {
    await executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    });
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(calls.resolveOptions.beforeSubmit, undefined);
  assert.equal(typeof calls.resolveOptions.afterSubmitSuccess, 'function');
  assert.equal(calls.ensureReady, 1);
  assert.equal(calls.rerunStep7, 0);
  assert.equal(calls.resolveOptions.filterAfterTimestamp, 123456);
  assert.equal(typeof calls.resolveOptions.getRemainingTimeMs, 'function');
  assert.equal(await calls.resolveOptions.getRemainingTimeMs({ actionLabel: '登录验证码流程' }), 5000);
  assert.equal(calls.resolveOptions.resendIntervalMs, 25000);
  assert.equal(calls.resolveOptions.targetEmail, 'display.user@example.com');
  assert.deepStrictEqual(calls.setStates, [
    { step8VerificationTargetEmail: 'display.user@example.com' },
  ]);
  assert.deepStrictEqual(calls.ensureReadyOptions, [
    { timeoutMs: 5000 },
  ]);
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
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: '2925',
      label: '2925 邮箱',
      source: 'mail-2925',
      url: 'https://2925.com',
      navigateOnReuse: false,
    }),
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
    shouldUseCustomRegistrationEmail: () => false,
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
  assert.equal(capturedOptions.targetEmail, '');
  assert.equal(capturedOptions.beforeSubmit, undefined);
  assert.equal(typeof capturedOptions.afterSubmitSuccess, 'function');
  assert.equal(typeof capturedOptions.getRemainingTimeMs, 'function');
});

test('step 8 falls back to the run email when the verification page does not expose a displayed email', async () => {
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
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page', displayedEmail: '' }),
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
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
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(capturedOptions.targetEmail, 'user@example.com');
});

test('step 8 does not rerun step 7 when verification submit lands on add-phone', async () => {
  const calls = {
    rerunStep7: 0,
    logs: [],
  };

  const executor = api.createStep8Executor({
    addLog: async (message, level = 'info') => {
      calls.logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      throw new Error('步骤 8：验证码提交后页面进入手机号页面，当前流程无法继续自动授权。 URL: https://auth.openai.com/add-phone');
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /add-phone/
  );

  assert.equal(calls.rerunStep7, 0);
  assert.ok(!calls.logs.some(({ message }) => /准备从步骤 7 重新开始/.test(message)));
});

test('step 8 uses Hero-SMS flow when add-phone page is active', async () => {
  const calls = {
    complete: [],
    contentMessages: [],
    logs: [],
    setState: [],
  };

  const executor = api.createStep8Executor({
    addLog: async (message, level) => {
      calls.logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (step, payload) => {
      calls.complete.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async (apiKey, country) => {
      assert.equal(apiKey, 'hero-key');
      assert.equal(country, '52');
      return {
        activationId: 'act-1',
        phoneNumber: '+66912345678',
      };
    },
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async (_apiKey, activationId, onLog) => {
      assert.equal(activationId, 'act-1');
      await onLog(8, '已获取短信验证码：654321', 'ok');
      return '654321';
    },
    resolveVerificationStep: async () => {
      throw new Error('email verification branch should not be used in hero sms flow');
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      if (message.type === 'STEP8_GET_STATE') {
        return { addPhonePage: true };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true };
      }
      if (message.type === 'STEP8_SUBMIT_SMS_CODE') {
        return { consentReady: true };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async (payload) => {
      calls.setState.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    heroSmsEnabled: true,
    heroSmsApiKey: 'hero-key',
    heroSmsCountry: '52',
  });

  assert.deepStrictEqual(calls.complete, [
    { step: 8, payload: {} },
  ]);
  assert.equal(calls.contentMessages[0]?.type, 'STEP8_GET_STATE');
  assert.equal(calls.contentMessages.at(-2)?.type, 'STEP8_SUBMIT_PHONE_NUMBER');
  assert.equal(calls.contentMessages.at(-1)?.type, 'STEP8_SUBMIT_SMS_CODE');
  assert.ok(
    calls.setState.some((payload) => payload.currentHeroSmsActivationId === 'act-1'),
    'hero sms activation should be stored in session state'
  );
  assert.ok(
    calls.setState.some((payload) => payload.lastLoginCode === '654321'),
    'hero sms code should be stored as latest login code'
  );
});

test('step 8 continues into Hero-SMS when email code submit lands on add-phone', async () => {
  const calls = {
    complete: [],
    contentMessages: [],
    logs: [],
    setState: [],
  };
  let capturedAfterSubmitSuccess = null;
  let step8StateQueryCount = 0;

  const executor = api.createStep8Executor({
    addLog: async (message, level) => {
      calls.logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (step, payload) => {
      calls.complete.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async () => ({
      activationId: 'act-2',
      phoneNumber: '+66987654321',
    }),
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async () => '888888',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      capturedAfterSubmitSuccess = options.afterSubmitSuccess;
      const result = await options.afterSubmitSuccess({
        polledCode: '123456',
        pollResult: { emailTimestamp: 123 },
        submitResult: { success: true, addPhonePage: true },
        step: 8,
      });
      assert.deepStrictEqual(result, { handled: true });
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      if (message.type === 'STEP8_GET_STATE') {
        step8StateQueryCount += 1;
        return step8StateQueryCount >= 2
          ? { addPhonePage: true }
          : { addPhonePage: false };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true };
      }
      if (message.type === 'STEP8_SUBMIT_SMS_CODE') {
        return { consentReady: true };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async (payload) => {
      calls.setState.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    heroSmsEnabled: true,
    heroSmsApiKey: 'hero-key',
    heroSmsCountry: '52',
  });

  assert.equal(typeof capturedAfterSubmitSuccess, 'function');
  assert.equal(step8StateQueryCount, 3);
  assert.deepStrictEqual(calls.complete, [
    { step: 8, payload: {} },
  ]);
  assert.equal(calls.contentMessages.at(-2)?.type, 'STEP8_SUBMIT_PHONE_NUMBER');
  assert.equal(calls.contentMessages.at(-1)?.type, 'STEP8_SUBMIT_SMS_CODE');
  assert.ok(
    calls.logs.some(({ message }) => /登录邮箱验证码提交后已进入手机号验证页/.test(message)),
    'should log handoff from email verification to hero sms'
  );
});

test('step 8 cancels timed out Hero-SMS activations and retries with a new number', async () => {
  const calls = {
    cancelRequests: [],
    complete: [],
    contentMessages: [],
    logs: [],
    setState: [],
    tabUpdates: [],
  };
  let activationPickCount = 0;
  let pollCount = 0;

  const executor = api.createStep8Executor({
    addLog: async (message, level) => {
      calls.logs.push({ message, level });
    },
    cancelHeroSmsActivation: async (apiKey, activationId) => {
      calls.cancelRequests.push({ apiKey, activationId });
      return { status: 'success' };
    },
    chrome: {
      tabs: {
        get: async () => ({ id: 1, url: 'https://auth.openai.com/add-phone' }),
        update: async (tabId, payload) => {
          calls.tabUpdates.push({ tabId, payload });
        },
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (step, payload) => {
      calls.complete.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async (_apiKey, _country, options = {}) => {
      activationPickCount += 1;
      if (activationPickCount === 1) {
        assert.deepStrictEqual(options.excludeActivationIds || [], []);
        return { activationId: 'act-timeout-1', phoneNumber: '+66911111111' };
      }
      if (activationPickCount === 2) {
        assert.deepStrictEqual(options.excludeActivationIds || [], ['act-timeout-1']);
        return { activationId: 'act-timeout-2', phoneNumber: '+66922222222' };
      }
      assert.deepStrictEqual(options.excludeActivationIds || [], ['act-timeout-1', 'act-timeout-2']);
      return { activationId: 'act-ok-3', phoneNumber: '+66933333333' };
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS: 3,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async () => {
      pollCount += 1;
      if (pollCount < 3) {
        throw new Error('等待短信验证码超时（5分钟）');
      }
      return '456789';
    },
    resolveVerificationStep: async () => {
      throw new Error('email verification branch should not be used in hero sms flow');
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      if (message.type === 'STEP8_GET_STATE') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_SMS_CODE') {
        return { consentReady: true };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async (payload) => {
      calls.setState.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    heroSmsEnabled: true,
    heroSmsApiKey: 'hero-key',
    heroSmsCountry: '52',
  });

  assert.deepStrictEqual(calls.cancelRequests, [
    { apiKey: 'hero-key', activationId: 'act-timeout-1' },
    { apiKey: 'hero-key', activationId: 'act-timeout-2' },
  ]);
  assert.deepStrictEqual(calls.complete, [
    { step: 8, payload: {} },
  ]);
  assert.equal(
    calls.tabUpdates.some(({ payload }) => payload?.url === 'https://auth.openai.com/add-phone'),
    true,
    'should reload add-phone page before retrying with a fresh number'
  );
  assert.equal(
    calls.logs.some(({ message }) => /第 1\/3 次等待短信验证码超时/.test(message)),
    true
  );
  assert.equal(
    calls.logs.some(({ message }) => /第 2\/3 次等待短信验证码超时/.test(message)),
    true
  );
  assert.ok(
    calls.setState.some((payload) => payload.currentHeroSmsActivationId === null),
    'timed out activation should be cleared from state before retry'
  );
  assert.ok(
    calls.setState.some((payload) => payload.lastLoginCode === '456789'),
    'final successful sms code should still be stored'
  );
});

test('step 8 waits for add-phone page to recover before switching to the next Hero-SMS number', async () => {
  const calls = {
    cancelRequests: [],
    contentMessages: [],
    tabUpdates: [],
  };
  let activationPickCount = 0;
  let pollCount = 0;
  let tabGetCount = 0;
  let pageStateChecks = 0;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    cancelHeroSmsActivation: async (apiKey, activationId) => {
      calls.cancelRequests.push({ apiKey, activationId });
      return { status: 'success' };
    },
    chrome: {
      tabs: {
        get: async () => {
          tabGetCount += 1;
          return tabGetCount < 2
            ? { id: 1, url: 'https://auth.openai.com/phone-verification' }
            : { id: 1, url: 'https://auth.openai.com/add-phone' };
        },
        update: async (tabId, payload) => {
          calls.tabUpdates.push({ tabId, payload });
        },
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async () => {
      activationPickCount += 1;
      return activationPickCount === 1
        ? { activationId: 'act-timeout-1', phoneNumber: '+66911111111' }
        : { activationId: 'act-ok-2', phoneNumber: '+66922222222' };
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
      heroSmsMaxRetryCount: 2,
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS: 3,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async () => {
      pollCount += 1;
      if (pollCount === 1) {
        throw new Error('等待短信验证码超时（5分钟）');
      }
      return '567890';
    },
    resolveVerificationStep: async () => {
      throw new Error('email verification branch should not be used in hero sms flow');
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      if (message.type === 'STEP8_GET_STATE') {
        pageStateChecks += 1;
        if (pageStateChecks <= 2) {
          return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
        }
        if (pageStateChecks === 3) {
          return { addPhonePage: false, phoneVerificationPage: true, url: 'https://auth.openai.com/phone-verification' };
        }
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_SMS_CODE') {
        return { consentReady: true };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    heroSmsEnabled: true,
    heroSmsApiKey: 'hero-key',
    heroSmsCountry: '52',
    heroSmsMaxRetryCount: 2,
  });

  assert.deepStrictEqual(calls.cancelRequests, [
    { apiKey: 'hero-key', activationId: 'act-timeout-1' },
  ]);
  assert.equal(
    calls.tabUpdates.some(({ payload }) => payload?.url === 'https://auth.openai.com/add-phone'),
    true
  );
  assert.equal(tabGetCount >= 2, true, 'should wait for tab url to move back to add-phone');
});

test('step 8 honors configured Hero-SMS retry count', async () => {
  const calls = {
    cancelRequests: [],
  };
  let activationPickCount = 0;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    cancelHeroSmsActivation: async (apiKey, activationId) => {
      calls.cancelRequests.push({ apiKey, activationId });
      return { status: 'success' };
    },
    chrome: {
      tabs: {
        get: async () => ({ id: 1, url: 'https://auth.openai.com/add-phone' }),
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {
      throw new Error('step 8 should not complete when configured hero sms retries time out');
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async () => {
      activationPickCount += 1;
      return {
        activationId: `act-timeout-${activationPickCount}`,
        phoneNumber: `+6690000000${activationPickCount}`,
      };
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
      heroSmsMaxRetryCount: 2,
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS: 3,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async () => {
      throw new Error('等待短信验证码超时（5分钟）');
    },
    resolveVerificationStep: async () => {
      throw new Error('email verification branch should not be used in hero sms flow');
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'STEP8_GET_STATE') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
      heroSmsMaxRetryCount: 2,
    }),
    /Hero-SMS 连续 2 次等待短信验证码超时，已取消当前号码/
  );

  assert.deepStrictEqual(calls.cancelRequests, [
    { apiKey: 'hero-key', activationId: 'act-timeout-1' },
    { apiKey: 'hero-key', activationId: 'act-timeout-2' },
  ]);
});

test('step 8 fails after three Hero-SMS polling timeouts and cancels the last activation', async () => {
  const calls = {
    cancelRequests: [],
    logs: [],
    setState: [],
  };
  let activationPickCount = 0;

  const executor = api.createStep8Executor({
    addLog: async (message, level) => {
      calls.logs.push({ message, level });
    },
    cancelHeroSmsActivation: async (apiKey, activationId) => {
      calls.cancelRequests.push({ apiKey, activationId });
      return { status: 'success' };
    },
    chrome: {
      tabs: {
        get: async () => ({ id: 1, url: 'https://auth.openai.com/add-phone' }),
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {
      throw new Error('step 8 should not complete when all hero sms retries time out');
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    executeStep7: async () => {},
    findOrCreateSmsActivation: async () => {
      activationPickCount += 1;
      return {
        activationId: `act-timeout-${activationPickCount}`,
        phoneNumber: `+6690000000${activationPickCount}`,
      };
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
    }),
    getTabId: async (sourceName) => (sourceName === 'signup-page' ? 1 : null),
    HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX: 'chrome.storage.local://heroSmsPhoneRecords',
    HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS: 3,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    pollSmsVerificationCode: async () => {
      throw new Error('等待短信验证码超时（5分钟）');
    },
    resolveVerificationStep: async () => {
      throw new Error('email verification branch should not be used in hero sms flow');
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'STEP8_GET_STATE') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      if (message.type === 'STEP8_SUBMIT_PHONE_NUMBER') {
        return { addPhonePage: true, url: 'https://auth.openai.com/add-phone' };
      }
      throw new Error(`unexpected message ${message.type}`);
    },
    setState: async (payload) => {
      calls.setState.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
      heroSmsEnabled: true,
      heroSmsApiKey: 'hero-key',
      heroSmsCountry: '52',
    }),
    /Hero-SMS 连续 3 次等待短信验证码超时，已取消当前号码/
  );

  assert.deepStrictEqual(calls.cancelRequests, [
    { apiKey: 'hero-key', activationId: 'act-timeout-1' },
    { apiKey: 'hero-key', activationId: 'act-timeout-2' },
    { apiKey: 'hero-key', activationId: 'act-timeout-3' },
  ]);
  assert.equal(
    calls.logs.some(({ message }) => /准备取消当前号码并结束当前轮次/.test(message)),
    true
  );
  assert.ok(
    calls.setState.some((payload) => payload.currentHeroSmsActivationId === null),
    'failed final timeout should also clear current hero sms activation state'
  );
});
