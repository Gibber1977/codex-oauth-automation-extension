const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('waitForSignupEntryState clicks email-login option before looking for email input', async () => {
  const api = new Function(`
const SIGNUP_ENTRY_TRIGGER_PATTERN = /免费注册|立即注册|注册|sign\\s*up|register|create\\s*account|create\\s+account/i;
const SIGNUP_EMAIL_LOGIN_OPTION_PATTERN = /继续使用电子邮件地址登录|continue\\s+with\\s+email|continue\\s+with\\s+email\\s+address|use\\s+email/i;
const SIGNUP_EMAIL_INPUT_SELECTOR = 'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i]';
const DIRECT_SIGNUP_ENTRY_URL = 'https://auth.openai.com/create-account';
const CHATGPT_ONBOARDING_CONFIRM_PATTERN = /好的，开始吧|开始吧|got\\s+it|let'?s\\s+go|continue/i;
const CHATGPT_GUEST_HOME_PATTERN = /有什么可以帮忙的|what\\s+can\\s+i\\s+help\\s+with|与\\s*chatgpt\\s*聊天|temporary\\s+chat|开启临时聊天|start\\s+chatting/i;
const CHATGPT_PRICING_FLOW_PATTERN = /免费试用|free\\s+trial|领取免费试用|套餐就绪中|pricing|checkout|upgrade|升级至|plus\\s+限时优惠|查看账单帮助/i;

let stage = 'email_option';
const clicks = [];
const logs = [];

const emailInput = {
  tagName: 'INPUT',
  disabled: false,
  getBoundingClientRect() {
    return { width: 220, height: 32 };
  },
  getAttribute(name) {
    if (name === 'type') return 'email';
    return '';
  },
};

const emailOptionButton = {
  tagName: 'BUTTON',
  textContent: '继续使用电子邮件地址登录',
  disabled: false,
  getBoundingClientRect() {
    return { width: 240, height: 40 };
  },
  getAttribute(name) {
    if (name === 'type') return 'button';
    return '';
  },
};

const workEmailButton = {
  tagName: 'A',
  textContent: '继续使用工作电子邮件地址登录',
  disabled: false,
  getBoundingClientRect() {
    return { width: 260, height: 40 };
  },
  getAttribute(name) {
    if (name === 'type') return '';
    return '';
  },
};

const location = {
  href: 'https://chatgpt.com/',
};

const document = {
  querySelector(selector) {
    if (selector === SIGNUP_EMAIL_INPUT_SELECTOR && stage === 'email_entry') {
      return emailInput;
    }
    return null;
  },
  querySelectorAll() {
    if (stage === 'email_option') {
      return [workEmailButton, emailOptionButton];
    }
    return [];
  },
};

function isVisibleElement() {
  return true;
}

function isActionEnabled(el) {
  return Boolean(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
}

function getActionText(el) {
  return [el?.textContent, el?.value, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
    .filter(Boolean)
    .join(' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function getSignupPasswordInput() {
  return null;
}

function isSignupPasswordPage() {
  return false;
}

function getSignupPasswordSubmitButton() {
  return null;
}

function getSignupPasswordDisplayedEmail() {
  return '';
}

function findSignupEntryTrigger() {
  return null;
}

function getPageTextSnapshot() {
  return '';
}

async function humanPause() {}
async function sleep() {}
function throwIfStopped() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}

function simulateClick(target) {
  clicks.push(target.textContent);
  if (target === emailOptionButton) {
    stage = 'email_entry';
  }
}

${extractFunction('getSignupEmailInput')}
${extractFunction('findSignupEmailLoginOptionTrigger')}
${extractFunction('findChatgptOnboardingConfirmTrigger')}
${extractFunction('isChatgptGuestHome')}
${extractFunction('isChatgptPricingOrCheckoutFlow')}
${extractFunction('shouldRedirectToDirectSignupEntry')}
${extractFunction('getSignupEmailContinueButton')}
${extractFunction('inspectSignupEntryState')}
${extractFunction('waitForSignupEntryState')}

return {
  async run() {
    return waitForSignupEntryState({ timeout: 2000, autoOpenEntry: true });
  },
  snapshot() {
    return { clicks, logs, stage };
  },
};
  `)();

  const result = await api.run();
  const snapshot = api.snapshot();

  assert.equal(result.state, 'email_entry');
  assert.equal(snapshot.stage, 'email_entry');
  assert.deepStrictEqual(snapshot.clicks, ['继续使用电子邮件地址登录']);
  assert.equal(
    snapshot.logs.some(({ message }) => /继续使用电子邮件地址登录/.test(message)),
    true
  );
  assert.equal(
    snapshot.clicks.includes('继续使用工作电子邮件地址登录'),
    false,
    'work email login entry should not be clicked'
  );
});

