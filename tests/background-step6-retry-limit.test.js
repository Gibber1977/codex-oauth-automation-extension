const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('step 6 runs cookie cleanup and completes from background', async () => {
  const source = fs.readFileSync('background/steps/clear-login-cookies.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundStep6;`)(globalScope);

  const events = {
    cleanupCalls: 0,
    completedSteps: [],
  };

  const executor = api.createStep6Executor({
    completeStepFromBackground: async (step) => {
      events.completedSteps.push(step);
    },
    runPreStep6CookieCleanup: async () => {
      events.cleanupCalls += 1;
    },
  });

  await executor.executeStep6();

  assert.equal(events.cleanupCalls, 1);
  assert.deepStrictEqual(events.completedSteps, [6]);
});

test('step 7 retries up to configured limit and then fails', async () => {
  const source = fs.readFileSync('background/steps/oauth-login.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundStep7;`)(globalScope);

  const events = {
    refreshCalls: 0,
    sendCalls: 0,
    completed: 0,
  };

  const executor = api.createStep7Executor({
    addLog: async () => {},
    completeStepFromBackground: async () => {
      events.completed += 1;
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (state) => state || 'unknown',
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    isStep6RecoverableResult: (result) => result?.step6Outcome === 'recoverable',
    isStep6SuccessResult: (result) => result?.step6Outcome === 'success',
    refreshOAuthUrlBeforeStep6: async () => {
      events.refreshCalls += 1;
      return `https://oauth.example/${events.refreshCalls}`;
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async () => {
      events.sendCalls += 1;
      return {
        step6Outcome: 'recoverable',
        state: 'email_page',
        message: '当前仍停留在邮箱页。',
      };
    },
    shouldSkipLoginVerificationForCpaCallback: () => false,
    skipLoginVerificationStepsForCpaCallback: async () => {},
    STEP6_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep7({ email: 'user@example.com', password: 'secret' }),
    /已重试 2 次，仍未成功/
  );

  assert.equal(events.refreshCalls, 3);
  assert.equal(events.sendCalls, 3);
  assert.equal(events.completed, 0);
});
