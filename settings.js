// 设置页（整页，点击工具栏图标打开）：所有开关直接写 chrome.storage.local，
// 内容脚本靠 storage.onChanged 即时响应，不需要再发 tab 消息。
const storage = chrome.storage.local;

const UNBLOCK_MS = 15 * 60 * 1000;

const els = {
  accessBlock: document.getElementById('access-block'),
  contentFilter: document.getElementById('content-filter'),
  aiShortcuts: document.getElementById('ai-shortcuts'),
  autoMute: document.getElementById('auto-mute'),
  dedupeEnabled: document.getElementById('dedupe-enabled'),
  keywordInput: document.getElementById('keyword-input'),
  addKeyword: document.getElementById('add-keyword'),
  keywordList: document.getElementById('keyword-list'),
  domainInput: document.getElementById('domain-input'),
  addDomain: document.getElementById('add-domain'),
  domainList: document.getElementById('domain-list'),
  domainError: document.getElementById('domain-error'),
  dedupeInput: document.getElementById('dedupe-input'),
  addDedupe: document.getElementById('add-dedupe'),
  dedupeList: document.getElementById('dedupe-list'),
  dedupeError: document.getElementById('dedupe-error'),
  dedupeNow: document.getElementById('dedupe-now'),
  dedupeStatus: document.getElementById('dedupe-status'),
  unblock15: document.getElementById('unblock-15'),
  unblockCancel: document.getElementById('unblock-cancel'),
  unblockStatus: document.getElementById('unblock-status'),
  version: document.getElementById('version')
};

let keywords = [];
let domains = [];
let dedupeDomains = [];

function readState() {
  return storage.get({
    extensionEnabled: true,
    contentFilterEnabled: true,
    aiShortcutsEnabled: true,
    autoMuteEnabled: true,
    autoMuteDomains: ['threads.com'],
    dedupeEnabled: true,
    dedupeDomains: ['threads.com', 'zhihu.com'],
    dedupeLastResult: null,
    aiDisabledSites: [],
    blockedKeywords: [],
    unblockUntil: 0
  });
}

function renderUnblock(unblockUntil) {
  const left = unblockUntil - Date.now();
  const active = left > 0;
  els.unblock15.hidden = active;
  els.unblockCancel.hidden = !active;
  els.unblockStatus.textContent = active ? '已解锁，剩 ' + Math.ceil(left / 60000) + ' 分钟' : '';
}

function renderKeywords() {
  els.keywordList.textContent = '';
  if (keywords.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '暂无关键词';
    els.keywordList.appendChild(empty);
    return;
  }

  for (const kw of keywords) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = kw;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '删除';
    remove.dataset.keyword = kw;

    li.append(span, remove);
    els.keywordList.appendChild(li);
  }
}

function renderDomains() {
  els.domainList.textContent = '';
  if (domains.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '未配置域名（自动静音不会生效）';
    els.domainList.appendChild(empty);
    return;
  }

  for (const domain of domains) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '删除';
    remove.dataset.domain = domain;

    li.append(span, remove);
    els.domainList.appendChild(li);
  }
}

function renderDedupeDomains() {
  els.dedupeList.textContent = '';
  if (dedupeDomains.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '未配置域名（点图标不会清理）';
    els.dedupeList.appendChild(empty);
    return;
  }

  for (const domain of dedupeDomains) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '删除';
    remove.dataset.dedupeDomain = domain;

    li.append(span, remove);
    els.dedupeList.appendChild(li);
  }
}

function renderDedupeStatus(result) {
  if (!result || !result.at) {
    els.dedupeStatus.textContent = '';
    return;
  }
  els.dedupeStatus.textContent =
    '上次清理：关闭 ' + (result.closed || 0) + ' 个（' + new Date(result.at).toLocaleString() + '）';
}

function render(state) {
  els.accessBlock.checked = state.extensionEnabled !== false;
  els.contentFilter.checked = state.contentFilterEnabled !== false;
  els.aiShortcuts.checked = state.aiShortcutsEnabled !== false;
  els.autoMute.checked = state.autoMuteEnabled !== false;

  const disabledSites = Array.isArray(state.aiDisabledSites) ? state.aiDisabledSites : [];
  document.querySelectorAll('[data-site]').forEach((input) => {
    input.checked = !disabledSites.includes(input.dataset.site);
  });

  keywords = Array.isArray(state.blockedKeywords) ? state.blockedKeywords.slice() : [];
  renderKeywords();

  const fallbackDomains = globalThis.HJX_AUTO_MUTE?.DEFAULT_DOMAINS || ['threads.com'];
  domains = (Array.isArray(state.autoMuteDomains) ? state.autoMuteDomains : fallbackDomains).slice();
  renderDomains();

  els.dedupeEnabled.checked = state.dedupeEnabled !== false;
  dedupeDomains = (
    Array.isArray(state.dedupeDomains) ? state.dedupeDomains : ['threads.com', 'zhihu.com']
  ).slice();
  renderDedupeDomains();
  renderDedupeStatus(state.dedupeLastResult);

  renderUnblock(Number(state.unblockUntil) || 0);
}

async function saveKeywords(next) {
  keywords = next;
  renderKeywords();
  await storage.set({ blockedKeywords: next });
}

function addKeyword() {
  const value = els.keywordInput.value.trim();
  if (!value) return;
  if (!keywords.includes(value)) {
    saveKeywords([...keywords, value]);
  }
  els.keywordInput.value = '';
  els.keywordInput.focus();
}

