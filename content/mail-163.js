// content/mail-163.js — Content script for 163 Mail (steps 4, 7)
// Injected on: mail.163.com
//
// DOM structure:
// Mail item: div[sign="letter"] with aria-label="你的 ChatGPT 代码为 479637 发件人 ： OpenAI ..."
// Sender: .nui-user (e.g., "OpenAI")
// Subject: span.da0 (e.g., "你的 ChatGPT 代码为 479637")
// Delete actions: hover trash icon on the row, or checkbox + toolbar delete button

const MAIL163_PREFIX = '[MultiPage:mail-163]';
const isTopFrame = window === window.top;

console.log(MAIL163_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

// Only operate in the top frame
if (!isTopFrame) {
  console.log(MAIL163_PREFIX, 'Skipping child frame');
} else {

const MAIL163_PROCESSED_RECORDS_STORAGE_KEY = 'mail163ProcessedVerificationEntries';

// Track exact mail-instance/code pairs we've already handled so the same row is not reused,
// while still allowing the same numeric code to be accepted from a newer mail.
let processedMailCodeEntries = new Set();

async function loadProcessedMailCodeEntries() {
  try {
    const data = await chrome.storage.session.get(MAIL163_PROCESSED_RECORDS_STORAGE_KEY);
    const storedEntries = data?.[MAIL163_PROCESSED_RECORDS_STORAGE_KEY];
    if (storedEntries && Array.isArray(storedEntries)) {
      processedMailCodeEntries = new Set(storedEntries.filter(Boolean));
      console.log(MAIL163_PREFIX, `Loaded ${processedMailCodeEntries.size} processed mail/code entries`);
    }
  } catch (err) {
    console.warn(MAIL163_PREFIX, 'Session storage unavailable, using in-memory processed mail/code entries:', err?.message || err);
  }
}

// Load previously processed mail/code pairs on startup
loadProcessedMailCodeEntries();

async function persistProcessedMailCodeEntries() {
  try {
    await chrome.storage.session.set({ [MAIL163_PROCESSED_RECORDS_STORAGE_KEY]: [...processedMailCodeEntries] });
  } catch (err) {
    console.warn(MAIL163_PREFIX, 'Could not persist processed mail/code entries, continuing in-memory only:', err?.message || err);
  }
}

// ============================================================
// Message Handler (top frame only)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    resetStopState();
    handlePollEmail(message.step, message.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      if (isStopError(err)) {
        log(`步骤 ${message.step}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`步骤 ${message.step}：邮箱轮询失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// ============================================================
// Find mail items
// ============================================================

function findMailItems() {
  return document.querySelectorAll('div[sign="letter"]');
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isVisibleElement(element) {
  if (!element || typeof element.getClientRects !== 'function') {
    return false;
  }
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function getMailItemMetadata(item) {
  const sender = normalizeText(item.querySelector('.nui-user')?.textContent || '');
  const subject = normalizeText(item.querySelector('span.da0')?.textContent || '');
  const ariaLabel = normalizeText(item.getAttribute('aria-label') || '');
  const timeText = normalizeText(
    item.querySelector('.e00[title], [title*="年"][title*=":"]')?.getAttribute?.('title')
    || item.querySelector('.e00[title], [title*="年"][title*=":"]')?.textContent
    || ''
  );

  return {
    sender,
    subject,
    ariaLabel,
    timeText,
    combinedText: normalizeText([sender, subject, ariaLabel, timeText].filter(Boolean).join(' ')),
  };
}

function getCurrentMailIds() {
  const ids = new Set();
  findMailItems().forEach(item => {
    const id = item.getAttribute('id') || '';
    if (id) ids.add(id);
  });
  return ids;
}

function normalizeMinuteTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const date = new Date(timestamp);
  date.setSeconds(0, 0);
  return date.getTime();
}

function parseMail163Timestamp(rawText) {
  const text = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  let match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0
    ).getTime();
  }

  match = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match) {
    const [, hour, minute] = match;
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(hour),
      Number(minute),
      0,
      0
    ).getTime();
  }

  return null;
}

function getMailTimestamp(item) {
  const candidates = [];
  const timeCell = item.querySelector('.e00[title], [title*="年"][title*=":"]');
  if (timeCell?.getAttribute('title')) candidates.push(timeCell.getAttribute('title'));
  if (timeCell?.textContent) candidates.push(timeCell.textContent);

  const titledNodes = item.querySelectorAll('[title]');
  titledNodes.forEach((node) => {
    const title = node.getAttribute('title');
    if (title) candidates.push(title);
  });

  for (const candidate of candidates) {
    const parsed = parseMail163Timestamp(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function scheduleEmailCleanup(item, step) {
  const itemId = item?.getAttribute?.('id') || item?.id || '';
  setTimeout(() => {
    const targetItem = itemId ? document.getElementById(itemId) : item;
    if (!targetItem) {
      return;
    }
    Promise.resolve(deleteEmail(targetItem, step)).catch(() => {
      // Cleanup is best effort only and must never affect the main verification flow.
    });
  }, 0);
}

function findReadBackButton() {
  return Array.from(document.querySelectorAll('button, a')).find((element) => {
    if (!isVisibleElement(element)) {
      return false;
    }
    const text = normalizeText(
      element.innerText
      || element.textContent
      || element.getAttribute?.('aria-label')
      || element.getAttribute?.('title')
      || ''
    );
    return /返回/.test(text);
  }) || null;
}

function isReadMode() {
  return /#module=read\.ReadModule/i.test(location.href)
    || /#module=read\.ReadModule/i.test(location.hash)
    || Boolean(findReadBackButton());
}

function getOpenedMailBodyFrame() {
  const selectors = [
    'iframe[id$="_frameBody"]',
    'iframe[name$="_frameBody"]',
    'iframe.oD0',
  ];

  for (const selector of selectors) {
    const frames = Array.from(document.querySelectorAll(selector));
    const visible = frames.find(isVisibleElement);
    if (visible) return visible;
    if (frames[0]) return frames[0];
  }

  return null;
}

function buildProcessedMailCodeEntryKey({ mailId = '', mailTimestamp = 0, code = '', meta = null }) {
  const normalizedCode = normalizeText(code);
  if (!normalizedCode) {
    return '';
  }

  const normalizedMailId = normalizeText(mailId);
  const normalizedTimestamp = Number.isFinite(Number(mailTimestamp)) && Number(mailTimestamp) > 0
    ? String(Number(mailTimestamp))
    : '';
  const normalizedSender = normalizeText(meta?.sender || '');
  const normalizedSubject = normalizeText(meta?.subject || '');
  const normalizedTimeText = normalizeText(meta?.timeText || '');

  const mailIdentity = [
    normalizedMailId,
    normalizedTimestamp,
    normalizedSender,
    normalizedSubject,
    normalizedTimeText,
  ].filter(Boolean).join('::');

  if (!mailIdentity) {
    return '';
  }

  return `${mailIdentity}::${normalizedCode}`;
}

function hasProcessedMailCode(entryKey) {
  return Boolean(entryKey) && processedMailCodeEntries.has(entryKey);
}

function rememberProcessedMailCode(entryKey) {
  if (!entryKey) {
    return;
  }
  processedMailCodeEntries.add(entryKey);
  persistProcessedMailCodeEntries();
}

function readOpenedMailBody() {
  const frame = getOpenedMailBodyFrame();
  if (!frame) {
    return '';
  }

  try {
    const frameDocument = frame.contentDocument || frame.contentWindow?.document;
    return normalizeText(frameDocument?.body?.innerText || frameDocument?.body?.textContent || '');
  } catch (err) {
    console.warn(MAIL163_PREFIX, 'Could not read 163 mail iframe body:', err?.message || err);
    return '';
  }
}

async function waitForMailList(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    const items = findMailItems();
    if (items.length > 0 && !isReadMode()) {
      return items;
    }
    await sleep(200);
  }
  throw new Error('163 邮箱列表未在预期时间内恢复，请确认当前仍位于收件箱。');
}

async function waitForOpenedMailBody(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    const bodyText = readOpenedMailBody();
    if (bodyText) {
      return bodyText;
    }
    await sleep(200);
  }
  throw new Error('打开 163 邮件后未读取到正文内容，请确认读信页面已加载完成。');
}

async function returnToMailList(step) {
  if (!isReadMode()) {
    await waitForMailList(5000);
    return;
  }

  const backButton = findReadBackButton();
  if (backButton) {
    simulateClick(backButton);
  } else if (window.history.length > 1) {
    window.history.back();
  } else {
    const inboxLink = document.querySelector('.nui-tree-item-text[title="收件箱"]');
    if (inboxLink) {
      simulateClick(inboxLink);
    }
  }

  try {
    await waitForMailList(10000);
    return;
  } catch (err) {
    const inboxLink = document.querySelector('.nui-tree-item-text[title="收件箱"]');
    if (inboxLink) {
      log(`步骤 ${step}：返回邮件列表超时，尝试重新点击收件箱。`, 'warn');
      simulateClick(inboxLink);
      await waitForMailList(10000);
      return;
    }
    throw err;
  }
}

async function openMailItemAndRead(item, step) {
  const meta = getMailItemMetadata(item);
  simulateClick(item);
  await sleep(500);

  let bodyText = '';
  try {
    bodyText = await waitForOpenedMailBody(10000);
  } finally {
    await returnToMailList(step);
  }

  return {
    ...meta,
    bodyText,
    combinedText: normalizeText([meta.combinedText, bodyText].filter(Boolean).join(' ')),
  };
}

// ============================================================
// Email Polling
// ============================================================

async function handlePollEmail(step, payload) {
  const { senderFilters, subjectFilters, maxAttempts, intervalMs, excludeCodes = [], filterAfterTimestamp = 0 } = payload;
  const excludedCodeSet = new Set(excludeCodes.filter(Boolean));
  const filterAfterMinute = normalizeMinuteTimestamp(Number(filterAfterTimestamp) || 0);

  log(`步骤 ${step}：开始轮询 163 邮箱（最多 ${maxAttempts} 次）`);
  if (filterAfterMinute) {
    log(`步骤 ${step}：仅尝试 ${new Date(filterAfterMinute).toLocaleString('zh-CN', { hour12: false })} 及之后时间的邮件。`);
  }

  // Click inbox in sidebar to ensure we're in inbox view
  log(`步骤 ${step}：正在等待侧边栏加载...`);
  try {
    const inboxLink = await waitForElement('.nui-tree-item-text[title="收件箱"]', 5000);
    inboxLink.click();
    log(`步骤 ${step}：已点击收件箱`);
  } catch {
    log(`步骤 ${step}：未找到收件箱入口，继续尝试后续流程...`, 'warn');
  }

  // Wait for mail list to appear
  log(`步骤 ${step}：正在等待邮件列表加载...`);
  let items = [];
  for (let i = 0; i < 20; i++) {
    items = findMailItems();
    if (items.length > 0) break;
    await sleep(500);
  }

  if (items.length === 0) {
    await refreshInbox();
    await sleep(2000);
    items = findMailItems();
  }

  if (items.length === 0) {
    throw new Error('163 邮箱列表未加载完成，请确认当前已打开收件箱。');
  }

  log(`步骤 ${step}：邮件列表已加载，共 ${items.length} 封邮件`);

  // Snapshot existing mail IDs
  const existingMailIds = getCurrentMailIds();
  log(`步骤 ${step}：已记录当前 ${existingMailIds.size} 封旧邮件快照`);

  const FALLBACK_AFTER = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`步骤 ${step}：正在轮询 163 邮箱，第 ${attempt}/${maxAttempts} 次`);

    if (attempt > 1) {
      await refreshInbox();
      await sleep(1000);
    }

    const allItems = findMailItems();
    const useFallback = attempt > FALLBACK_AFTER;

    for (const item of allItems) {
      const id = item.getAttribute('id') || '';
      const mailTimestamp = getMailTimestamp(item);
      const mailMinute = normalizeMinuteTimestamp(mailTimestamp || 0);
      const passesTimeFilter = !filterAfterMinute || (mailMinute && mailMinute >= filterAfterMinute);
      const shouldBypassOldSnapshot = Boolean(filterAfterMinute && passesTimeFilter && mailMinute > 0);

      if (!passesTimeFilter) {
        continue;
      }

      if (!useFallback && !shouldBypassOldSnapshot && existingMailIds.has(id)) continue;

      const meta = getMailItemMetadata(item);
      const sender = meta.sender.toLowerCase();
      const subject = meta.subject;
      const ariaLabel = meta.ariaLabel.toLowerCase();

      const senderMatch = senderFilters.some(f => sender.includes(f.toLowerCase()) || ariaLabel.includes(f.toLowerCase()));
      const subjectMatch = subjectFilters.some(f => subject.toLowerCase().includes(f.toLowerCase()) || ariaLabel.includes(f.toLowerCase()));

      if (senderMatch || subjectMatch) {
        const previewCode = extractVerificationCode(meta.combinedText);
        const previewEntryKey = buildProcessedMailCodeEntryKey({
          mailId: id,
          mailTimestamp,
          code: previewCode,
          meta,
        });
        if (previewCode && excludedCodeSet.has(previewCode)) {
          log(`步骤 ${step}：跳过排除的验证码：${previewCode}`, 'info');
        } else if (previewCode && !hasProcessedMailCode(previewEntryKey)) {
          rememberProcessedMailCode(previewEntryKey);
          const source = useFallback && existingMailIds.has(id) ? '回退匹配邮件' : '新邮件';
          const timeLabel = mailTimestamp ? `，时间：${new Date(mailTimestamp).toLocaleString('zh-CN', { hour12: false })}` : '';
          log(`步骤 ${step}：已找到验证码：${previewCode}（来源：${source}${timeLabel}，主题：${subject.slice(0, 40)}）`, 'ok');

          // Trigger cleanup only as a best-effort side effect.
          scheduleEmailCleanup(item, step);

          return { ok: true, code: previewCode, emailTimestamp: Date.now(), mailId: id };
        } else if (previewCode && hasProcessedMailCode(previewEntryKey)) {
          log(`步骤 ${step}：跳过已处理过的邮件验证码：${previewCode}`, 'info');
          continue;
        }

        let openedMail = null;
        try {
          openedMail = await openMailItemAndRead(item, step);
        } catch (err) {
          log(`步骤 ${step}：读取匹配邮件正文失败：${err.message}`, 'warn');
          continue;
        }
        const bodyCode = extractVerificationCode(openedMail.combinedText);
        const bodyEntryKey = buildProcessedMailCodeEntryKey({
          mailId: id,
          mailTimestamp,
          code: bodyCode,
          meta: openedMail,
        });
        if (bodyCode && excludedCodeSet.has(bodyCode)) {
          log(`步骤 ${step}：跳过排除的验证码：${bodyCode}`, 'info');
        } else if (bodyCode && !hasProcessedMailCode(bodyEntryKey)) {
          rememberProcessedMailCode(bodyEntryKey);
          const source = useFallback && existingMailIds.has(id) ? '回退匹配邮件正文' : '新邮件正文';
          const timeLabel = mailTimestamp ? `，时间：${new Date(mailTimestamp).toLocaleString('zh-CN', { hour12: false })}` : '';
          log(`步骤 ${step}：已在邮件正文中找到验证码：${bodyCode}（来源：${source}${timeLabel}，主题：${subject.slice(0, 40)}）`, 'ok');

          scheduleEmailCleanup(item, step);

          return { ok: true, code: bodyCode, emailTimestamp: Date.now(), mailId: id };
        } else if (bodyCode && hasProcessedMailCode(bodyEntryKey)) {
          log(`步骤 ${step}：跳过已处理过的邮件验证码：${bodyCode}`, 'info');
        }
      }
    }

    if (attempt === FALLBACK_AFTER + 1) {
      log(`步骤 ${step}：连续 ${FALLBACK_AFTER} 次未发现新邮件，开始回退到首封匹配邮件`, 'warn');
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `${(maxAttempts * intervalMs / 1000).toFixed(0)} 秒后仍未在 163 邮箱中找到新的匹配邮件。` +
    '请手动检查收件箱。'
  );
}

// ============================================================
// Delete Email via Hover Trash / Toolbar Fallback
// ============================================================

async function deleteEmail(item, step) {
  try {
    log(`步骤 ${step}：正在删除邮件...`);

    // Strategy 1: Click the trash icon inside the mail item
    // Each mail item has: <b class="nui-ico nui-ico-delete" title="删除邮件" sign="trash">
    // These icons appear on hover, so we trigger mouseover first
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(300);

    const trashIcon = item.querySelector('[sign="trash"], .nui-ico-delete, [title="删除邮件"]');
    if (trashIcon) {
      trashIcon.click();
      log(`步骤 ${step}：已点击删除图标`, 'ok');
      await sleep(1500);

      // Check if item disappeared (confirm deletion)
      const stillExists = document.getElementById(item.id);
      if (!stillExists || stillExists.style.display === 'none') {
        log(`步骤 ${step}：邮件已成功删除`);
      } else {
        log(`步骤 ${step}：邮件可能尚未删除，列表中仍可见`, 'warn');
      }
      return;
    }

    // Strategy 2: Select checkbox then click toolbar delete button
    log(`步骤 ${step}：未找到删除图标，尝试使用复选框加工具栏删除...`);
    const checkbox = item.querySelector('[sign="checkbox"], .nui-chk');
    if (checkbox) {
      checkbox.click();
      await sleep(300);

      // Click toolbar delete button
      const toolbarBtns = document.querySelectorAll('.nui-btn .nui-btn-text');
      for (const btn of toolbarBtns) {
        if (btn.textContent.replace(/\s/g, '').includes('删除')) {
          btn.closest('.nui-btn').click();
          log(`步骤 ${step}：已点击工具栏删除`, 'ok');
          await sleep(1500);
          return;
        }
      }
    }

    log(`步骤 ${step}：无法删除邮件（未找到删除按钮）`, 'warn');
  } catch (err) {
    log(`步骤 ${step}：删除邮件失败：${err.message}`, 'warn');
  }
}

// ============================================================
// Inbox Refresh
// ============================================================

async function refreshInbox() {
  // Try toolbar "刷 新" button
  const toolbarBtns = document.querySelectorAll('.nui-btn .nui-btn-text');
  for (const btn of toolbarBtns) {
    if (btn.textContent.replace(/\s/g, '') === '刷新') {
      btn.closest('.nui-btn').click();
      console.log(MAIL163_PREFIX, 'Clicked "刷新" button');
      await sleep(800);
      return;
    }
  }

  // Fallback: click sidebar "收 信"
  const shouXinBtns = document.querySelectorAll('.ra0');
  for (const btn of shouXinBtns) {
    if (btn.textContent.replace(/\s/g, '').includes('收信')) {
      btn.click();
      console.log(MAIL163_PREFIX, 'Clicked "收信" button');
      await sleep(800);
      return;
    }
  }

  console.log(MAIL163_PREFIX, 'Could not find refresh button');
}

// ============================================================
// Verification Code Extraction
// ============================================================

function extractVerificationCode(text) {
  const matchCn = text.match(/(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/);
  if (matchCn) return matchCn[1];

  const matchEn = text.match(/code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i);
  if (matchEn) return matchEn[1] || matchEn[2];

  const match6 = text.match(/\b(\d{6})\b/);
  if (match6) return match6[1];

  return null;
}

} // end of isTopFrame else block
