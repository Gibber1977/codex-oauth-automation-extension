const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/mail-163.js', 'utf8');

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

test('readOpenedMailBody reads verification code from 163 iframe body', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('isVisibleElement'),
    extractFunction('getOpenedMailBodyFrame'),
    extractFunction('readOpenedMailBody'),
    extractFunction('extractVerificationCode'),
  ].join('\n');

  const api = new Function(`
const MAIL163_PREFIX = '[MultiPage:mail-163]';
const console = { warn() {} };
const frame = {
  id: '1776487189107_frameBody',
  name: '1776487189107_frameBody',
  className: 'oD0',
  offsetWidth: 640,
  offsetHeight: 480,
  getClientRects() {
    return [{ width: 640, height: 480 }];
  },
  contentDocument: {
    body: {
      innerText: '输入此临时验证码以继续：244003',
      textContent: '输入此临时验证码以继续：244003',
    },
  },
};
const document = {
  querySelectorAll() {
    return [frame];
  },
};
${bundle}
return { readOpenedMailBody, extractVerificationCode };
`)();

  const bodyText = api.readOpenedMailBody();
  assert.match(bodyText, /244003/);
  assert.equal(api.extractVerificationCode(bodyText), '244003');
});

test('readOpenedMailBody returns empty string when 163 read iframe is absent', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('isVisibleElement'),
    extractFunction('getOpenedMailBodyFrame'),
    extractFunction('readOpenedMailBody'),
  ].join('\n');

  const api = new Function(`
const MAIL163_PREFIX = '[MultiPage:mail-163]';
const console = { warn() {} };
const document = {
  querySelectorAll() {
    return [];
  },
};
${bundle}
return { readOpenedMailBody };
`)();

  assert.equal(api.readOpenedMailBody(), '');
});

test('163 body fallback can recover code when subject row has no verification digits', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getMailItemMetadata'),
    extractFunction('isVisibleElement'),
    extractFunction('getOpenedMailBodyFrame'),
    extractFunction('readOpenedMailBody'),
    extractFunction('extractVerificationCode'),
  ].join('\n');

  const api = new Function(`
const MAIL163_PREFIX = '[MultiPage:mail-163]';
const console = { warn() {} };
const frame = {
  id: '1776487189107_frameBody',
  name: '1776487189107_frameBody',
  className: 'oD0',
  offsetWidth: 640,
  offsetHeight: 480,
  getClientRects() {
    return [{ width: 640, height: 480 }];
  },
  contentDocument: {
    body: {
      innerText: 'DuckDuckGo did not detect any trackers. 输入此临时验证码以继续：244003',
      textContent: 'DuckDuckGo did not detect any trackers. 输入此临时验证码以继续：244003',
    },
  },
};
const document = {
  querySelectorAll() {
    return [frame];
  },
};
const item = {
  querySelector(selector) {
    const map = {
      '.nui-user': { textContent: 'OpenAI' },
      'span.da0': { textContent: '你的临时 ChatGPT 登录代码' },
      '.e00[title], [title*="年"][title*=":"]': { getAttribute() { return '2026年4月18日 12:45 (星期六)'; }, textContent: '12:45' },
    };
    return map[selector] || null;
  },
  getAttribute(name) {
    if (name === 'aria-label') {
      return '你的临时 ChatGPT 登录代码 发件人 ： OpenAI 时间： 2026年4月18日 12:45 (星期六)';
    }
    return '';
  },
};
${bundle}
const meta = getMailItemMetadata(item);
const bodyText = readOpenedMailBody();
return {
  meta,
  bodyText,
  code: extractVerificationCode(meta.combinedText + ' ' + bodyText),
};
`)();

  assert.equal(api.meta.subject, '你的临时 ChatGPT 登录代码');
  assert.doesNotMatch(api.meta.combinedText, /\b\d{6}\b/);
  assert.match(api.bodyText, /244003/);
  assert.equal(api.code, '244003');
});

test('buildProcessedMailCodeEntryKey keeps same code reusable across different mails', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('buildProcessedMailCodeEntryKey'),
  ].join('\n');

  const api = new Function(`
const processedMailCodeEntries = new Set();
${bundle}
return { buildProcessedMailCodeEntryKey };
`)();

  const firstKey = api.buildProcessedMailCodeEntryKey({
    mailId: 'mail-A',
    mailTimestamp: Date.parse('2026-04-18T15:24:00+08:00'),
    code: '423646',
    meta: {
      sender: 'OpenAI',
      subject: '你的临时 ChatGPT 登录代码',
      timeText: '2026年4月18日 15:24',
    },
  });
  const secondKey = api.buildProcessedMailCodeEntryKey({
    mailId: 'mail-B',
    mailTimestamp: Date.parse('2026-04-18T15:25:00+08:00'),
    code: '423646',
    meta: {
      sender: 'OpenAI',
      subject: '你的临时 ChatGPT 登录代码',
      timeText: '2026年4月18日 15:25',
    },
  });

  assert.notEqual(firstKey, secondKey);
});

test('buildProcessedMailCodeEntryKey stays stable for the same mail instance', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('buildProcessedMailCodeEntryKey'),
  ].join('\n');

  const api = new Function(`
const processedMailCodeEntries = new Set();
${bundle}
return { buildProcessedMailCodeEntryKey };
`)();

  const entry = {
    mailId: 'mail-A',
    mailTimestamp: Date.parse('2026-04-18T15:24:00+08:00'),
    code: '423646',
    meta: {
      sender: 'OpenAI',
      subject: '你的临时 ChatGPT 登录代码',
      timeText: '2026年4月18日 15:24',
    },
  };

  assert.equal(
    api.buildProcessedMailCodeEntryKey(entry),
    api.buildProcessedMailCodeEntryKey(entry)
  );
});
