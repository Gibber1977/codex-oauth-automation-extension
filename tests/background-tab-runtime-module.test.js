const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports tab runtime module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/tab-runtime\.js/);
});

test('tab runtime module exposes a factory', () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  assert.equal(typeof api?.createTabRuntime, 'function');
});

test('tab runtime waitForTabComplete waits until tab status becomes complete', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let getCalls = 0;
  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    buildLocalhostCleanupPrefix: () => '',
    chrome: {
      tabs: {
        get: async () => {
          getCalls += 1;
          return {
            id: 9,
            url: 'https://example.com',
            status: getCalls >= 3 ? 'complete' : 'loading',
          };
        },
        query: async () => [],
      },
    },
    getSourceLabel: (source) => source || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    matchesSourceUrlFamily: () => false,
    normalizeLocalCpaStep9Mode: () => 'submit',
    parseUrlSafely: () => null,
    registerTab: async () => {},
    setState: async () => {},
    shouldBypassStep9ForLocalCpa: () => false,
    throwIfStopped: () => {},
  });

  const result = await runtime.waitForTabComplete(9, {
    timeoutMs: 2000,
    retryDelayMs: 1,
  });

  assert.equal(result?.status, 'complete');
  assert.equal(getCalls, 3);
});

test('tab runtime waitForTabComplete aborts promptly when stop is requested', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let throwCalls = 0;
  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({
          id: 9,
          url: 'https://example.com',
          status: 'loading',
        }),
        query: async () => [],
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    matchesSourceUrlFamily: () => false,
    setState: async () => {},
    throwIfStopped: () => {
      throwCalls += 1;
      if (throwCalls >= 2) {
        throw new Error('Flow stopped.');
      }
    },
  });

  await assert.rejects(
    runtime.waitForTabComplete(9, {
      timeoutMs: 2000,
      retryDelayMs: 1,
    }),
    /Flow stopped\./
  );
});

test('tab runtime bootstraps window.name with a redirect page before navigating a new tab when requested', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const listeners = new Set();
  const tabs = {};
  let createdUrl = '';
  let getCalls = 0;

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async (tabId) => {
          getCalls += 1;
          if (getCalls >= 2 && tabs[tabId]) {
            tabs[tabId] = {
              ...tabs[tabId],
              url: 'https://chatgpt.com/',
              status: 'complete',
            };
          }
          return tabs[tabId];
        },
        query: async () => [],
        create: async ({ url, active }) => {
          createdUrl = url;
          tabs[21] = {
            id: 21,
            url,
            active,
            status: 'complete',
          };
          return tabs[21];
        },
        update: async (tabId, payload) => {
          tabs[tabId] = {
            ...tabs[tabId],
            ...payload,
            id: tabId,
            status: 'complete',
          };
          for (const listener of listeners) {
            listener(tabId, { status: 'complete' });
          }
          return tabs[tabId];
        },
        onUpdated: {
          addListener(listener) {
            listeners.add(listener);
            setTimeout(() => {
              if (tabs[21]?.status === 'complete') {
                listener(21, { status: 'complete' });
              }
            }, 0);
          },
          removeListener(listener) {
            listeners.delete(listener);
          },
        },
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: (_sourceName, currentUrl, referenceUrl) => currentUrl === referenceUrl,
    setState: async () => {},
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  const tabId = await runtime.reuseOrCreateTab('signup-page', 'https://chatgpt.com/', {
    windowNameValue: '__MPFP__:seed-1',
  });

  assert.equal(tabId, 21);
  assert.match(createdUrl, /^data:text\/html;charset=utf-8,/);
  assert.equal(tabs[21].url, 'https://chatgpt.com/');
  assert.match(decodeURIComponent(createdUrl), /__MPFP__:seed-1/);
  assert.match(decodeURIComponent(createdUrl), /location\.replace/);
});

test('tab runtime waits for auth.openai.com before treating OAuth signup tab as ready', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const listeners = new Set();
  const tabs = {};
  let getCalls = 0;

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async (tabId) => {
          getCalls += 1;
          if (getCalls === 1) {
            tabs[tabId] = {
              ...tabs[tabId],
              id: tabId,
              url: 'https://chatgpt.com/',
              status: 'complete',
            };
          } else {
            tabs[tabId] = {
              ...tabs[tabId],
              id: tabId,
              url: 'https://auth.openai.com/log-in',
              status: 'complete',
            };
          }
          return tabs[tabId];
        },
        query: async () => [],
        create: async ({ url, active }) => {
          tabs[21] = {
            id: 21,
            url,
            active,
            status: 'complete',
          };
          return tabs[21];
        },
        update: async (tabId, payload) => {
          tabs[tabId] = {
            ...tabs[tabId],
            ...payload,
            id: tabId,
            status: 'complete',
          };
          for (const listener of listeners) {
            listener(tabId, { status: 'complete' });
          }
          return tabs[tabId];
        },
        onUpdated: {
          addListener(listener) {
            listeners.add(listener);
            setTimeout(() => {
              if (tabs[21]?.status === 'complete') {
                listener(21, { status: 'complete' });
              }
            }, 0);
          },
          removeListener(listener) {
            listeners.delete(listener);
          },
        },
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: (sourceName, currentUrl, referenceUrl) => {
      if (sourceName !== 'signup-page') return currentUrl === referenceUrl;
      return /^https:\/\/(?:chatgpt\.com|auth\.openai\.com)\//.test(currentUrl)
        && /^https:\/\/auth\.openai\.com\//.test(referenceUrl);
    },
    setState: async () => {},
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  const tabId = await runtime.reuseOrCreateTab('signup-page', 'https://auth.openai.com/oauth/authorize?client_id=test', {
    windowNameValue: '__MPFP__:seed-2',
  });

  assert.equal(tabId, 21);
  assert.equal(getCalls, 2);
  assert.equal(tabs[21].url, 'https://auth.openai.com/log-in');
});

