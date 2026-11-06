// 重复标签清理（service worker 侧）
//
// 只处理配置里的域名（含子域名）；判定重复时忽略 # 片段和常见跟踪参数
// （utm_*、xmt 等），所以同一条 Threads 帖子带不同分享参数也会被认成重复。
// 保留规则：优先保留该组里当前激活的标签，否则保留最左边那个；固定标签不动。
(function () {
  'use strict';

  const { normalizeDomain, hostMatchesDomain, hostOf } = globalThis.HJX_DOMAINS;

  const DEFAULT_DOMAINS = ['threads.com', 'zhihu.com'];
  const TRACKING_KEYS = new Set([
    'xmt',
    'share_id',
    'spm',
    'from',
    'ref',
    'ref_src',
    'source',
    's_trans',
    'share_source'
  ]);

  function isTrackingParam(key) {
    const k = String(key || '').toLowerCase();
    if (!k) return false;
    if (k.startsWith('utm_')) return true;
    return TRACKING_KEYS.has(k);
  }

  // 归一化成一个“同页”标识：origin + pathname + 去掉跟踪参数并排序后的 query
  function dedupeKey(url) {
    try {
      const parsed = new URL(url);
      const params = [...parsed.searchParams.entries()]
        .filter(([key]) => !isTrackingParam(key))
        .sort(([a], [b]) => a.localeCompare(b));
      const query = params.map(([key, value]) => key + '=' + value).join('&');
      return parsed.origin + parsed.pathname + (query ? '?' + query : '');
    } catch (e) {
      return '';
    }
  }

  async function readConfig() {
    const data = await chrome.storage.local.get(['dedupeEnabled', 'dedupeDomains']);
    const rawList = Array.isArray(data.dedupeDomains) ? data.dedupeDomains : DEFAULT_DOMAINS;
    const domains = [];
    for (const item of rawList) {
      const normalized = normalizeDomain(item);
      if (normalized && !domains.includes(normalized)) domains.push(normalized);
    }
    return { enabled: data.dedupeEnabled !== false, domains };
  }

  // 纯函数：给一组标签，返回应该关闭的 tabId
  function findDuplicateTabIds(tabs, domains) {
    const groups = new Map();

    for (const tab of tabs || []) {
      if (!tab || typeof tab.id !== 'number' || tab.pinned) continue;
      const url = tab.url || tab.pendingUrl || '';
      if (!url) continue;
      const host = hostOf(url);
      if (!host || !domains.some((domain) => hostMatchesDomain(host, domain))) continue;
      const key = dedupeKey(url);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tab);
    }

    const toClose = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const keep =
        list.find((tab) => tab.active) ||
        [...list].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
      for (const tab of list) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    }
    return toClose;
  }

  async function closeDuplicates() {
    const config = await readConfig();
    const stamp = Date.now();

    if (!config.enabled || config.domains.length === 0) {
      return { closed: 0, at: stamp, domains: config.domains, disabled: !config.enabled };
    }

    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      return { closed: 0, at: stamp, domains: config.domains };
    }

    const ids = findDuplicateTabIds(tabs, config.domains);
    let closed = 0;

    if (ids.length > 0) {
      try {
        await chrome.tabs.remove(ids);
        closed = ids.length;
      } catch (e) {
        // 批里有已经关掉的标签：逐个重试
        for (const id of ids) {
          try {
            await chrome.tabs.remove(id);
            closed += 1;
          } catch (err) {
            // 已经没了
          }
        }
      }
    }

    const result = { closed, at: stamp, domains: config.domains };
    try {
      await chrome.storage.local.set({ dedupeLastResult: result });
    } catch (e) {
      // 存储失败不影响关标签
    }
    return result;
  }

  globalThis.HJX_DEDUPE = {
    DEFAULT_DOMAINS,
    dedupeKey,
    findDuplicateTabIds,
    readConfig,
    closeDuplicates,
    isTrackingParam
  };
})();
