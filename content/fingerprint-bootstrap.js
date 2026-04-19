(function fingerprintBootstrapModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  const api = factory();
  api.installFingerprintFromWindowName(root);
})(typeof self !== 'undefined' ? self : globalThis, function createFingerprintBootstrapModule() {
  const WINDOW_NAME_PREFIX = '__MPFP__:';
  const CHROME_VERSION_POOL = [
    '132.0.6834.160',
    '133.0.6943.142',
    '134.0.6998.89',
    '135.0.7049.95',
    '136.0.7103.49',
  ];
  const IDENTITY_PROFILES = [
    {
      locale: 'en-US',
      languages: Object.freeze(['en-US', 'en']),
      timezone: 'America/Los_Angeles',
      timezoneOffsetMinutes: 480,
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    },
    {
      locale: 'en-GB',
      languages: Object.freeze(['en-GB', 'en']),
      timezone: 'Europe/London',
      timezoneOffsetMinutes: 0,
      screen: { width: 1536, height: 864, availWidth: 1536, availHeight: 824 },
    },
    {
      locale: 'zh-CN',
      languages: Object.freeze(['zh-CN', 'zh']),
      timezone: 'Asia/Shanghai',
      timezoneOffsetMinutes: -480,
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    },
    {
      locale: 'zh-TW',
      languages: Object.freeze(['zh-TW', 'zh', 'en']),
      timezone: 'Asia/Taipei',
      timezoneOffsetMinutes: -480,
      screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 },
    },
    {
      locale: 'zh-HK',
      languages: Object.freeze(['zh-HK', 'zh', 'en']),
      timezone: 'Asia/Hong_Kong',
      timezoneOffsetMinutes: -480,
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    },
  ];
  const GPU_PROFILES = [
    {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
    {
      vendor: 'Google Inc. (NVIDIA)',
      renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
    {
      vendor: 'Google Inc. (AMD)',
      renderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
  ];

  function hashSeed(seed) {
    let value = 2166136261;
    const input = String(seed || '');
    for (let index = 0; index < input.length; index += 1) {
      value ^= input.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function createSeededRandom(seed) {
    let state = hashSeed(seed) || 0x12345678;
    return function seededRandom() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function pickOne(random, values) {
    if (!Array.isArray(values) || !values.length) {
      return undefined;
    }
    const index = Math.floor(random() * values.length) % values.length;
    return values[index];
  }

  function buildProfileFromSeed(seed) {
    const random = createSeededRandom(seed);
    const chromeVersion = pickOne(random, CHROME_VERSION_POOL);
    const platformProfile = pickOne(random, IDENTITY_PROFILES);
    const gpuProfile = pickOne(random, GPU_PROFILES);
    const hardwareConcurrency = pickOne(random, [4, 6, 8, 12, 16]);
    const deviceMemory = pickOne(random, [4, 8, 16]);
    const maxTouchPoints = pickOne(random, [0, 0, 1]);
    const audioSampleRate = pickOne(random, [44100, 48000]);
    const canvasSalt = Math.floor(random() * 4096);
    const audioSalt = Number(((random() - 0.5) / 1000).toFixed(6));
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    const majorVersion = String(chromeVersion || '').split('.')[0] || '136';

    return {
      seed: String(seed || ''),
      locale: platformProfile.locale,
      languages: Object.freeze([...(platformProfile.languages || [])]),
      language: platformProfile.languages[0],
      timezone: platformProfile.timezone,
      timezoneOffsetMinutes: platformProfile.timezoneOffsetMinutes,
      userAgent,
      appVersion: userAgent.replace(/^Mozilla\//, ''),
      platform: 'Win32',
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints,
      vendor: 'Google Inc.',
      webdriver: false,
      screen: {
        ...platformProfile.screen,
        colorDepth: 24,
        pixelDepth: 24,
      },
      webgl: gpuProfile,
      canvasSalt,
      audioSalt,
      audioSampleRate,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: majorVersion },
          { brand: 'Google Chrome', version: majorVersion },
          { brand: 'Not.A/Brand', version: '99' },
        ],
        mobile: false,
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        model: '',
        uaFullVersion: chromeVersion,
        wow64: false,
      },
    };
  }

  function extractSeedFromWindowName(windowName) {
    const value = String(windowName || '');
    if (!value.startsWith(WINDOW_NAME_PREFIX)) {
      return '';
    }
    return value.slice(WINDOW_NAME_PREFIX.length).trim();
  }

  function defineStaticGetter(target, property, value) {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        enumerable: true,
        get() {
          return value;
        },
      });
    } catch (_) {
      // Ignore sealed browser objects.
    }
  }

  function definePrototypeMethod(target, property, wrapped, original) {
    if (!target || typeof wrapped !== 'function') {
      return;
    }

    try {
      Object.defineProperty(wrapped, '__mpfpWrapped__', { value: true });
      if (typeof original === 'function') {
        Object.defineProperty(wrapped, '__mpfpOriginal__', { value: original });
      }
      Object.defineProperty(target, property, {
        configurable: true,
        writable: true,
        value: wrapped,
      });
    } catch (_) {
      // Ignore non-configurable browser prototypes.
    }
  }

  function installNavigatorOverrides(targetWindow, profile) {
    const navigatorTarget = targetWindow.navigator;
    if (!navigatorTarget) return;
    const navigatorPrototype = Object.getPrototypeOf(navigatorTarget) || navigatorTarget;
    const languages = Object.freeze([...(profile.languages || [])]);

    [
      ['webdriver', profile.webdriver],
      ['language', profile.language],
      ['languages', languages],
      ['userLanguage', profile.language],
      ['browserLanguage', profile.language],
      ['systemLanguage', profile.language],
      ['platform', profile.platform],
      ['hardwareConcurrency', profile.hardwareConcurrency],
      ['deviceMemory', profile.deviceMemory],
      ['maxTouchPoints', profile.maxTouchPoints],
      ['vendor', profile.vendor],
      ['userAgent', profile.userAgent],
      ['appVersion', profile.appVersion],
    ].forEach(([property, value]) => {
      defineStaticGetter(navigatorPrototype, property, value);
      defineStaticGetter(navigatorTarget, property, value);
    });

    const uaData = {
      ...profile.userAgentData,
      toJSON() {
        return {
          brands: this.brands,
          mobile: this.mobile,
          platform: this.platform,
        };
      },
      async getHighEntropyValues(hints = []) {
        const response = {};
        hints.forEach((hint) => {
          if (hint in this) {
            response[hint] = this[hint];
          }
        });
        response.brands = this.brands;
        response.mobile = this.mobile;
        response.platform = this.platform;
        return response;
      },
    };
    defineStaticGetter(navigatorPrototype, 'userAgentData', uaData);
    defineStaticGetter(navigatorTarget, 'userAgentData', uaData);
  }

  function installScreenOverrides(targetWindow, profile) {
    const screenTarget = targetWindow.screen;
    if (!screenTarget) return;
    const screenPrototype = Object.getPrototypeOf(screenTarget) || screenTarget;

    Object.entries(profile.screen || {}).forEach(([property, value]) => {
      defineStaticGetter(screenPrototype, property, value);
      defineStaticGetter(screenTarget, property, value);
    });
  }

  function installIntlOverrides(targetWindow, profile) {
    const intlTarget = targetWindow.Intl;
    if (!intlTarget) {
      return;
    }

    [
      'Collator',
      'DisplayNames',
      'ListFormat',
      'NumberFormat',
      'PluralRules',
      'RelativeTimeFormat',
      'Segmenter',
    ].forEach((constructorName) => {
      const originalResolvedOptions = intlTarget?.[constructorName]?.prototype?.resolvedOptions;
      if (typeof originalResolvedOptions !== 'function' || originalResolvedOptions.__mpfpWrapped__) {
        return;
      }

      const wrapped = function wrappedResolvedOptions() {
        const result = originalResolvedOptions.apply(this, arguments);
        return {
          ...result,
          locale: profile.locale,
        };
      };
      definePrototypeMethod(intlTarget[constructorName].prototype, 'resolvedOptions', wrapped, originalResolvedOptions);
    });

    const originalDateTimeResolvedOptions = intlTarget?.DateTimeFormat?.prototype?.resolvedOptions;
    if (typeof originalDateTimeResolvedOptions === 'function' && !originalDateTimeResolvedOptions.__mpfpWrapped__) {
      const wrapped = function wrappedResolvedOptions() {
        const result = originalDateTimeResolvedOptions.apply(this, arguments);
        return {
          ...result,
          locale: profile.locale,
          timeZone: profile.timezone,
        };
      };
      definePrototypeMethod(intlTarget.DateTimeFormat.prototype, 'resolvedOptions', wrapped, originalDateTimeResolvedOptions);
    }

    const datePrototype = targetWindow.Date?.prototype;
    if (!datePrototype) {
      return;
    }

    const originalGetTimezoneOffset = datePrototype.getTimezoneOffset;
    if (typeof originalGetTimezoneOffset === 'function' && !originalGetTimezoneOffset.__mpfpWrapped__) {
      const offsetWrapped = function wrappedGetTimezoneOffset() {
        return profile.timezoneOffsetMinutes;
      };
      definePrototypeMethod(datePrototype, 'getTimezoneOffset', offsetWrapped, originalGetTimezoneOffset);
    }

    ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach((methodName) => {
      const originalMethod = datePrototype[methodName];
      if (typeof originalMethod !== 'function' || originalMethod.__mpfpWrapped__) {
        return;
      }

      const wrappedMethod = function wrappedDateLocaleMethod(locales, options) {
        const nextLocales = locales === undefined ? profile.locale : locales;
        if (options !== undefined && (options === null || typeof options !== 'object')) {
          return originalMethod.apply(this, arguments);
        }

        const nextOptions = options && typeof options === 'object'
          ? { ...options }
          : {};
        if (!nextOptions.timeZone) {
          nextOptions.timeZone = profile.timezone;
        }
        return originalMethod.call(this, nextLocales, nextOptions);
      };
      definePrototypeMethod(datePrototype, methodName, wrappedMethod, originalMethod);
    });
  }

  function patchWebGLContextPrototype(prototype, profile) {
    if (!prototype || prototype.__mpfpPatched__) return;

    const originalGetParameter = prototype.getParameter;
    const originalGetExtension = prototype.getExtension;
    const debugInfo = {
      UNMASKED_VENDOR_WEBGL: 37445,
      UNMASKED_RENDERER_WEBGL: 37446,
    };

    if (typeof originalGetParameter === 'function') {
      prototype.getParameter = function patchedGetParameter(parameter) {
        if (parameter === debugInfo.UNMASKED_VENDOR_WEBGL) {
          return profile.webgl.vendor;
        }
        if (parameter === debugInfo.UNMASKED_RENDERER_WEBGL) {
          return profile.webgl.renderer;
        }
        return originalGetParameter.apply(this, arguments);
      };
    }

    if (typeof originalGetExtension === 'function') {
      prototype.getExtension = function patchedGetExtension(name) {
        if (name === 'WEBGL_debug_renderer_info') {
          return debugInfo;
        }
        return originalGetExtension.apply(this, arguments);
      };
    }

    Object.defineProperty(prototype, '__mpfpPatched__', { value: true });
  }

  function installWebGLOverrides(targetWindow, profile) {
    patchWebGLContextPrototype(targetWindow.WebGLRenderingContext?.prototype, profile);
    patchWebGLContextPrototype(targetWindow.WebGL2RenderingContext?.prototype, profile);
  }

  function applyCanvasNoise(canvas, profile) {
    if (!canvas || typeof canvas.getContext !== 'function' || !canvas.width || !canvas.height) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context || typeof context.getImageData !== 'function' || typeof context.putImageData !== 'function') {
      return;
    }

    const x = profile.canvasSalt % canvas.width;
    const y = Math.floor(profile.canvasSalt / Math.max(1, canvas.width)) % canvas.height;
    try {
      const imageData = context.getImageData(x, y, 1, 1);
      imageData.data[0] = (imageData.data[0] + (profile.canvasSalt % 7)) % 255;
      imageData.data[1] = (imageData.data[1] + (profile.canvasSalt % 13)) % 255;
      imageData.data[2] = (imageData.data[2] + (profile.canvasSalt % 17)) % 255;
      context.putImageData(imageData, x, y);
    } catch (_) {
      // Ignore tainted or blocked canvases.
    }
  }

  function installCanvasOverrides(targetWindow, profile) {
    const canvasPrototype = targetWindow.HTMLCanvasElement?.prototype;
    if (!canvasPrototype || canvasPrototype.__mpfpPatched__) {
      return;
    }

    const originalToDataURL = canvasPrototype.toDataURL;
    const originalToBlob = canvasPrototype.toBlob;
    if (typeof originalToDataURL === 'function') {
      canvasPrototype.toDataURL = function patchedToDataURL() {
        applyCanvasNoise(this, profile);
        return originalToDataURL.apply(this, arguments);
      };
    }
    if (typeof originalToBlob === 'function') {
      canvasPrototype.toBlob = function patchedToBlob() {
        applyCanvasNoise(this, profile);
        return originalToBlob.apply(this, arguments);
      };
    }

    Object.defineProperty(canvasPrototype, '__mpfpPatched__', { value: true });
  }

  function installAudioOverrides(targetWindow, profile) {
    const audioBufferPrototype = targetWindow.AudioBuffer?.prototype;
    if (!audioBufferPrototype || audioBufferPrototype.__mpfpPatched__) {
      return;
    }

    const originalGetChannelData = audioBufferPrototype.getChannelData;
    if (typeof originalGetChannelData === 'function') {
      audioBufferPrototype.getChannelData = function patchedGetChannelData() {
        const channelData = originalGetChannelData.apply(this, arguments);
        if (channelData && !channelData.__mpfpPatched__ && channelData.length) {
          const index = profile.canvasSalt % Math.min(channelData.length, 64);
          channelData[index] = channelData[index] + profile.audioSalt;
          Object.defineProperty(channelData, '__mpfpPatched__', { value: true });
        }
        return channelData;
      };
    }

    const audioContextPrototype = targetWindow.AudioContext?.prototype || targetWindow.webkitAudioContext?.prototype;
    if (audioContextPrototype && !audioContextPrototype.__mpfpPatched__) {
      defineStaticGetter(audioContextPrototype, 'sampleRate', profile.audioSampleRate);
      Object.defineProperty(audioContextPrototype, '__mpfpPatched__', { value: true });
    }

    Object.defineProperty(audioBufferPrototype, '__mpfpPatched__', { value: true });
  }

  function applyFingerprintProfile(targetWindow, profile) {
    if (!targetWindow || !profile?.seed) {
      return null;
    }

    if (targetWindow.top && targetWindow !== targetWindow.top) {
      return profile;
    }

    if (targetWindow.__MULTIPAGE_FP_APPLIED_SEED__ === profile.seed) {
      return profile;
    }

    installNavigatorOverrides(targetWindow, profile);
    installScreenOverrides(targetWindow, profile);
    installIntlOverrides(targetWindow, profile);
    installWebGLOverrides(targetWindow, profile);
    installCanvasOverrides(targetWindow, profile);
    installAudioOverrides(targetWindow, profile);

    Object.defineProperty(targetWindow, '__MULTIPAGE_FP_APPLIED_SEED__', {
      value: profile.seed,
      configurable: true,
    });
    Object.defineProperty(targetWindow, '__MULTIPAGE_FINGERPRINT_PROFILE__', {
      value: profile,
      configurable: true,
    });

    return profile;
  }

  function installFingerprintFromWindowName(targetWindow) {
    const seed = extractSeedFromWindowName(targetWindow?.name || '');
    if (!seed) {
      return null;
    }

    const profile = buildProfileFromSeed(seed);
    return applyFingerprintProfile(targetWindow, profile);
  }

  return {
    WINDOW_NAME_PREFIX,
    applyFingerprintProfile,
    buildProfileFromSeed,
    extractSeedFromWindowName,
    installFingerprintFromWindowName,
  };
});