test('tab runtime prefers a fresh OAuth tab when signup-page is still on chatgpt.com', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const listeners = new Set();
  let state = {
    tabRegistry: {
      'signup-page': { tabId: 11, ready: true },
    },
    sourceLastUrls: {
      'signup-page': 'https://chatgpt.com/',
    },
  };
  const tabs = {
    11: { id: 11, url: 'https://chatgpt.com/', status: 'complete', active: true },
  };
  const removed = [];
  let createdUrl = '';

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async (tabId) => {
          const tab = tabs[tabId];
          if (!tab) {
            throw new Error('missing tab');
          }
          if (tabId === 21 && /^data:text\/html/.test(tab.url || '')) {
            tabs[tabId] = {
              ...tab,
              url: 'https://auth.openai.com/log-in',
              status: 'complete',
            };
            return tabs[tabId];
          }
          return tab;
        },
        query: async () => Object.values(tabs),
        remove: async (ids) => {
          removed.push(...ids);
          ids.forEach((id) => {
            delete tabs[id];
          });
        },
        create: async ({ url, active }) => {
          createdUrl = url;
          tabs[21] = {
            id: 21,
            url,
            active,
            status: 'complete',
          };
          return tabs[21];
        },
        update: async (tabId, payload) => {
          tabs[tabId] = {
            ...tabs[tabId],
            ...payload,
            id: tabId,
            status: 'complete',
          };
          for (const listener of listeners) {
            listener(tabId, { status: 'complete' });
          }
          return tabs[tabId];
        },
        onUpdated: {
          addListener(listener) {
            listeners.add(listener);
          },
          removeListener(listener) {
            listeners.delete(listener);
          },
        },
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => state,
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: (sourceName, currentUrl, referenceUrl) => {
      if (sourceName !== 'signup-page') return currentUrl === referenceUrl;
      return /^https:\/\/(?:chatgpt\.com|auth\.openai\.com)\//.test(currentUrl)
        && /^https:\/\/auth\.openai\.com\//.test(referenceUrl);
    },
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  const tabId = await runtime.reuseOrCreateTab(
    'signup-page',
    'https://auth.openai.com/oauth/authorize?client_id=test',
    { windowNameValue: '__MPFP__:seed-fresh' }
  );

  assert.equal(tabId, 21);
  assert.deepStrictEqual(removed, [11]);
  assert.equal(state.tabRegistry['signup-page'], null);
  assert.match(createdUrl, /^data:text\/html;charset=utf-8,/);
  assert.equal(tabs[21].url, 'https://auth.openai.com/log-in');
});

test('tab runtime avoids reinjecting signup-page files on manifest-managed auth hosts', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const executeCalls = [];
  let pingCount = 0;
  let state = { tabRegistry: {}, sourceLastUrls: {} };

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({
          id: 21,
          url: 'https://auth.openai.com/log-in',
          status: 'complete',
        }),
        sendMessage: async () => {
          pingCount += 1;
          if (pingCount >= 2) {
            return { ok: true, source: 'signup-page' };
          }
          return null;
        },
      },
      scripting: {
        executeScript: async (payload) => {
          executeCalls.push(payload);
        },
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => state,
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: () => false,
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  await runtime.ensureContentScriptReadyOnTab('signup-page', 21, {
    inject: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    injectSource: 'signup-page',
    timeoutMs: 100,
    retryDelayMs: 1,
  });

  assert.equal(
    executeCalls.some((call) => Array.isArray(call.files) && call.files.length > 0),
    false
  );
  assert.equal(
    executeCalls.some((call) => typeof call.func === 'function'),
    true
  );
});

test('tab runtime still injects signup-page files on chatgpt.com', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const executeCalls = [];
  let pingCount = 0;
  let state = { tabRegistry: {}, sourceLastUrls: {} };

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({
          id: 22,
          url: 'https://chatgpt.com/',
          status: 'complete',
        }),
        sendMessage: async () => {
          pingCount += 1;
          if (pingCount >= 2) {
            return { ok: true, source: 'signup-page' };
          }
          return null;
        },
      },
      scripting: {
        executeScript: async (payload) => {
          executeCalls.push(payload);
        },
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => state,
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: () => false,
    setState: async (patch) => {
      state = { ...state, ...patch };
    },
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  await runtime.ensureContentScriptReadyOnTab('signup-page', 22, {
    inject: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    injectSource: 'signup-page',
    timeoutMs: 100,
    retryDelayMs: 1,
  });

  assert.equal(
    executeCalls.some((call) => Array.isArray(call.files) && call.files.includes('content/signup-page.js')),
    true
  );
});
