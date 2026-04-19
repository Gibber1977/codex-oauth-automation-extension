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

test('getAddPhoneInput skips hidden phone metadata inputs and returns the visible tel field', () => {
  const api = new Function(`
${extractFunction('isVisibleElement')}
${extractFunction('getAddPhoneInputCandidates')}
${extractFunction('getAddPhoneInput')}

const hiddenInput = {
  getBoundingClientRect() {
    return { width: 0, height: 0 };
  },
};

const visibleInput = {
  marker: 'visible-tel',
  getBoundingClientRect() {
    return { width: 180, height: 32 };
  },
};

const document = {
  querySelectorAll() {
    return [hiddenInput, visibleInput];
  },
};

const window = {
  getComputedStyle(el) {
    if (el === hiddenInput) {
      return { display: 'none', visibility: 'hidden' };
    }
    return { display: 'block', visibility: 'visible' };
  },
};

return {
  run() {
    return getAddPhoneInput();
  },
};
  `)();

  assert.equal(api.run()?.marker, 'visible-tel');
});

test('pickBestAddPhoneCountryEntry prefers the longest matching dial code and strips it from the local number', () => {
  const api = new Function(`
${extractFunction('normalizePhoneDigits')}
${extractFunction('pickBestAddPhoneCountryEntry')}
${extractFunction('getAddPhoneLocalNumber')}

return {
  normalizePhoneDigits,
  pickBestAddPhoneCountryEntry,
  getAddPhoneLocalNumber,
};
  `)();

  const phoneDigits = api.normalizePhoneDigits('+66887505231');
  const countryEntry = api.pickBestAddPhoneCountryEntry(phoneDigits, [
    { value: 'US', label: '美国 (+1)', dialCode: '1' },
    { value: 'TH', label: '泰国 (+66)', dialCode: '66' },
    { value: 'MX', label: '墨西哥 (+52)', dialCode: '52' },
  ]);

  assert.deepStrictEqual(countryEntry, {
    value: 'TH',
    label: '泰国 (+66)',
    dialCode: '66',
  });
  assert.equal(api.getAddPhoneLocalNumber(phoneDigits, countryEntry.dialCode), '887505231');
});

test('isPhoneVerificationCodePage recognizes the sms code page route and content', () => {
  const api = new Function(`
${extractFunction('isPhoneVerificationCodePage')}

const location = {
  pathname: '/phone-verification',
  href: 'https://auth.openai.com/phone-verification',
};

function getVerificationCodeTarget() {
  return { type: 'single', element: {} };
}

function getPageTextSnapshot() {
  return '查看你的手机 输入我们刚刚向 +66 086 463 1939 发送的验证码 继续 重新发送短信';
}

return {
  run() {
    return isPhoneVerificationCodePage();
  },
};
  `)();

  assert.equal(api.run(), true);
});
