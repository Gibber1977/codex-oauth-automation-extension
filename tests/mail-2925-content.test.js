const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/mail-2925.js', 'utf8');

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

test('handlePollEmail returns to inbox before initial refresh when 2925 opens on a detail page', async () => {
  const bundle = extractFunction('handlePollEmail');

  const api = new Function(`
let detailMode = true;
const clickOrder = [];
const seenCodes = new Set();
const mailItem = { text: 'OpenAI verification code 654321' };

function findMailItems() {
  return detailMode ? [] : [mailItem];
}

function getMailItemId() {
  return 'mail-1';
}

function getCurrentMailIds(items = []) {
  return new Set(items.map(() => 'mail-1'));
}

function normalizeMinuteTimestamp(value) {
  return Number(value) || 0;
}

function parseMailItemTimestamp() {
  return Date.now();
}

function matchesMailFilters() {
  return true;
}

function getMailItemText(item) {
  return item.text;
}

function extractVerificationCode(text) {
  const match = String(text || '').match(/(\\d{6})/);
  return match ? match[1] : null;
}

function extractEmails() {
  return [];
}

function emailMatchesTarget() {
  return true;
}

function getTargetEmailMatchState() {
  return { matches: true, hasExplicitEmail: false };
}

async function sleep() {}
async function sleepRandom() {}

async function returnToInbox() {
  clickOrder.push('inbox');
  detailMode = false;
  return true;
}

async function refreshInbox() {
  clickOrder.push('refresh');
}

function persistSeenCodes() {}
function log() {}

${bundle}

return {
  handlePollEmail,
  getClickOrder() {
    return clickOrder.slice();
  },
};
`)();

  const result = await api.handlePollEmail(4, {
    senderFilters: ['openai'],
    subjectFilters: ['verification'],
    maxAttempts: 1,
    intervalMs: 1,
    filterAfterTimestamp: Date.now(),
  });

  assert.equal(result.code, '654321');
  assert.deepEqual(api.getClickOrder(), ['inbox', 'refresh']);
});

test('openMailAndGetMessageText always returns to inbox after opening a 2925 message', async () => {
  const bundle = [
    extractFunction('findInboxLink'),
    extractFunction('returnToInbox'),
    extractFunction('openMailAndGetMessageText'),
  ].join('\n');

  const api = new Function(`
const MAIL_INBOX_SELECTORS = [
  'a[href*="mailList"]',
  '[class*="inbox"]',
  '[class*="Inbox"]',
  '[title*="鏀朵欢绠?]',
];
const clickOrder = [];
const mailItem = { kind: 'mail' };
const inboxLink = { kind: 'inbox' };
let listVisible = true;
let bodyText = '';

const document = {
  body: {
    get textContent() {
      return bodyText;
    },
  },
  querySelector(selector) {
    if (selector.includes('mailList') || selector.includes('inbox') || selector.includes('Inbox')) {
      return inboxLink;
    }
    return null;
  },
};

function findMailItems() {
  return listVisible ? [mailItem] : [];
}

function simulateClick(node) {
  if (node === mailItem) {
    clickOrder.push('mail');
    listVisible = false;
    bodyText = 'Your ChatGPT code is 731091';
    return;
  }
  if (node === inboxLink) {
    clickOrder.push('inbox');
    listVisible = true;
    return;
  }
  throw new Error('unexpected node');
}

async function sleep() {}
async function sleepRandom() {}

${bundle}

return {
  mailItem,
  openMailAndGetMessageText,
  getClickOrder() {
    return clickOrder.slice();
  },
  isListVisible() {
    return listVisible;
  },
};
`)();

  const text = await api.openMailAndGetMessageText(api.mailItem);

  assert.match(text, /731091/);
  assert.deepEqual(api.getClickOrder(), ['mail', 'inbox']);
  assert.equal(api.isListVisible(), true);
});
