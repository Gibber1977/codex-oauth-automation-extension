(function activationUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.MultiPageActivationUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createActivationUtils() {
  function normalizeTagName(tagName) {
    return String(tagName || '').trim().toLowerCase();
  }

  function normalizeType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function normalizePathname(pathname) {
    return String(pathname || '').trim().toLowerCase();
  }

  function getActivationStrategy(target = {}) {
    const tagName = normalizeTagName(target.tagName);
    const type = normalizeType(target.type);
    const hasForm = Boolean(target.hasForm);
    const isSubmitButton = hasForm
      && (
        (tagName === 'button' && (!type || type === 'submit'))
        || (tagName === 'input' && type === 'submit')
      );

    // auth.openai.com/email-verification currently rejects raw POSTs without a
    // route action. Keep generic button activation on normal click and use
    // explicit requestSubmit only in the few call sites that truly require it.
    if (isSubmitButton) {
      return { method: 'click' };
    }

    return { method: 'click' };
  }

  function isRecoverableStep9AuthFailure(statusText) {
    const text = String(statusText || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return false;
    }

    if (/oauth flow is not pending/i.test(text)) {
      return true;
    }

    return /(?:认证失败|回调 URL 提交失败):\s*/i.test(text);
  }

  return {
    getActivationStrategy,
    isRecoverableStep9AuthFailure,
  };
});