test('waitForSignupEntryState keeps direct email-entry path without clicking the email-login option', async () => {
  const api = new Function(`
const SIGNUP_ENTRY_TRIGGER_PATTERN = /免费注册|立即注册|注册|sign\\s*up|register|create\\s*account|create\\s+account/i;
const SIGNUP_EMAIL_LOGIN_OPTION_PATTERN = /继续使用电子邮件地址登录|continue\\s+with\\s+email|continue\\s+with\\s+email\\s+address|use\\s+email/i;
const SIGNUP_EMAIL_INPUT_SELECTOR = 'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i]';
const DIRECT_SIGNUP_ENTRY_URL = 'https://auth.openai.com/create-account';
const CHATGPT_ONBOARDING_CONFIRM_PATTERN = /好的，开始吧|开始吧|got\\s+it|let'?s\\s+go|continue/i;
const CHATGPT_GUEST_HOME_PATTERN = /有什么可以帮忙的|what\\s+can\\s+i\\s+help\\s+with|与\\s*chatgpt\\s*聊天|temporary\\s+chat|开启临时聊天|start\\s+chatting/i;
const CHATGPT_PRICING_FLOW_PATTERN = /免费试用|free\\s+trial|领取免费试用|套餐就绪中|pricing|checkout|upgrade|升级至|plus\\s+限时优惠|查看账单帮助/i;

const clicks = [];

const emailInput = {
  tagName: 'INPUT',
  disabled: false,
  getBoundingClientRect() {
    return { width: 220, height: 32 };
  },
  getAttribute(name) {
    if (name === 'type') return 'email';
    return '';
  },
};

const location = {
  href: 'https://chatgpt.com/',
};

const document = {
  querySelector(selector) {
    if (selector === SIGNUP_EMAIL_INPUT_SELECTOR) {
      return emailInput;
    }
    return null;
  },
  querySelectorAll() {
    return [{
      tagName: 'BUTTON',
      textContent: '继续使用电子邮件地址登录',
      disabled: false,
      getBoundingClientRect() {
        return { width: 240, height: 40 };
      },
      getAttribute(name) {
        if (name === 'type') return 'button';
        return '';
      },
    }];
  },
};

function isVisibleElement() {
  return true;
}

function isActionEnabled(el) {
  return Boolean(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
}

function getActionText(el) {
  return [el?.textContent, el?.value, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
    .filter(Boolean)
    .join(' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function getSignupPasswordInput() {
  return null;
}

function isSignupPasswordPage() {
  return false;
}

function getSignupPasswordSubmitButton() {
  return null;
}

function getSignupPasswordDisplayedEmail() {
  return '';
}

function findSignupEntryTrigger() {
  return null;
}

function getPageTextSnapshot() {
  return '';
}

async function humanPause() {}
async function sleep() {}
function throwIfStopped() {}
function log() {}

function simulateClick(target) {
  clicks.push(target.textContent);
}

${extractFunction('getSignupEmailInput')}
${extractFunction('findSignupEmailLoginOptionTrigger')}
${extractFunction('findChatgptOnboardingConfirmTrigger')}
${extractFunction('isChatgptGuestHome')}
${extractFunction('isChatgptPricingOrCheckoutFlow')}
${extractFunction('shouldRedirectToDirectSignupEntry')}
${extractFunction('getSignupEmailContinueButton')}
${extractFunction('inspectSignupEntryState')}
${extractFunction('waitForSignupEntryState')}

return {
  async run() {
    return waitForSignupEntryState({ timeout: 1000, autoOpenEntry: true });
  },
  snapshot() {
    return { clicks };
  },
};
  `)();

  const result = await api.run();
  const snapshot = api.snapshot();

  assert.equal(result.state, 'email_entry');
  assert.deepStrictEqual(snapshot.clicks, []);
});

