(function attachBackgroundTabRuntime(root, factory) {
  root.MultiPageBackgroundTabRuntime = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundTabRuntimeModule() {
  function createTabRuntime(deps = {}) {
    const {
      addLog,
      chrome,
      getSourceLabel,
      getState,
      isLocalhostOAuthCallbackUrl,
      isRetryableContentScriptTransportError,
      LOG_PREFIX,
      matchesSourceUrlFamily,
      setState,
      sleepWithStop,
      STOP_ERROR_MESSAGE,
      throwIfStopped,
    } = deps;

    const pendingCommands = new Map();

    async function sleepOrStop(ms) {
      if (typeof sleepWithStop === 'function') {
        await sleepWithStop(ms);
        return;
      }

      const start = Date.now();
      while (Date.now() - start < ms) {
        throwIfStopped();
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, ms - (Date.now() - start))));
      }
    }

    function waitForTabUpdateComplete(tabId, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let stopTimer = null;

        const cleanup = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(stopTimer);
          chrome.tabs.onUpdated.removeListener(listener);
        };

        const resolveSafely = () => {
          cleanup();
          resolve();
        };

        const rejectSafely = (error) => {
          cleanup();
          reject(error);
        };

        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            resolveSafely();
          }
        };

        const timer = setTimeout(resolveSafely, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);

        const pollStop = () => {
          if (settled) return;
          try {
            throwIfStopped();
          } catch (error) {
            rejectSafely(error);
            return;
          }
          stopTimer = setTimeout(pollStop, 100);
        };

        pollStop();
      });
    }

    async function getTabRegistry() {
      const state = await getState();
      return state.tabRegistry || {};
    }

    async function registerTab(source, tabId) {
      const registry = await getTabRegistry();
      registry[source] = { tabId, ready: true };
      await setState({ tabRegistry: registry });
      console.log(LOG_PREFIX, `Tab registered: ${source} -> ${tabId}`);
    }

    async function isTabAlive(source) {
      const registry = await getTabRegistry();
      const entry = registry[source];
      if (!entry) return false;
      try {
        await chrome.tabs.get(entry.tabId);
        return true;
      } catch {
        registry[source] = null;
        await setState({ tabRegistry: registry });
        return false;
      }
    }

    async function getTabId(source) {
      const registry = await getTabRegistry();
      return registry[source]?.tabId || null;
    }

    async function rememberSourceLastUrl(source, url) {
      if (!source || !url) return;
      const state = await getState();
      const sourceLastUrls = { ...(state.sourceLastUrls || {}) };
      sourceLastUrls[source] = url;
      await setState({ sourceLastUrls });
    }

    async function closeConflictingTabsForSource(source, currentUrl, options = {}) {
      const { excludeTabIds = [] } = options;
      const excluded = new Set(excludeTabIds.filter((id) => Number.isInteger(id)));
      const state = await getState();
      const lastUrl = state.sourceLastUrls?.[source];
      const referenceUrls = [currentUrl, lastUrl].filter(Boolean);

      if (!referenceUrls.length) return;

      const tabs = await chrome.tabs.query({});
      const matchedIds = tabs
        .filter((tab) => Number.isInteger(tab.id) && !excluded.has(tab.id))
        .filter((tab) => referenceUrls.some((refUrl) => matchesSourceUrlFamily(source, tab.url, refUrl)))
        .map((tab) => tab.id);

      if (!matchedIds.length) return;

      await chrome.tabs.remove(matchedIds).catch(() => { });

      const registry = await getTabRegistry();
      if (registry[source]?.tabId && matchedIds.includes(registry[source].tabId)) {
        registry[source] = null;
        await setState({ tabRegistry: registry });
      }

      await addLog(`已关闭 ${matchedIds.length} 个旧的${getSourceLabel(source)}标签页。`, 'info');
    }

    function isLocalhostOAuthCallbackTabMatch(callbackUrl, candidateUrl) {
      if (!isLocalhostOAuthCallbackUrl(callbackUrl) || !isLocalhostOAuthCallbackUrl(candidateUrl)) {
        return false;
      }

      const callback = new URL(callbackUrl);
      const candidate = new URL(candidateUrl);
      return callback.origin === candidate.origin
        && callback.pathname === candidate.pathname
        && callback.searchParams.get('code') === candidate.searchParams.get('code')
        && callback.searchParams.get('state') === candidate.searchParams.get('state');
    }

    async function closeLocalhostCallbackTabs(callbackUrl, options = {}) {
      if (!isLocalhostOAuthCallbackUrl(callbackUrl)) return 0;

      const { excludeTabIds = [] } = options;
      const excluded = new Set(excludeTabIds.filter((id) => Number.isInteger(id)));
      const tabs = await chrome.tabs.query({});
      const matchedIds = tabs
        .filter((tab) => Number.isInteger(tab.id) && !excluded.has(tab.id))
        .filter((tab) => isLocalhostOAuthCallbackTabMatch(callbackUrl, tab.url))
        .map((tab) => tab.id);

      if (!matchedIds.length) return 0;

      await chrome.tabs.remove(matchedIds).catch(() => { });

      const registry = await getTabRegistry();
      if (registry['signup-page']?.tabId && matchedIds.includes(registry['signup-page'].tabId)) {
        registry['signup-page'] = null;
        await setState({ tabRegistry: registry });
      }

      await addLog(`已关闭 ${matchedIds.length} 个匹配当前 OAuth callback 的 localhost 残留标签页。`, 'info');
      return matchedIds.length;
    }

    function buildLocalhostCleanupPrefix(rawUrl) {
      if (!isLocalhostOAuthCallbackUrl(rawUrl)) return '';
      const parsed = new URL(rawUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (!segments.length) return parsed.origin;
      return `${parsed.origin}/${segments[0]}`;
    }

    async function closeTabsByUrlPrefix(prefix, options = {}) {
      if (!prefix) return 0;

      const { excludeTabIds = [], excludeUrls = [], excludeLocalhostCallbacks = false } = options;
      const excluded = new Set(excludeTabIds.filter((id) => Number.isInteger(id)));
      const excludedUrls = new Set((Array.isArray(excludeUrls) ? excludeUrls : []).filter(Boolean));
      const tabs = await chrome.tabs.query({});
      const matchedIds = tabs
        .filter((tab) => Number.isInteger(tab.id) && !excluded.has(tab.id))
        .filter((tab) => typeof tab.url === 'string' && !excludedUrls.has(tab.url))
        .filter((tab) => !(excludeLocalhostCallbacks && isLocalhostOAuthCallbackUrl(tab.url)))
        .filter((tab) => typeof tab.url === 'string' && tab.url.startsWith(prefix))
        .filter((tab) => !isLocalhostOAuthCallbackUrl(tab.url))
        .map((tab) => tab.id);

      if (!matchedIds.length) return 0;

      await chrome.tabs.remove(matchedIds).catch(() => { });
      await addLog(`已关闭 ${matchedIds.length} 个匹配 ${prefix} 的 localhost 残留标签页。`, 'info');
      return matchedIds.length;
    }

    async function pingContentScriptOnTab(tabId) {
      if (!Number.isInteger(tabId)) return null;
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: 'PING',
          source: 'background',
          payload: {},
        });
      } catch {
        return null;
      }
    }

    function isManifestManagedSignupPageUrl(rawUrl) {
      const url = String(rawUrl || '');
      return /^https:\/\/(?:auth0\.openai\.com|auth\.openai\.com|accounts\.openai\.com)\//i.test(url);
    }

    function isSignupEntryPageUrl(rawUrl) {
      const url = String(rawUrl || '');
      return /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:[/?#]|$)/i.test(url);
    }

    function hasReachedTargetUrlForSource(source, candidateUrl, targetUrl) {
      if (!matchesSourceUrlFamily(source, candidateUrl, targetUrl)) {
        return false;
      }

      // For OAuth/login flows we must not treat a lingering chatgpt.com tab as
      // "ready" when the requested destination is an auth.openai.com page.
      if (source === 'signup-page' && isManifestManagedSignupPageUrl(targetUrl)) {
        return isManifestManagedSignupPageUrl(candidateUrl);
      }

      return true;
    }

    async function waitForTabUrlFamily(source, tabId, referenceUrl, options = {}) {
      const { timeoutMs = 15000, retryDelayMs = 400 } = options;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (hasReachedTargetUrlForSource(source, tab.url, referenceUrl)) {
            return tab;
          }
        } catch {
          return null;
        }
        await sleepOrStop(retryDelayMs);
      }
      return null;
    }

    async function waitForTabUrlMatch(tabId, matcher, options = {}) {
      const { timeoutMs = 15000, retryDelayMs = 400 } = options;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (matcher(tab.url || '', tab)) {
            return tab;
          }
        } catch {
          return null;
        }
        await sleepOrStop(retryDelayMs);
      }
      return null;
    }

    async function waitForTabComplete(tabId, options = {}) {
      const { timeoutMs = 15000, retryDelayMs = 300 } = options;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.status === 'complete') {
            return tab;
          }
        } catch {
          return null;
        }
        await sleepOrStop(retryDelayMs);
      }

      try {
        return await chrome.tabs.get(tabId);
      } catch {
        return null;
      }
    }

    async function ensureContentScriptReadyOnTab(source, tabId, options = {}) {
      const {
        inject = null,
        injectSource = null,
        timeoutMs = 30000,
        retryDelayMs = 700,
        logMessage = '',
      } = options;

      const start = Date.now();
      let lastError = null;
      let logged = false;
      let attempt = 0;

      console.log(
        LOG_PREFIX,
        `[ensureContentScriptReadyOnTab] start ${source} tab=${tabId}, timeout=${timeoutMs}ms, inject=${Array.isArray(inject) ? inject.join(',') : 'none'}`
      );

      while (Date.now() - start < timeoutMs) {
        attempt += 1;
        const pong = await pingContentScriptOnTab(tabId);
        if (pong?.ok && (!pong.source || pong.source === source)) {
          console.log(LOG_PREFIX, `[ensureContentScriptReadyOnTab] ready ${source} tab=${tabId} on attempt ${attempt} after ${Date.now() - start}ms`);
          await registerTab(source, tabId);
          return;
        }

        if (!inject || !inject.length) {
          throw new Error(`${getSourceLabel(source)} 内容脚本未就绪，且未提供可用的注入文件。`);
        }

        const registry = await getTabRegistry();
        if (registry[source]) {
          registry[source].ready = false;
          await setState({ tabRegistry: registry });
        }

        try {
          let shouldInjectFiles = true;
          if (source === 'signup-page') {
            try {
              const currentTab = await chrome.tabs.get(tabId);
              shouldInjectFiles = !isManifestManagedSignupPageUrl(currentTab?.url || '');
            } catch {
              shouldInjectFiles = true;
            }
          }

          if (injectSource) {
            await chrome.scripting.executeScript({
              target: { tabId },
              func: (injectedSource) => {
                window.__MULTIPAGE_SOURCE = injectedSource;
              },
              args: [injectSource],
            });
          }

          if (shouldInjectFiles) {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: inject,
            });
          }
        } catch (err) {
          lastError = err;
          console.warn(LOG_PREFIX, `[ensureContentScriptReadyOnTab] inject attempt ${attempt} failed for ${source} tab=${tabId}: ${err?.message || err}`);
        }

        const pongAfterInject = await pingContentScriptOnTab(tabId);
        if (pongAfterInject?.ok && (!pongAfterInject.source || pongAfterInject.source === source)) {
          console.log(LOG_PREFIX, `[ensureContentScriptReadyOnTab] ready after inject ${source} tab=${tabId} on attempt ${attempt} after ${Date.now() - start}ms`);
          await registerTab(source, tabId);
          return;
        }

        if (logMessage && !logged) {
          console.warn(LOG_PREFIX, `[ensureContentScriptReadyOnTab] ${source} tab=${tabId} still not ready after ${Date.now() - start}ms`);
          await addLog(logMessage, 'warn');
          logged = true;
        }

        await sleepOrStop(retryDelayMs);
      }

      throw lastError || new Error(`${getSourceLabel(source)} 内容脚本长时间未就绪。`);
    }

    async function setTabWindowName(tabId, windowNameValue) {
      if (!Number.isInteger(tabId) || typeof windowNameValue !== 'string') {
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        func: (nextWindowName) => {
          try {
            window.name = String(nextWindowName || '');
          } catch (_) {
            // Ignore blocked pages.
          }
        },
        args: [windowNameValue],
      });
    }

    function buildWindowNameBootstrapUrl(targetUrl, windowNameValue) {
      if (!windowNameValue) return targetUrl;
      const html = [
        '<!doctype html>',
        '<meta charset="utf-8">',
        '<title>Redirecting...</title>',
        '<script>',
        `try { window.name = ${JSON.stringify(windowNameValue)}; } catch (_) {}`,
        `location.replace(${JSON.stringify(targetUrl)});`,
        '</script>',
      ].join('');
      return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    }

    async function waitForTabTargetUrl(source, tabId, targetUrl, timeoutMs = 30000) {
      const matchedTab = await waitForTabUrlFamily(source, tabId, targetUrl, {
        timeoutMs,
        retryDelayMs: 300,
      });
      if (matchedTab) {
        return matchedTab;
      }

      let currentUrl = 'unknown';
      try {
        currentUrl = (await chrome.tabs.get(tabId))?.url || 'unknown';
      } catch (_) {
        currentUrl = 'unknown';
      }
      throw new Error(`标签页未能跳转到目标页面。期望: ${targetUrl}；当前: ${currentUrl}`);
    }

    function getContentScriptResponseTimeoutMs(message) {
      if (!message || typeof message !== 'object') return 30000;
      if (message.type === 'EXECUTE_STEP' && Number(message.step) === 6) return 75000;
      if (message.type === 'POLL_EMAIL') {
        const maxAttempts = Math.max(1, Number(message.payload?.maxAttempts) || 1);
        const intervalMs = Math.max(0, Number(message.payload?.intervalMs) || 0);
        return Math.max(45000, maxAttempts * intervalMs + 25000);
      }
      if (message.type === 'FILL_CODE') return Number(message.step) === 7 ? 45000 : 30000;
      if (message.type === 'PREPARE_SIGNUP_VERIFICATION') return 45000;
      return 30000;
    }

    function getMessageDebugLabel(source, message, tabId = null) {
      const parts = [source || 'unknown', message?.type || 'UNKNOWN'];
      if (Number.isInteger(message?.step)) parts.push(`step=${message.step}`);
      if (Number.isInteger(tabId)) parts.push(`tab=${tabId}`);
      return parts.join(' ');
    }

    function summarizeMessageResultForDebug(result) {
      if (result === undefined) return 'undefined';
      if (result === null) return 'null';
      if (typeof result !== 'object') return JSON.stringify(result);
      const summary = {};
      for (const key of ['ok', 'error', 'stopped', 'source', 'step']) {
        if (key in result) summary[key] = result[key];
      }
      if (result.payload && typeof result.payload === 'object') {
        summary.payloadKeys = Object.keys(result.payload);
      }
      return JSON.stringify(summary);
    }

    function sendTabMessageWithTimeout(tabId, source, message, responseTimeoutMs = getContentScriptResponseTimeoutMs(message)) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const startedAt = Date.now();
        const debugLabel = getMessageDebugLabel(source, message, tabId);

        console.log(LOG_PREFIX, `[sendTabMessageWithTimeout] dispatch ${debugLabel}, timeout=${responseTimeoutMs}ms`);

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const seconds = Math.ceil(responseTimeoutMs / 1000);
          console.warn(LOG_PREFIX, `[sendTabMessageWithTimeout] timeout ${debugLabel} after ${Date.now() - startedAt}ms`);
          reject(new Error(`Content script on ${source} did not respond in ${seconds}s. Try refreshing the tab and retry.`));
        }, responseTimeoutMs);

        chrome.tabs.sendMessage(tabId, message)
          .then((value) => {
            const elapsed = Date.now() - startedAt;
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            console.log(LOG_PREFIX, `[sendTabMessageWithTimeout] response ${debugLabel} after ${elapsed}ms: ${summarizeMessageResultForDebug(value)}`);
            resolve(value);
          })
          .catch((error) => {
            const elapsed = Date.now() - startedAt;
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            console.warn(LOG_PREFIX, `[sendTabMessageWithTimeout] rejection ${debugLabel} after ${elapsed}ms: ${error?.message || error}`);
            reject(error);
          });
      });
    }

    function queueCommand(source, message, timeout = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingCommands.delete(source);
          reject(new Error(`Content script on ${source} did not respond in ${timeout / 1000}s. Try refreshing the tab and retry.`));
        }, timeout);
        pendingCommands.set(source, { message, resolve, reject, timer });
        console.log(LOG_PREFIX, `Command queued for ${source} (waiting for ready)`);
      });
    }

    function flushCommand(source, tabId) {
      const pending = pendingCommands.get(source);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(source);
        sendTabMessageWithTimeout(tabId, source, pending.message).then(pending.resolve).catch(pending.reject);
        console.log(LOG_PREFIX, `Flushed queued command to ${source} (tab ${tabId})`);
      }
    }

    function cancelPendingCommands(reason = STOP_ERROR_MESSAGE) {
      for (const [source, pending] of pendingCommands.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
        pendingCommands.delete(source);
        console.log(LOG_PREFIX, `Cancelled queued command for ${source}`);
      }
    }

    async function reuseOrCreateTab(source, url, options = {}) {
      const windowNameValue = typeof options.windowNameValue === 'string'
        ? options.windowNameValue
        : '';
      const alive = await isTabAlive(source);
      if (alive) {
        const tabId = await getTabId(source);
        await closeConflictingTabsForSource(source, url, { excludeTabIds: [tabId] });
        const currentTab = await chrome.tabs.get(tabId);
        const sameUrl = currentTab.url === url;
        const shouldReloadOnReuse = sameUrl && options.reloadIfSameUrl;

        const registry = await getTabRegistry();
        const shouldPreferFreshTab = source === 'signup-page'
          && windowNameValue
          && isManifestManagedSignupPageUrl(url)
          && isSignupEntryPageUrl(currentTab?.url || '');
        if (shouldPreferFreshTab) {
          await chrome.tabs.remove(tabId).catch(() => { });
          if (registry[source]?.tabId === tabId) {
            registry[source] = null;
            await setState({ tabRegistry: registry });
          }
          await addLog('认证页当前停留在 ChatGPT 入口页，步骤 7 将改为新建 OAuth 标签页，避免旧页复用干扰。', 'info');
        }

        if (shouldPreferFreshTab) {
          // Fall through to the fresh-tab creation path below.
        } else if (sameUrl) {
          await chrome.tabs.update(tabId, { active: true });
          if (windowNameValue) {
            await setTabWindowName(tabId, windowNameValue);
          }
          if (shouldReloadOnReuse) {
            if (registry[source]) registry[source].ready = false;
            await setState({ tabRegistry: registry });
            await chrome.tabs.reload(tabId);
            await waitForTabUpdateComplete(tabId);
          }

          if (options.inject) {
            if (registry[source]) registry[source].ready = false;
            await setState({ tabRegistry: registry });
            if (options.injectSource) {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: (injectedSource) => {
                  window.__MULTIPAGE_SOURCE = injectedSource;
                },
                args: [options.injectSource],
              });
            }
            await chrome.scripting.executeScript({
              target: { tabId },
              files: options.inject,
            });
            await sleepOrStop(500);
          }

          await rememberSourceLastUrl(source, url);
          return tabId;
        } else {
          if (registry[source]) registry[source].ready = false;
          await setState({ tabRegistry: registry });
          const navigationUrl = buildWindowNameBootstrapUrl(url, windowNameValue);
          if (!windowNameValue) {
            await chrome.tabs.update(tabId, { url: navigationUrl, active: true });
            await waitForTabUpdateComplete(tabId);
          } else {
            await chrome.tabs.update(tabId, { url: navigationUrl, active: true });
            await waitForTabTargetUrl(source, tabId, url);
          }

          if (options.inject) {
            if (options.injectSource) {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: (injectedSource) => {
                  window.__MULTIPAGE_SOURCE = injectedSource;
                },
                args: [options.injectSource],
              });
            }
            await chrome.scripting.executeScript({
              target: { tabId },
              files: options.inject,
            });
          }

          await sleepOrStop(500);
          await rememberSourceLastUrl(source, url);
          return tabId;
        }
      }

      await closeConflictingTabsForSource(source, url);
      const navigationUrl = buildWindowNameBootstrapUrl(url, windowNameValue);
      const tab = await chrome.tabs.create({ url: navigationUrl, active: true });

      if (windowNameValue) {
        await waitForTabTargetUrl(source, tab.id, url);
      }

      if (options.inject) {
        if (!windowNameValue) {
          await waitForTabUpdateComplete(tab.id);
        }
        if (options.injectSource) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (injectedSource) => {
              window.__MULTIPAGE_SOURCE = injectedSource;
            },
            args: [options.injectSource],
          });
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: options.inject,
        });
      }

      await rememberSourceLastUrl(source, url);
      return tab.id;
    }

    async function sendToContentScript(source, message, options = {}) {
      throwIfStopped();
      const { responseTimeoutMs = getContentScriptResponseTimeoutMs(message) } = options;
      const registry = await getTabRegistry();
      const entry = registry[source];

      if (!entry || !entry.ready) {
        throwIfStopped();
        return queueCommand(source, message);
      }

      const alive = await isTabAlive(source);
      throwIfStopped();
      if (!alive) {
        return queueCommand(source, message);
      }

      throwIfStopped();
      return sendTabMessageWithTimeout(entry.tabId, source, message, responseTimeoutMs);
    }

    async function sendToContentScriptResilient(source, message, options = {}) {
      const {
        timeoutMs = 30000,
        retryDelayMs = 600,
        logMessage = '',
        responseTimeoutMs,
      } = options;
      const start = Date.now();
      let lastError = null;
      let logged = false;
      let attempt = 0;

      while (Date.now() - start < timeoutMs) {
        throwIfStopped();
        attempt += 1;

        try {
          return await sendToContentScript(
            source,
            message,
            responseTimeoutMs !== undefined ? { responseTimeoutMs } : {}
          );
        } catch (err) {
          const retryable = isRetryableContentScriptTransportError(err);
          if (!retryable) {
            throw err;
          }

          lastError = err;
          if (logMessage && !logged) {
            await addLog(logMessage, 'warn');
            logged = true;
          }

          await sleepOrStop(retryDelayMs);
        }
      }

      throw lastError || new Error(`等待 ${getSourceLabel(source)} 重新就绪超时。`);
    }

    async function sendToMailContentScriptResilient(mail, message, options = {}) {
      const {
        timeoutMs = 45000,
        maxRecoveryAttempts = 2,
        responseTimeoutMs,
      } = options;
      const start = Date.now();
      let lastError = null;
      let recoveries = 0;
      let logged = false;

      while (Date.now() - start < timeoutMs) {
        throwIfStopped();

        try {
          return await sendToContentScript(
            mail.source,
            message,
            responseTimeoutMs !== undefined ? { responseTimeoutMs } : {}
          );
        } catch (err) {
          if (!isRetryableContentScriptTransportError(err)) {
            throw err;
          }

          lastError = err;
          if (!logged) {
            await addLog(`步骤 ${message.step}：${mail.label} 页面通信异常，正在尝试让邮箱页重新就绪...`, 'warn');
            logged = true;
          }

          if (recoveries >= maxRecoveryAttempts) {
            break;
          }

          recoveries += 1;
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
            reloadIfSameUrl: true,
          });
          await sleepOrStop(800);
        }
      }

      throw lastError || new Error(`${mail.label} 页面未能重新就绪。`);
    }

    return {
      buildLocalhostCleanupPrefix,
      cancelPendingCommands,
      closeConflictingTabsForSource,
      closeLocalhostCallbackTabs,
      closeTabsByUrlPrefix,
      ensureContentScriptReadyOnTab,
      flushCommand,
      getContentScriptResponseTimeoutMs,
      getMessageDebugLabel,
      getTabId,
      getTabRegistry,
      isLocalhostOAuthCallbackTabMatch,
      isTabAlive,
      pingContentScriptOnTab,
      queueCommand,
      registerTab,
      rememberSourceLastUrl,
      reuseOrCreateTab,
      sendTabMessageWithTimeout,
      sendToContentScript,
      sendToContentScriptResilient,
      sendToMailContentScriptResilient,
      summarizeMessageResultForDebug,
      waitForTabComplete,
      waitForTabUrlFamily,
      waitForTabUrlMatch,
    };
  }

  return {
    createTabRuntime,
  };
});
