const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuthPageRecovery } = require('../content/auth-page-recovery.js');

function createRetryButton(options = {}) {
  const {
    actionName = 'Try again',
    textContent = 'Try again',
  } = options;
  return {
    disabled: false,
    textContent,
    getAttribute(name) {
      if (name === 'data-dd-action-name') return actionName;
      if (name === 'aria-disabled') return 'false';
      return '';
    },
  };
}

function createRecoveryApi(state) {
  const retryButton = createRetryButton({
    actionName: state.retryActionName,
    textContent: state.retryButtonText,
  });
  global.location = {
    pathname: '/log-in',
    href: 'https://auth.openai.com/log-in',
  };
  global.document = {
    title: 'Something went wrong',
    querySelector(selector) {
      if (
        selector === 'button[data-dd-action-name="Try again"]'
        && state.retryVisible
        && retryButton.getAttribute('data-dd-action-name') === 'Try again'
      ) {
        return retryButton;
      }
      return null;
    },
    querySelectorAll() {
      return state.retryVisible ? [retryButton] : [];
    },
  };

  return createAuthPageRecovery({
    detailPattern: /timed out|invalid_state|验证过程中出错|verification encountered an error/i,
    getActionText: (element) => element?.textContent || '',
    getPageTextSnapshot: () => state.pageText,
    humanPause: async () => {},
    isActionEnabled: (element) => Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true',
    isVisibleElement: () => true,
    log: () => {},
    simulateClick: () => {
      state.clickCount += 1;
      if (typeof state.onClick === 'function') {
        state.onClick(state);
        return;
      }
      state.retryVisible = false;
      state.pageText = 'Recovered login form';
    },
    sleep: async (ms = 0) => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(5, ms))));
      if (typeof state.onSleep === 'function') {
        state.onSleep(state);
      }
    },
    throwIfStopped: () => {},
    titlePattern: /something went wrong/i,
  });
}

test('auth page recovery detects retry page state', () => {
  const state = {
    clickCount: 0,
    pageText: 'Something went wrong. Please try again.',
    retryVisible: true,
  };
  const api = createRecoveryApi(state);

  const snapshot = api.getAuthTimeoutErrorPageState({
    pathPatterns: [/\/log-in(?:[/?#]|$)/i],
  });

  assert.equal(Boolean(snapshot), true);
  assert.equal(snapshot.retryEnabled, true);
  assert.equal(snapshot.titleMatched, true);
  assert.equal(snapshot.detailMatched, false);
  assert.equal(snapshot.maxCheckAttemptsBlocked, false);
});

test('auth page recovery also detects invalid_state retry pages', () => {
  const state = {
    clickCount: 0,
    pageText: '糟糕，出错了！ 验证过程中出错 (invalid_state)。请重试。',
    retryVisible: true,
  };
  const api = createRecoveryApi(state);

  const snapshot = api.getAuthTimeoutErrorPageState({
    pathPatterns: [/\/log-in(?:[/?#]|$)/i],
  });

  assert.equal(Boolean(snapshot), true);
  assert.equal(snapshot.titleMatched, true);
  assert.equal(snapshot.detailMatched, true);
});

test('auth page recovery detects Japanese retry button text', () => {
  const state = {
    clickCount: 0,
    pageText: '不明なエラーが発生しました。認証中にエラーが発生しました (invalid_state)。再試行してください。',
    retryVisible: true,
    retryActionName: '',
    retryButtonText: 'もう一度試す',
  };
  const api = createRecoveryApi(state);

  const snapshot = api.getAuthTimeoutErrorPageState({
    pathPatterns: [/\/log-in(?:[/?#]|$)/i],
  });

  assert.equal(Boolean(snapshot), true);
  assert.equal(snapshot.retryEnabled, true);
  assert.equal(snapshot.detailMatched, true);
});

test('auth page recovery clicks retry and waits until page recovers', async () => {
  const state = {
    clickCount: 0,
    pageText: 'Something went wrong. Please try again.',
    retryVisible: true,
  };
  const api = createRecoveryApi(state);

  const result = await api.recoverAuthRetryPage({
    logLabel: '步骤 8：检测到重试页，正在点击“重试”恢复',
    pathPatterns: [/\/log-in(?:[/?#]|$)/i],
    step: 8,
    timeoutMs: 1000,
  });

  assert.deepStrictEqual(result, {
    recovered: true,
    clickCount: 1,
    url: 'https://auth.openai.com/log-in',
  });
  assert.equal(state.clickCount, 1);
  assert.equal(state.retryVisible, false);
});

test('auth page recovery can click retry twice before page recovers', async () => {
  const state = {
    clickCount: 0,
    pageText: 'Something went wrong. Please try again.',
    retryVisible: true,
    onClick(currentState) {
      if (currentState.clickCount >= 2) {
        currentState.retryVisible = false;
        currentState.pageText = 'Recovered login form';
      }
    },
  };
  const api = createRecoveryApi(state);

  const result = await api.recoverAuthRetryPage({
    logLabel: '步骤 8：检测到重试页，正在点击“重试”恢复',
    pathPatterns: [/\/log-in(?:[/?#]|$)/i],
    step: 8,
    timeoutMs: 200,
    waitAfterClickMs: 10,
    pollIntervalMs: 1,
  });

  assert.deepStrictEqual(result, {
    recovered: true,
    clickCount: 2,
    url: 'https://auth.openai.com/log-in',
  });
  assert.equal(state.clickCount, 2);
  assert.equal(state.retryVisible, false);
});

test('auth page recovery stops after five retry clicks when page does not recover', async () => {
  const state = {
    clickCount: 0,
    pageText: 'Something went wrong. Please try again.',
    retryVisible: true,
    onClick() {},
  };
  const api = createRecoveryApi(state);

  await assert.rejects(
    () => api.recoverAuthRetryPage({
      logLabel: '步骤 8：检测到重试页，正在点击“重试”恢复',
      maxClickAttempts: 5,
      pathPatterns: [/\/log-in(?:[/?#]|$)/i],
      step: 8,
      timeoutMs: 1000,
      waitAfterClickMs: 10,
      pollIntervalMs: 1,
    }),
    /已连续点击“重试” 5 次/
  );

  assert.equal(state.clickCount, 5);
  assert.equal(state.retryVisible, true);
});

test('auth page recovery throws cloudflare security blocked error on max_check_attempts page', async () => {
  const state = {
    clickCount: 0,
    pageText: 'Something went wrong. max_check_attempts reached.',
    retryVisible: true,
  };
  const api = createRecoveryApi(state);

  await assert.rejects(
    () => api.recoverAuthRetryPage({
      logLabel: '步骤 7：检测到登录超时报错，正在点击“重试”恢复当前页面',
      pathPatterns: [/\/log-in(?:[/?#]|$)/i],
      step: 7,
      timeoutMs: 1000,
    }),
    /CF_SECURITY_BLOCKED::/
  );
});