test('waitForSignupEntryState dismisses guest onboarding and redirects to direct auth signup entry', async () => {
  const api = new Function(`
const SIGNUP_ENTRY_TRIGGER_PATTERN = /免费注册|立即注册|注册|sign\\s*up|register|create\\s*account|create\\s+account/i;
const SIGNUP_EMAIL_LOGIN_OPTION_PATTERN = /继续使用电子邮件地址登录|continue\\s+with\\s+email|continue\\s+with\\s+email\\s+address|use\\s+email/i;
const SIGNUP_EMAIL_INPUT_SELECTOR = 'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i]';
const DIRECT_SIGNUP_ENTRY_URL = 'https://auth.openai.com/create-account';
const CHATGPT_ONBOARDING_CONFIRM_PATTERN = /好的，开始吧|开始吧|got\\s+it|let'?s\\s+go|continue/i;
const CHATGPT_GUEST_HOME_PATTERN = /有什么可以帮忙的|what\\s+can\\s+i\\s+help\\s+with|与\\s*chatgpt\\s*聊天|temporary\\s+chat|开启临时聊天|start\\s+chatting/i;
const CHATGPT_PRICING_FLOW_PATTERN = /免费试用|free\\s+trial|领取免费试用|套餐就绪中|pricing|checkout|upgrade|升级至|plus\\s+限时优惠|查看账单帮助/i;

let stage = 'intro_dialog';
const clicks = [];
const logs = [];

const emailInput = {
  tagName: 'INPUT',
  disabled: false,
  getBoundingClientRect() {
    return { width: 220, height: 32 };
  },
  getAttribute(name) {
    if (name === 'type') return 'email';
    return '';
  },
};

const introButton = {
  tagName: 'BUTTON',
  textContent: '好的，开始吧',
  disabled: false,
  getBoundingClientRect() {
    return { width: 180, height: 40 };
  },
  getAttribute() {
    return '';
  },
};

const location = {
  _href: 'https://chatgpt.com/',
  get href() {
    return this._href;
  },
  set href(value) {
    this._href = value;
    if (/auth\\.openai\\.com\\/create-account/i.test(value)) {
      stage = 'email_entry';
    }
  },
  get hostname() {
    return new URL(this._href).hostname;
  },
  get pathname() {
    return new URL(this._href).pathname;
  },
  get hash() {
    return new URL(this._href).hash;
  },
};

const document = {
  querySelector(selector) {
    if (selector === SIGNUP_EMAIL_INPUT_SELECTOR && stage === 'email_entry') {
      return emailInput;
    }
    return null;
  },
  querySelectorAll() {
    if (stage === 'intro_dialog') {
      return [introButton];
    }
    return [];
  },
};

function isVisibleElement() {
  return true;
}

function isActionEnabled(el) {
  return Boolean(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
}

function getActionText(el) {
  return [el?.textContent, el?.value, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
    .filter(Boolean)
    .join(' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function getSignupPasswordInput() {
  return null;
}

function isSignupPasswordPage() {
  return false;
}

function getSignupPasswordSubmitButton() {
  return null;
}

function getSignupPasswordDisplayedEmail() {
  return '';
}

function findSignupEntryTrigger() {
  return null;
}

function getPageTextSnapshot() {
  if (stage === 'intro_dialog') {
    return '尽管问 请勿共享敏感信息 好的，开始吧';
  }
  if (stage === 'guest_home') {
    return '有什么可以帮忙的？ 与 ChatGPT 聊天 免费试用 开启临时聊天 创作一张图片';
  }
  return '创建帐户 电子邮件地址 继续';
}

async function humanPause() {}
async function sleep() {}
function throwIfStopped() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}

function simulateClick(target) {
  clicks.push(target.textContent);
  if (target === introButton) {
    stage = 'guest_home';
  }
}

${extractFunction('getSignupEmailInput')}
${extractFunction('findSignupEmailLoginOptionTrigger')}
${extractFunction('findChatgptOnboardingConfirmTrigger')}
${extractFunction('isChatgptGuestHome')}
${extractFunction('isChatgptPricingOrCheckoutFlow')}
${extractFunction('shouldRedirectToDirectSignupEntry')}
${extractFunction('getSignupEmailContinueButton')}
${extractFunction('inspectSignupEntryState')}
${extractFunction('waitForSignupEntryState')}

return {
  async run() {
    return waitForSignupEntryState({ timeout: 3000, autoOpenEntry: true });
  },
  snapshot() {
    return { clicks, logs, stage, href: location.href };
  },
};
  `)();

  const result = await api.run();
  const snapshot = api.snapshot();

  assert.equal(result.state, 'email_entry');
  assert.equal(snapshot.stage, 'email_entry');
  assert.equal(snapshot.href, 'https://auth.openai.com/create-account');
  assert.deepStrictEqual(snapshot.clicks, ['好的，开始吧']);
  assert.equal(
    snapshot.logs.some(({ message }) => /关闭拦截弹层/.test(message)),
    true
  );
  assert.equal(
    snapshot.logs.some(({ message }) => /直接注册页/.test(message)),
    true
  );
});
