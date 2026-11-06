// 域名自动静音（MV3 service worker 侧模块）
//
// 设计要点：
// - 谁能改静音状态，只认 chrome.tabs 的 mutedInfo：
//   reason === 'user' 是用户操作，reason === 'extension' 且 extensionId 是自己才是我们。
// - 每个标签的状态放 chrome.storage.session（SW 被挂起/重启后还在），关标签即清理。
// - 用户手动取消静音后，该标签在“本次停留在这个域名期间”不再被自动静音；
//   离开配置域名时状态（含 override）一起清掉，再回来重新自动静音。
// - 绝不反复强制静音，也绝不把用户自己静音的标签改回来。
(function () {
  'use strict';

  const STATE_KEY = 'autoMuteTabState';
  const DEFAULT_DOMAINS = ['threads.com'];

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // ---------- 域名归一化与匹配（实现见 domain_utils.js） ----------

  const { normalizeDomain, hostMatchesDomain, hostOf, matchedDomainFor } = globalThis.HJX_DOMAINS;

  // ---------- 配置 ----------

  async function readConfig() {
    const data = await chrome.storage.local.get(['autoMuteEnabled', 'autoMuteDomains']);
    const rawList = Array.isArray(data.autoMuteDomains) ? data.autoMuteDomains : DEFAULT_DOMAINS;
    const domains = [];
    for (const item of rawList) {
      const normalized = normalizeDomain(item);
      if (normalized && !domains.includes(normalized)) domains.push(normalized);
    }
    return { enabled: data.autoMuteEnabled !== false, domains };
  }

  // ---------- 每个标签的状态（session storage，SW 重启不丢） ----------

  const memoryFallback = {};

  function sessionArea() {
    try {
      return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
    } catch (e) {
      return null;
    }
  }

  async function readState() {
    const area = sessionArea();
    if (!area) return { ...memoryFallback };
    try {
      const data = await area.get(STATE_KEY);
      return (data && data[STATE_KEY]) || {};
    } catch (e) {
      return { ...memoryFallback };
    }
  }

  async function writeState(state) {
    const area = sessionArea();
    if (!area) {
      for (const key of Object.keys(memoryFallback)) delete memoryFallback[key];
      Object.assign(memoryFallback, state);
      return;
    }
    try {
      await area.set({ [STATE_KEY]: state });
    } catch (e) {
      console.warn('[auto-mute] 写入 session 状态失败:', e);
    }
  }

  // 所有状态变更串行化，避免事件交错造成的竞争
  let queue = Promise.resolve();
  function enqueue(task) {
    queue = queue.then(task).catch((err) => console.warn('[auto-mute] 任务失败:', err));
    return queue;
  }

  const pendingTimers = new Map();
  function scheduleApply(tabId, delay = 100) {
    if (typeof tabId !== 'number') return;
    const existing = pendingTimers.get(tabId);
    if (existing) clearTimeout(existing);
    pendingTimers.set(
      tabId,
      setTimeout(() => {
        pendingTimers.delete(tabId);
        enqueue(() => applyToTab(tabId));
      }, delay)
    );
  }

  // ---------- 核心：让一个标签进入正确状态 ----------

  async function applyToTab(tabId, presetConfig) {
    const config = presetConfig || (await readConfig());
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      await forgetTab(tabId); // 标签已关闭
      return;
    }

    const url = tab.url || tab.pendingUrl || '';
    const desiredDomain = config.enabled ? matchedDomainFor(url, config.domains) : '';
    const state = await readState();
    const entry = state[tabId];
    const info = tab.mutedInfo || {};
    const muted = !!info.muted;
    const ownedByUs =
      muted && info.reason === 'extension' && info.extensionId === chrome.runtime.id;

    // 不在（或不该在）自动静音的范围里
    if (!desiredDomain) {
      if (!entry) return;
      if (entry.mutedByUs && ownedByUs) {
        try {
          await chrome.tabs.update(tabId, { muted: false });
        } catch (e) {
          // 标签没了，忽略
        }
      }
      delete state[tabId];
      await writeState(state);
      return;
    }

    // 用户手动取消过静音：保持不动；但如果因竞态又被我们静音，补一次取消
    if (entry && entry.override) {
      if (ownedByUs) {
        try {
          await chrome.tabs.update(tabId, { muted: false });
        } catch (e) {
          // 忽略
        }
        entry.mutedByUs = false;
        state[tabId] = entry;
        await writeState(state);
      }
      return;
    }

    if (muted) {
      // 已经是静音状态：只修正“所有权”标记，不重复调用 API
      const next = entry || {};
      let dirty = false;
      if (ownedByUs) {
        if (!next.mutedByUs || next.domain !== desiredDomain) {
          next.mutedByUs = true;
          next.domain = desiredDomain;
          dirty = true;
        }
      } else if (next.mutedByUs) {
        // 用户或别的扩展把它静音了，所有权交出去，离开域名时不要动它
        next.mutedByUs = false;
        dirty = true;
      }
      if (dirty) {
        state[tabId] = next;
        await writeState(state);
      }
      return;
    }

    // 未静音且在范围内：静音
    try {
      await chrome.tabs.update(tabId, { muted: true });
      state[tabId] = { domain: desiredDomain, mutedByUs: true, override: false };
      await writeState(state);
    } catch (e) {
      console.warn('[auto-mute] 静音失败:', e);
    }
  }

  // ---------- 外部静音变更（用户 / 其他扩展 / 我们） ----------

  async function handleMuteChange(tabId, mutedInfo, tab) {
    if (!mutedInfo) return;

    let currentTab = tab;
    if (!currentTab || !currentTab.url) {
      try {
        currentTab = await chrome.tabs.get(tabId);
      } catch (e) {
        await forgetTab(tabId);
        return;
      }
    }

    const config = await readConfig();
    const url = currentTab.url || currentTab.pendingUrl || '';
    const onConfiguredDomain = !!matchedDomainFor(url, config.domains) && config.enabled;
    const state = await readState();
    const entry = state[tabId] || {};

    if (mutedInfo.reason === 'user') {
      if (!mutedInfo.muted) {
        // 用户手动取消静音：本次停留期间不再自动静音
        if (!onConfiguredDomain) return;
        state[tabId] = { ...entry, override: true, mutedByUs: false, domain: entry.domain || matchedDomainFor(url, config.domains) };
        await writeState(state);

        // 竞态补偿：如果刚被我们静音回去，再放一次
        try {
          const fresh = await chrome.tabs.get(tabId);
          const freshInfo = fresh.mutedInfo || {};
          if (freshInfo.muted && freshInfo.reason === 'extension' && freshInfo.extensionId === chrome.runtime.id) {
            await chrome.tabs.update(tabId, { muted: false });
          }
        } catch (e) {
          // 标签已关闭
        }
        return;
      }

      // 用户手动静音：尊重，交出所有权
      if (entry.mutedByUs) {
        entry.mutedByUs = false;
        state[tabId] = entry;
        await writeState(state);
      }
      return;
    }

    if (mutedInfo.reason === 'extension' && mutedInfo.extensionId !== chrome.runtime.id) {
      // 其他扩展静音：不是我们的账，离开域名时不要动
      if (entry.mutedByUs) {
        entry.mutedByUs = false;
        state[tabId] = entry;
        await writeState(state);
      }
    }
  }

  // ---------- 清理 / 迁移 ----------

  async function forgetTab(tabId) {
    const state = await readState();
    if (!hasOwn(state, tabId)) return;
    delete state[tabId];
    await writeState(state);
  }

  async function moveTabState(fromTabId, toTabId) {
    const state = await readState();
    if (!hasOwn(state, fromTabId)) return;
    state[toTabId] = state[fromTabId];
    delete state[fromTabId];
    await writeState(state);
  }

  // ---------- 全量扫描（浏览器启动 / SW 重启 / 配置变化） ----------

  async function sweepAllTabs() {
    const config = await readConfig();
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      return;
    }

    for (const tab of tabs) {
      if (typeof tab.id === 'number') await applyToTab(tab.id, config);
    }

    // 关掉的标签可能没触发 onRemoved（浏览器重启），顺手清理
    const state = await readState();
    const alive = new Set(tabs.map((tab) => tab.id));
    let dirty = false;
    for (const key of Object.keys(state)) {
      if (!alive.has(Number(key))) {
        delete state[key];
        dirty = true;
      }
    }
    if (dirty) await writeState(state);
  }

  // ---------- 事件注册 ----------

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.mutedInfo) enqueue(() => handleMuteChange(tabId, changeInfo.mutedInfo, tab));
      if (changeInfo.url) scheduleApply(tabId);
    });

    chrome.tabs.onCreated.addListener((tab) => {
      if (tab && typeof tab.id === 'number' && tab.pendingUrl) scheduleApply(tab.id, 0);
    });

    chrome.tabs.onRemoved.addListener((tabId) => enqueue(() => forgetTab(tabId)));
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
      enqueue(() => moveTabState(removedTabId, addedTabId))
    );

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (hasOwn(changes, 'autoMuteEnabled') || hasOwn(changes, 'autoMuteDomains')) {
          enqueue(sweepAllTabs);
        }
      });
    }

    // SW 每次启动都会跑到这里：浏览器重启、SW 被挂起后唤醒都能覆盖
    enqueue(sweepAllTabs);
  }

  globalThis.HJX_AUTO_MUTE = {
    init,
    applyToTab,
    handleMuteChange,
    forgetTab,
    moveTabState,
    sweepAllTabs,
    readConfig,
    normalizeDomain,
    hostMatchesDomain,
    matchedDomainFor,
    DEFAULT_DOMAINS
  };
})();
