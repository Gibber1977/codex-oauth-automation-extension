(function attachBackgroundStep8(root, factory) {
  root.MultiPageBackgroundStep8 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep8Module() {
  function createStep8Executor(deps = {}) {
    const {
      addLog,
      cancelHeroSmsActivation,
      chrome,
      CLOUDFLARE_TEMP_EMAIL_PROVIDER,
      completeStepFromBackground,
      confirmCustomVerificationStepBypass,
      ensureContentScriptReadyOnTab,
      ensureStep8VerificationPageReady,
      findOrCreateSmsActivation,
      getOAuthFlowRemainingMs,
      getOAuthFlowStepTimeoutMs,
      getMailConfig,
      getState,
      getTabId,
      HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS,
      HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX,
      HOTMAIL_PROVIDER,
      isTabAlive,
      isVerificationMailPollingError,
      LUCKMAIL_PROVIDER,
      pollSmsVerificationCode,
      resolveVerificationStep,
      rerunStep7ForStep8Recovery,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      setState,
      shouldUseCustomRegistrationEmail,
      sleepWithStop,
      SIGNUP_PAGE_INJECT_FILES,
      STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS,
      STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS,
      throwIfStopped,
    } = deps;

    async function getStep8ReadyTimeoutMs(actionLabel, expectedOauthUrl = '') {
      if (typeof getOAuthFlowStepTimeoutMs !== 'function') {
        return 15000;
      }

      return getOAuthFlowStepTimeoutMs(15000, {
        step: 8,
        actionLabel,
        oauthUrl: expectedOauthUrl,
      });
    }

    function getStep8RemainingTimeResolver(expectedOauthUrl = '') {
      if (typeof getOAuthFlowRemainingMs !== 'function') {
        return undefined;
      }

      return async (details = {}) => getOAuthFlowRemainingMs({
        step: 8,
        actionLabel: details.actionLabel || '登录验证码流程',
        oauthUrl: expectedOauthUrl,
      });
    }

    function normalizeStep8VerificationTargetEmail(value) {
      return String(value || '').trim().toLowerCase();
    }

    function getHeroSmsConfig(state = {}) {
      return {
        enabled: Boolean(state.heroSmsEnabled),
        apiKey: String(state.heroSmsApiKey || '').trim(),
        country: String(state.heroSmsCountry || '').trim(),
        maxActivationAgeMinutes: Math.min(60, Math.max(1, Math.floor(Number(state.heroSmsMaxActivationAgeMinutes) || 5))),
        maxRetryCount: Math.min(10, Math.max(1, Math.floor(Number(state.heroSmsMaxRetryCount) || HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS || 3))),
        recoveryStrategy: String(state.heroSmsRecoveryStrategy || '').trim().toLowerCase() === 'reload_current'
          ? 'reload_current'
          : 'open_add_phone',
      };
    }

    function normalizeHeroSmsPhoneNumber(phoneNumber) {
      return String(phoneNumber || '').trim();
    }

    function getHeroSmsPollTimeoutMaxAttempts() {
      return Math.max(1, Math.floor(Number(HERO_SMS_POLL_TIMEOUT_MAX_ATTEMPTS) || 3));
    }

    function getHeroSmsMaxActivationAgeMs(heroSms = {}) {
      return Math.max(1, Math.floor(Number(heroSms.maxActivationAgeMinutes) || 5)) * 60 * 1000;
    }

    function isHeroSmsPollingTimeoutError(error) {
      const message = String(error?.message || error || '');
      return /等待短信验证码超时/i.test(message);
    }

    async function ensureSignupPageContentReady(tabId, timeoutMs, logMessage) {
      if (typeof ensureContentScriptReadyOnTab !== 'function' || !Number.isInteger(tabId)) {
        return;
      }

      await ensureContentScriptReadyOnTab('signup-page', tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: 'signup-page',
        timeoutMs,
        retryDelayMs: 600,
        logMessage,
      });
    }

    async function getStep8PageState(responseTimeoutMs = 8000) {
      if (typeof sendToContentScriptResilient !== 'function') {
        return null;
      }

      const result = await sendToContentScriptResilient('signup-page', {
        type: 'STEP8_GET_STATE',
        source: 'background',
        payload: {},
      }, {
        timeoutMs: responseTimeoutMs,
        responseTimeoutMs,
        retryDelayMs: 500,
        logMessage: '步骤 8：认证页正在切换，等待页面重新就绪后继续确认短信页面状态...',
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      return result || null;
    }

    async function submitHeroSmsPhoneNumber(phoneNumber, timeoutMs) {
      const result = await sendToContentScriptResilient('signup-page', {
        type: 'STEP8_SUBMIT_PHONE_NUMBER',
        source: 'background',
        payload: { phoneNumber },
      }, {
        timeoutMs,
        responseTimeoutMs: timeoutMs,
        retryDelayMs: 500,
        logMessage: '步骤 8：手机号页正在切换，等待输入框重新就绪...',
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      return result || {};
    }

    async function submitHeroSmsCode(code, timeoutMs) {
      const result = await sendToContentScriptResilient('signup-page', {
        type: 'STEP8_SUBMIT_SMS_CODE',
        source: 'background',
        payload: { code },
      }, {
        timeoutMs,
        responseTimeoutMs: timeoutMs,
        retryDelayMs: 500,
        logMessage: '步骤 8：短信验证码页正在切换，等待输入框重新就绪...',
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      return result || {};
    }

    async function refreshHeroSmsPhonePage(authTabId) {
      const reloadTimeoutMs = await getStep8ReadyTimeoutMs('刷新手机号验证页面');
      const targetUrl = 'https://auth.openai.com/add-phone';
      const currentState = await getState();
      const heroSms = getHeroSmsConfig(currentState);

      if (heroSms.recoveryStrategy === 'reload_current') {
        await chrome.tabs.reload(authTabId);
      } else {
        await chrome.tabs.update(authTabId, { url: targetUrl });
      }

      const navigationStart = Date.now();
      while (Date.now() - navigationStart < reloadTimeoutMs) {
        throwIfStopped();
        const tab = await chrome.tabs.get(authTabId).catch(() => null);
        if (tab?.url && (tab.url === targetUrl || /\/add-phone(?:[/?#]|$)/i.test(tab.url))) {
          break;
        }
        await sleepWithStop(250);
      }

      await ensureSignupPageContentReady(
        authTabId,
        reloadTimeoutMs,
        '步骤 8：短信验证页正在刷新，等待页面恢复后继续换号...'
      );

      const stateCheckStartedAt = Date.now();
      while (Date.now() - stateCheckStartedAt < reloadTimeoutMs) {
        throwIfStopped();
        const refreshedState = await getStep8PageState(Math.min(8000, reloadTimeoutMs)).catch(() => null);
        if (refreshedState?.addPhonePage) {
          return;
        }
        await sleepWithStop(250);
      }

      throw new Error('步骤 8：刷新手机号验证页面后未能回到 add-phone 页面，无法继续更换 Hero-SMS 手机号。');
    }

    async function cancelHeroSmsActivationForRetry(apiKey, activationId, phoneNumber, options = {}) {
      const {
        attempt = 1,
        finalAttempt = false,
      } = options;
      const normalizedPhoneNumber = normalizeHeroSmsPhoneNumber(phoneNumber);

      try {
        if (typeof cancelHeroSmsActivation === 'function' && apiKey && activationId) {
          await cancelHeroSmsActivation(apiKey, activationId);
          await addLog(
            finalAttempt
              ? `步骤 8：Hero-SMS 第 ${attempt} 次等待超时后，已在平台取消手机号 ${normalizedPhoneNumber || activationId} 的激活。`
              : `步骤 8：Hero-SMS 第 ${attempt} 次等待超时后，已在平台取消手机号 ${normalizedPhoneNumber || activationId} 的激活，准备重新取号。`,
            'warn'
          );
        }
      } catch (err) {
        await addLog(`步骤 8：取消 Hero-SMS 激活失败：${err.message || err}`, 'warn');
      } finally {
        await setState({
          currentHeroSmsActivationId: null,
          currentHeroSmsPhoneNumber: null,
        });
      }
    }

    async function acquireHeroSmsActivation(heroSms, options = {}) {
      const activation = await findOrCreateSmsActivation(heroSms.apiKey, heroSms.country, options);
      const activationId = String(activation?.activationId || '').trim();
      const phoneNumber = normalizeHeroSmsPhoneNumber(activation?.phoneNumber);
      if (!activationId || !phoneNumber) {
        throw new Error('步骤 8：Hero-SMS 未返回有效的激活 ID 或手机号。');
      }

      await setState({
        currentHeroSmsActivationId: activationId,
        currentHeroSmsPhoneNumber: phoneNumber,
      });

      const heroSmsRecordPath = `${HERO_SMS_PHONE_RECORDS_LOG_PATH_PREFIX}/${phoneNumber.replace(/^\+/, '')}`;
      await addLog(`步骤 8：已获取 Hero-SMS 手机号 ${phoneNumber}。`, 'info');
      await addLog(`步骤 8：本地 JSON 记录位置 ${heroSmsRecordPath}`, 'info');

      return {
        activationId,
        phoneNumber,
        activationTime: activation?.activationTime || new Date().toISOString(),
      };
    }

    async function runHeroSmsAttempt(state, authTabId) {
      const heroSms = getHeroSmsConfig(state);
      if (!heroSms.apiKey) {
        throw new Error('短信验证已启用但未填写 SMS-APIKey。');
      }
      if (!heroSms.country) {
        throw new Error('短信验证已启用但未填写 SMS-国家。');
      }

      const phonePageTimeoutMs = await getStep8ReadyTimeoutMs('等待手机号验证页面加载完成');
      await ensureSignupPageContentReady(
        authTabId,
        phonePageTimeoutMs,
        '步骤 8：短信验证页内容脚本已失联，正在等待页面恢复...'
      );

      const pageState = await getStep8PageState(phonePageTimeoutMs);
      if (!pageState?.addPhonePage) {
        throw new Error('步骤 8：当前未进入短信验证页面，无法执行 Hero-SMS 流程。');
      }

      const excludedActivationIds = [];
      const excludedPhoneNumbers = [];
      const maxHeroSmsTimeoutAttempts = Math.max(
        1,
        Math.floor(Number(heroSms.maxRetryCount) || getHeroSmsPollTimeoutMaxAttempts())
      );
      await addLog('步骤 8：已检测到短信验证页面，正在通过 Hero-SMS 获取手机号...', 'info');

      for (let attempt = 1; attempt <= maxHeroSmsTimeoutAttempts; attempt += 1) {
        if (attempt > 1) {
          await addLog(`步骤 8：正在刷新手机号验证页并重新获取新的 Hero-SMS 手机号（${attempt}/${maxHeroSmsTimeoutAttempts}）...`, 'warn');
          await refreshHeroSmsPhonePage(authTabId);
        }

        const { activationId, phoneNumber, activationTime } = await acquireHeroSmsActivation(heroSms, {
          excludeActivationIds: excludedActivationIds,
          excludePhoneNumbers: excludedPhoneNumbers,
        });

        await submitHeroSmsPhoneNumber(
          phoneNumber,
          await getStep8ReadyTimeoutMs('提交手机号并等待短信验证码输入框出现')
        );

        try {
          const code = await pollSmsVerificationCode(
            heroSms.apiKey,
            activationId,
            async (_step, message, level = 'info') => {
              await addLog(message, level);
            },
            8,
            async () => {
              throwIfStopped();
            },
            {
              activationTime,
              maxActivationAgeMs: getHeroSmsMaxActivationAgeMs(heroSms),
            }
          );

          await setState({ lastLoginCode: code });
          await addLog(`步骤 8：已获取短信验证码：${code}，正在填入页面...`, 'info');
          await submitHeroSmsCode(
            code,
            await getStep8ReadyTimeoutMs('提交短信验证码并等待进入 OAuth 授权页')
          );
          await completeStepFromBackground(8, {});
          return;
        } catch (err) {
          if (!isHeroSmsPollingTimeoutError(err)) {
            throw err;
          }

          excludedActivationIds.push(activationId);
          excludedPhoneNumbers.push(phoneNumber);
          const finalAttempt = attempt >= maxHeroSmsTimeoutAttempts;
          await addLog(
            finalAttempt
              ? `步骤 8：Hero-SMS 第 ${attempt}/${maxHeroSmsTimeoutAttempts} 次等待短信验证码超时，准备取消当前号码并结束当前轮次。`
              : `步骤 8：Hero-SMS 第 ${attempt}/${maxHeroSmsTimeoutAttempts} 次等待短信验证码超时，准备取消当前号码并重新取号。`,
            'warn'
          );
          await cancelHeroSmsActivationForRetry(heroSms.apiKey, activationId, phoneNumber, {
            attempt,
            finalAttempt,
          });

          if (finalAttempt) {
            throw new Error(`步骤 8：Hero-SMS 连续 ${maxHeroSmsTimeoutAttempts} 次等待短信验证码超时，已取消当前号码，请稍后重试。`);
          }
        }
      }
    }

    async function maybeContinueWithHeroSmsAfterEmailCode(state) {
      if (!state?.heroSmsEnabled) {
        return { handled: false };
      }

      const authTabId = await getTabId('signup-page');
      if (!Number.isInteger(authTabId)) {
        return { handled: false };
      }

      await ensureSignupPageContentReady(
        authTabId,
        await getStep8ReadyTimeoutMs('确认邮箱验证码提交后是否进入手机号验证页'),
        '步骤 8：认证页内容脚本已失联，正在等待页面恢复...'
      );

      const pageState = await getStep8PageState(
        await getStep8ReadyTimeoutMs('确认邮箱验证码提交后的认证页状态')
      ).catch(() => null);

      if (!pageState?.addPhonePage) {
        return { handled: false };
      }

      await addLog('步骤 8：登录邮箱验证码提交后已进入手机号验证页，继续转入 Hero-SMS 流程...', 'info');
      await runHeroSmsAttempt(await getState(), authTabId);
      return { handled: true };
    }

    async function runStep8Attempt(state) {
      const mail = getMailConfig(state);
      if (mail.error) throw new Error(mail.error);

      const stepStartedAt = Date.now();
      let authTabId = await getTabId('signup-page');

      if (authTabId) {
        await chrome.tabs.update(authTabId, { active: true });
      } else {
        if (!state.oauthUrl) {
          throw new Error('缺少登录用 OAuth 链接，请先完成步骤 7。');
        }
        await reuseOrCreateTab('signup-page', state.oauthUrl);
        authTabId = await getTabId('signup-page');
      }

      throwIfStopped();
      if (state.heroSmsEnabled && Number.isInteger(authTabId)) {
        await ensureSignupPageContentReady(
          authTabId,
          await getStep8ReadyTimeoutMs('确认认证页状态'),
          '步骤 8：认证页内容脚本已失联，正在等待页面恢复...'
        );
        const pageState = await getStep8PageState(
          await getStep8ReadyTimeoutMs('确认当前是否已进入手机号验证页')
        ).catch(() => null);
        if (pageState?.addPhonePage) {
          await runHeroSmsAttempt(state, authTabId);
          return;
        }
      }

      throwIfStopped();
      const pageState = await ensureStep8VerificationPageReady({
        timeoutMs: await getStep8ReadyTimeoutMs('确认登录验证码页已就绪', state?.oauthUrl || ''),
      });
      const shouldCompareVerificationEmail = mail.provider !== '2925';
      const displayedVerificationEmail = shouldCompareVerificationEmail
        ? normalizeStep8VerificationTargetEmail(pageState?.displayedEmail)
        : '';
      const fixedTargetEmail = shouldCompareVerificationEmail
        ? (displayedVerificationEmail || normalizeStep8VerificationTargetEmail(state?.email))
        : '';

      await setState({
        step8VerificationTargetEmail: displayedVerificationEmail || '',
      });

      await addLog('步骤 8：登录验证码页面已就绪，开始获取验证码。', 'info');
      if (shouldCompareVerificationEmail && displayedVerificationEmail) {
        await addLog(`步骤 8：已固定当前验证码页显示邮箱 ${displayedVerificationEmail} 作为后续匹配目标。`, 'info');
      }

      if (shouldUseCustomRegistrationEmail(state)) {
        await confirmCustomVerificationStepBypass(8);
        return;
      }

      throwIfStopped();
      if (
        mail.provider === HOTMAIL_PROVIDER
        || mail.provider === LUCKMAIL_PROVIDER
        || mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER
      ) {
        await addLog(`步骤 8：正在通过 ${mail.label} 轮询验证码...`);
      } else {
        await addLog(`步骤 8：正在打开${mail.label}...`);

        const alive = await isTabAlive(mail.source);
        if (alive) {
          if (mail.navigateOnReuse) {
            await reuseOrCreateTab(mail.source, mail.url, {
              inject: mail.inject,
              injectSource: mail.injectSource,
            });
          } else {
            const tabId = await getTabId(mail.source);
            await chrome.tabs.update(tabId, { active: true });
          }
        } else {
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
          });
        }
      }

      await resolveVerificationStep(8, {
        ...state,
        step8VerificationTargetEmail: displayedVerificationEmail || '',
      }, mail, {
        afterSubmitSuccess: async () => maybeContinueWithHeroSmsAfterEmailCode(await getState()),
        filterAfterTimestamp: stepStartedAt,
        getRemainingTimeMs: getStep8RemainingTimeResolver(state?.oauthUrl || ''),
        requestFreshCodeFirst: false,
        targetEmail: fixedTargetEmail,
        resendIntervalMs: (mail.provider === HOTMAIL_PROVIDER || mail.provider === '2925')
          ? 0
          : STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS,
      });
    }

    function isStep8RestartStep7Error(error) {
      const message = String(error?.message || error || '');
      return /STEP8_RESTART_STEP7::/i.test(message);
    }

    async function executeStep8(state) {
      let currentState = state;
      let mailPollingAttempt = 1;
      let lastMailPollingError = null;

      while (true) {
        try {
          await runStep8Attempt(currentState);
          return;
        } catch (err) {
          if (!isVerificationMailPollingError(err) && !isStep8RestartStep7Error(err)) {
            throw err;
          }

          lastMailPollingError = err;
          if (mailPollingAttempt >= STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS) {
            break;
          }

          mailPollingAttempt += 1;
          await addLog(
            isStep8RestartStep7Error(err)
              ? `步骤 8：检测到认证页进入重试/超时报错状态，准备从步骤 7 重新开始（${mailPollingAttempt}/${STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS}）...`
              : `步骤 8：检测到邮箱轮询类失败，准备从步骤 7 重新开始（${mailPollingAttempt}/${STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS}）...`,
            'warn'
          );
          await rerunStep7ForStep8Recovery({
            logMessage: isStep8RestartStep7Error(err)
              ? '步骤 8：认证页进入重试/超时报错状态，正在回到步骤 7 重新发起登录流程...'
              : '步骤 8：正在回到步骤 7，重新发起登录验证码流程...',
          });
          currentState = await getState();
        }
      }

      if (lastMailPollingError) {
        throw new Error(
          `步骤 8：登录验证码流程在 ${STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS} 轮邮箱轮询恢复后仍未成功。最后一次原因：${lastMailPollingError.message}`
        );
      }

      throw new Error('步骤 8：登录验证码流程未成功完成。');
    }

    return { executeStep8 };
  }

  return { createStep8Executor };
});
