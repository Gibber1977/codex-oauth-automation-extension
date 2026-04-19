(function attachHeroSmsUtils(root, factory) {
  root.HeroSmsUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createHeroSmsUtils() {
  const HERO_SMS_BASE_URL = 'https://hero-sms.com/stubs/handler_api.php';
  const HERO_SMS_PHONE_RECORDS_STORAGE_KEY = 'heroSmsPhoneRecords';
  const DEFAULT_HERO_SMS_MAX_ACTIVATION_AGE_MS = 5 * 60 * 1000;

  async function heroSmsRequest(params, apiKey) {
    const url = new URL(HERO_SMS_BASE_URL);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set('api_key', String(apiKey || ''));

    const response = await fetch(url.toString());
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async function getActiveActivations(apiKey) {
    return heroSmsRequest({ action: 'getActiveActivations' }, apiKey);
  }

  async function getNumberV2(apiKey, country) {
    return heroSmsRequest({ action: 'getNumberV2', service: 'dr', country }, apiKey);
  }

  async function getStatusV2(apiKey, activationId) {
    return heroSmsRequest({ action: 'getStatusV2', id: activationId }, apiKey);
  }

  async function setHeroSmsStatus(apiKey, activationId, status) {
    return heroSmsRequest({ action: 'setStatus', id: activationId, status }, apiKey);
  }

  async function finishActivation(apiKey, activationId) {
    return heroSmsRequest({ action: 'finishActivation', id: activationId }, apiKey);
  }

  async function cancelActivation(apiKey, activationId) {
    return heroSmsRequest({ action: 'cancelActivation', id: activationId }, apiKey);
  }

  function normalizePhoneRecordKey(phoneNumber) {
    return String(phoneNumber || '').trim().replace(/^\+/, '');
  }

  function normalizeCodeValue(code) {
    return String(code || '').trim();
  }

  function parseActivationTimeMs(value) {
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? time : 0;
    }
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function getHeroSmsPhoneRecords() {
    if (!chrome?.storage?.local) {
      return {};
    }
    const data = await chrome.storage.local.get(HERO_SMS_PHONE_RECORDS_STORAGE_KEY);
    const value = data?.[HERO_SMS_PHONE_RECORDS_STORAGE_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async function setHeroSmsPhoneRecords(records) {
    if (!chrome?.storage?.local) {
      return;
    }
    await chrome.storage.local.set({
      [HERO_SMS_PHONE_RECORDS_STORAGE_KEY]: records,
    });
  }

  function getPhoneCodesFromRecords(records, phoneNumber) {
    const key = normalizePhoneRecordKey(phoneNumber);
    const value = records?.[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(normalizeCodeValue)
      .filter(Boolean)
      .slice(0, 3);
  }

  async function ensurePhoneRecord(phoneNumber) {
    const key = normalizePhoneRecordKey(phoneNumber);
    if (!key) {
      return [];
    }

    const records = await getHeroSmsPhoneRecords();
    const existing = getPhoneCodesFromRecords(records, key);
    if (!Array.isArray(records[key])) {
      records[key] = existing;
      await setHeroSmsPhoneRecords(records);
    }
    return existing;
  }

  async function appendPhoneCodeIfNew(phoneNumber, code) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    const normalizedCode = normalizeCodeValue(code);
    if (!phoneKey || !normalizedCode) {
      return {
        added: false,
        duplicate: false,
        exhausted: false,
        codes: [],
      };
    }

    const records = await getHeroSmsPhoneRecords();
    const existingCodes = getPhoneCodesFromRecords(records, phoneKey);

    if (existingCodes.includes(normalizedCode)) {
      return {
        added: false,
        duplicate: true,
        exhausted: existingCodes.length >= 3,
        codes: existingCodes,
      };
    }

    if (existingCodes.length >= 3) {
      return {
        added: false,
        duplicate: false,
        exhausted: true,
        codes: existingCodes,
      };
    }

    const nextCodes = [...existingCodes, normalizedCode].slice(0, 3);
    records[phoneKey] = nextCodes;
    await setHeroSmsPhoneRecords(records);

    return {
      added: true,
      duplicate: false,
      exhausted: nextCodes.length >= 3,
      codes: nextCodes,
    };
  }

  async function findOrCreateSmsActivation(apiKey, targetCountry, options = {}) {
    const excludedActivationIds = new Set(
      Array.isArray(options.excludeActivationIds)
        ? options.excludeActivationIds.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    );
    const excludedPhoneNumbers = new Set(
      Array.isArray(options.excludePhoneNumbers)
        ? options.excludePhoneNumbers.map(normalizePhoneRecordKey).filter(Boolean)
        : []
    );
    const result = await getActiveActivations(apiKey);
    if (!result || result.status !== 'success' || !Array.isArray(result.data)) {
      throw new Error('获取短信激活列表失败');
    }

    const records = await getHeroSmsPhoneRecords();
    const candidates = result.data
      .filter((item) => {
        const countryMatch = String(item.countryCode) === String(targetCountry);
        const serviceCode = String(item.serviceCode || item.service || '').trim().toLowerCase();
        const serviceMatch = !serviceCode || serviceCode === 'dr';
        const activationId = String(item.activationId || '').trim();
        const phoneKey = normalizePhoneRecordKey(item.phoneNumber);
        const codeCount = getPhoneCodesFromRecords(records, item.phoneNumber).length;
        return countryMatch
          && serviceMatch
          && codeCount < 3
          && !excludedActivationIds.has(activationId)
          && !excludedPhoneNumbers.has(phoneKey);
      })
      .sort((left, right) => new Date(right.activationTime) - new Date(left.activationTime));

    const chosen = candidates[0] || null;
    if (chosen) {
      await ensurePhoneRecord(chosen.phoneNumber);
      await setHeroSmsStatus(apiKey, chosen.activationId, 3).catch(() => null);
      return {
        activationId: chosen.activationId,
        phoneNumber: chosen.phoneNumber,
        activationTime: chosen.activationTime || new Date().toISOString(),
      };
    }

    const newActivation = await getNumberV2(apiKey, targetCountry);
    if (!newActivation || !newActivation.activationId || !newActivation.phoneNumber) {
      throw new Error('获取新的短信号码失败');
    }

    await ensurePhoneRecord(newActivation.phoneNumber);
    await setHeroSmsStatus(apiKey, newActivation.activationId, 3).catch(() => null);

    return {
      activationId: newActivation.activationId,
      phoneNumber: newActivation.phoneNumber,
      activationTime: newActivation.activationTime || new Date().toISOString(),
    };
  }

  async function sleepWithStopCheck(totalMs, stopCheck, chunkMs = 1000) {
    let remaining = totalMs;
    while (remaining > 0) {
      if (typeof stopCheck === 'function') {
        await stopCheck();
      }
      const waitMs = Math.min(chunkMs, remaining);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      remaining -= waitMs;
    }
  }

  async function pollSmsVerificationCode(apiKey, activationId, onLog, step, stopCheck, options = {}) {
    const pollIntervalMs = 10000;
    const maxDurationMs = 300000;
    const startTime = Date.now();
    const activationStartedAtMs = parseActivationTimeMs(options.activationTime || options.activationCreatedAt);
    const maxActivationAgeMs = Number(options.maxActivationAgeMs) > 0
      ? Number(options.maxActivationAgeMs)
      : DEFAULT_HERO_SMS_MAX_ACTIVATION_AGE_MS;

    while (Date.now() - startTime < maxDurationMs) {
      if (typeof stopCheck === 'function') {
        await stopCheck();
      }

      if (activationStartedAtMs && Date.now() - activationStartedAtMs >= maxActivationAgeMs) {
        if (typeof onLog === 'function') {
          await onLog(
            step,
            `当前 Hero-SMS 激活已超过 ${Math.round(maxActivationAgeMs / 60000)} 分钟，停止继续等待短信验证码并准备更换号码。`,
            'warn'
          );
        }
        throw new Error(`等待短信验证码超时（当前 Hero-SMS 激活已超过 ${Math.round(maxActivationAgeMs / 60000)} 分钟）`);
      }

      const result = await getActiveActivations(apiKey);
      if (result && result.status === 'success' && Array.isArray(result.data)) {
        const current = result.data.find((item) => String(item.activationId) === String(activationId));
        const phoneNumber = String(current?.phoneNumber || '').trim();
        const code = normalizeCodeValue(current?.smsCode);

        if (phoneNumber && code) {
          const appendResult = await appendPhoneCodeIfNew(phoneNumber, code);
          if (appendResult.duplicate) {
            if (typeof onLog === 'function') {
              await onLog(step, `检测到旧验证码：${code}，继续轮询新验证码...`, 'warn');
            }
          } else if (appendResult.added) {
            if (typeof onLog === 'function') {
              await onLog(step, `已获取短信验证码：${code}`, 'ok');
            }
            return code;
          } else if (appendResult.exhausted) {
            throw new Error(`手机号 ${phoneNumber} 接码已达上限，请重新获取新手机号。`);
          }
        }
      }

      if (typeof onLog === 'function') {
        await onLog(step, '等待短信验证码中...', 'info');
      }
      await sleepWithStopCheck(pollIntervalMs, stopCheck);
    }

    throw new Error('等待短信验证码超时（5分钟）');
  }

  return {
    appendPhoneCodeIfNew,
    cancelActivation,
    ensurePhoneRecord,
    findOrCreateSmsActivation,
    finishActivation,
    getActiveActivations,
    getHeroSmsPhoneRecords,
    getNumberV2,
    getStatusV2,
    normalizePhoneRecordKey,
    parseActivationTimeMs,
    pollSmsVerificationCode,
    setHeroSmsPhoneRecords,
    setHeroSmsStatus,
  };
});