async function saveDomains(next) {
  domains = next;
  renderDomains();
  await storage.set({ autoMuteDomains: next });
}

function addDomain() {
  const raw = els.domainInput.value.trim();
  if (!raw) return;

  const normalize = globalThis.HJX_AUTO_MUTE?.normalizeDomain;
  const normalized = normalize ? normalize(raw) : raw.toLowerCase();
  if (!normalized) {
    els.domainError.textContent = '看起来不是一个域名，例如 threads.com';
    return;
  }
  if (domains.includes(normalized)) {
    els.domainError.textContent = '这个域名已经在列表里';
    return;
  }

  els.domainError.textContent = '';
  els.domainInput.value = '';
  saveDomains([...domains, normalized]);
  els.domainInput.focus();
}

async function saveDedupeDomains(next) {
  dedupeDomains = next;
  renderDedupeDomains();
  await storage.set({ dedupeDomains: next });
}

function addDedupeDomain() {
  const raw = els.dedupeInput.value.trim();
  if (!raw) return;

  const normalize = globalThis.HJX_DOMAINS?.normalizeDomain || globalThis.HJX_AUTO_MUTE?.normalizeDomain;
  const normalized = normalize ? normalize(raw) : raw.toLowerCase();
  if (!normalized) {
    els.dedupeError.textContent = '看起来不是一个域名，例如 threads.com';
    return;
  }
  if (dedupeDomains.includes(normalized)) {
    els.dedupeError.textContent = '这个域名已经在列表里';
    return;
  }

  els.dedupeError.textContent = '';
  els.dedupeInput.value = '';
  saveDedupeDomains([...dedupeDomains, normalized]);
  els.dedupeInput.focus();
}

async function runDedupeNow() {
  els.dedupeNow.disabled = true;
  els.dedupeStatus.textContent = '清理中…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'dedupeNow' });
    const result = response && response.result ? response.result : null;
    renderDedupeStatus(result);
    if (!result) els.dedupeStatus.textContent = '清理失败：没有收到后台返回';
  } catch (e) {
    els.dedupeStatus.textContent = '清理失败：' + e.message;
  } finally {
    els.dedupeNow.disabled = false;
  }
}

function bindSiteToggles() {
  document.querySelectorAll('[data-site]').forEach((input) => {
    input.addEventListener('change', async () => {
      const { aiDisabledSites = [] } = await storage.get({ aiDisabledSites: [] });
      const set = new Set(Array.isArray(aiDisabledSites) ? aiDisabledSites : []);
      if (input.checked) set.delete(input.dataset.site);
      else set.add(input.dataset.site);
      await storage.set({ aiDisabledSites: [...set] });
    });
  });
}

function bindEvents() {
  els.accessBlock.addEventListener('change', () => storage.set({ extensionEnabled: els.accessBlock.checked }));
  els.contentFilter.addEventListener('change', () => storage.set({ contentFilterEnabled: els.contentFilter.checked }));
  els.aiShortcuts.addEventListener('change', () => storage.set({ aiShortcutsEnabled: els.aiShortcuts.checked }));
  els.autoMute.addEventListener('change', () => storage.set({ autoMuteEnabled: els.autoMute.checked }));

  els.addKeyword.addEventListener('click', addKeyword);
  els.keywordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addKeyword();
    }
  });

  els.keywordList.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-keyword]');
    if (!btn) return;
    saveKeywords(keywords.filter((kw) => kw !== btn.dataset.keyword));
  });

  els.addDomain.addEventListener('click', addDomain);
  els.domainInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDomain();
    }
  });
  els.domainInput.addEventListener('input', () => {
    els.domainError.textContent = '';
  });
  els.domainList.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-domain]');
    if (!btn) return;
    saveDomains(domains.filter((domain) => domain !== btn.dataset.domain));
  });

  els.dedupeEnabled.addEventListener('change', () =>
    storage.set({ dedupeEnabled: els.dedupeEnabled.checked })
  );
  els.addDedupe.addEventListener('click', addDedupeDomain);
  els.dedupeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDedupeDomain();
    }
  });
  els.dedupeInput.addEventListener('input', () => {
    els.dedupeError.textContent = '';
  });
  els.dedupeList.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-dedupe-domain]');
    if (!btn) return;
    saveDedupeDomains(dedupeDomains.filter((domain) => domain !== btn.dataset.dedupeDomain));
  });
  els.dedupeNow.addEventListener('click', runDedupeNow);

  els.unblock15.addEventListener('click', async () => {
    const until = Date.now() + UNBLOCK_MS;
    await storage.set({ unblockUntil: until });
    renderUnblock(until);
  });

  els.unblockCancel.addEventListener('click', async () => {
    await storage.set({ unblockUntil: 0 });
    renderUnblock(0);
  });

  bindSiteToggles();
}

document.addEventListener('DOMContentLoaded', async () => {
  els.version.textContent = 'v' + chrome.runtime.getManifest().version;
  bindEvents();
  render(await readState());

  // 别的窗口/页面改了 storage 时保持同步
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    render(await readState());
  });

  // 解锁倒计时
  setInterval(async () => {
    const { unblockUntil = 0 } = await storage.get({ unblockUntil: 0 });
    renderUnblock(Number(unblockUntil) || 0);
  }, 1000);
});
