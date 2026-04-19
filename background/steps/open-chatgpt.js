(function attachBackgroundStep1(root, factory) {
  root.MultiPageBackgroundStep1 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep1Module() {
  function createStep1Executor(deps = {}) {
    const {
      addLog,
      completeStepFromBackground,
      openSignupEntryTab,
      prepareFingerprintProfileForStep1,
    } = deps;

    async function executeStep1() {
      await addLog('步骤 1：正在打开 ChatGPT 官网...');
      if (typeof prepareFingerprintProfileForStep1 === 'function') {
        await prepareFingerprintProfileForStep1();
      }
      await openSignupEntryTab(1, { reloadIfSameUrl: true });
      await completeStepFromBackground(1, {});
    }

    return { executeStep1 };
  }

  return { createStep1Executor };
});
