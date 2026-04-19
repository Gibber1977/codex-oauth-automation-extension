(function attachBackgroundFingerprintRun(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.MultiPageBackgroundFingerprintRun = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundFingerprintRunModule() {
  function normalizePositiveInteger(value) {
    const normalized = Math.floor(Number(value) || 0);
    return normalized > 0 ? normalized : 0;
  }

  function buildAutoRunFingerprintMarker(state = {}) {
    if (!Boolean(state.autoRunning)) {
      return '';
    }

    const sessionId = normalizePositiveInteger(state.autoRunSessionId);
    const currentRun = normalizePositiveInteger(state.autoRunCurrentRun);
    if (!sessionId || !currentRun) {
      return '';
    }

    return `auto:${sessionId}:${currentRun}`;
  }

  function buildManualFingerprintMarker(now, randomToken = '') {
    const timestamp = Math.max(0, Math.floor(Number(now) || 0));
    const token = String(randomToken || '').trim() || 'manual';
    return `manual:${timestamp}:${token}`;
  }

  function createFingerprintRunHelpers(deps = {}) {
    const {
      getNow = () => Date.now(),
      getState,
      randomUUID = () => crypto.randomUUID(),
      setState,
    } = deps;

    function nextToken() {
      return String(randomUUID() || '')
        .trim()
        .replace(/-/g, '') || 'fingerprint';
    }

    async function prepareFingerprintProfileForStep1() {
      const state = await getState();
      const currentSeed = String(state?.currentFingerprintSeed || '').trim();
      const currentMarker = String(state?.currentFingerprintRunMarker || '').trim();
      const autoRunMarker = buildAutoRunFingerprintMarker(state);
      const nextMarker = autoRunMarker || buildManualFingerprintMarker(getNow(), nextToken());
      const needsRefresh = !currentSeed || currentMarker !== nextMarker;

      if (!needsRefresh) {
        return {
          marker: nextMarker,
          refreshed: false,
          seed: currentSeed,
        };
      }

      const nextSeed = nextToken();
      await setState({
        currentFingerprintRunMarker: nextMarker,
        currentFingerprintSeed: nextSeed,
      });

      return {
        marker: nextMarker,
        refreshed: true,
        seed: nextSeed,
      };
    }

    return {
      prepareFingerprintProfileForStep1,
    };
  }

  return {
    buildAutoRunFingerprintMarker,
    buildManualFingerprintMarker,
    createFingerprintRunHelpers,
  };
});
