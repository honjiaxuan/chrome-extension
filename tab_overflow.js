// 标签超限自动归档（service worker 侧模块）
//
// 规则：单个窗口里的标签数达到阈值（默认 50）时，把该窗口里除“当前活动标签”以外的
// 标签全部收进 OneTab。固定标签、排除名单、扩展页由 background 的 sendTabsToOneTab
// 统一过滤（它也是右键菜单用的同一条路径）。
//
// 为什么是事件驱动而不是定时扫描：
// - 只有“标签被创建 / 被移入窗口”才可能把计数推过阈值；定时扫描会在用户不知情时
//   反复触发，而且 SW 本来就会休眠。
// - 触发一次后解除武装（armed=false），直到该窗口的标签数回落到阈值以下才重新武装。
//   这样“归档后仍有 >= 阈值个受保护标签（固定/扩展页）”也不会连环触发。
//
// 两个抑制窗口（否则会循环归档）：
// - 浏览器启动后 60 秒：会话恢复会在几秒内创建几十个标签，不抑制就会开机即清空。
// - OneTab 恢复分组后 20 秒：恢复 50 个标签会再次越过阈值，不抑制就变成
//   “恢复 → 立刻收回”，用户永远打不开。
//
// 状态放 chrome.storage.session（SW 重启不丢，浏览器退出即清），按 windowId 分键。
(function () {
  'use strict';

  const STATE_KEY = 'tabOverflowState';
  const SUPPRESS_KEY = 'tabOverflowSuppressUntil';
  const DEFAULT_THRESHOLD = 50;
  const MIN_THRESHOLD = 5;
  const MAX_THRESHOLD = 500;
  const STARTUP_SUPPRESS_MS = 60 * 1000;
  const RESTORE_SUPPRESS_MS = 20 * 1000;
  const REARM_DEBOUNCE_MS = 150;
  const BADGE_MS = 8000;

  let archiveTabs = async () => 0;
  let badgeTimer = null;

  // ---------- 纯函数 ----------

  function clampThreshold(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_THRESHOLD;
    return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, n));
  }

  function shouldArchive(count, threshold, armed) {
    return armed === true && Number(count) >= Number(threshold);
  }

  // 除当前活动标签外全部归档（活动标签留着，窗口才不会因为清空而关闭）。
  // 没有活动标签（异常）时保留 index 最小的那个。固定标签的取舍交给归档函数。
  function pickArchiveTabs(tabs) {
    const list = (Array.isArray(tabs) ? tabs : []).filter(
      (tab) => tab && typeof tab.id === 'number'
    );
    if (list.length <= 1) return [];
    const active = list.find((tab) => tab.active);
    const keep = active || [...list].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
    return list.filter((tab) => tab.id !== keep.id);
  }

  // ---------- 配置 ----------

  async function readConfig() {
    const data = await chrome.storage.local.get([
      'tabOverflowEnabled',
      'tabOverflowThreshold'
    ]);
    return {
      enabled: data.tabOverflowEnabled !== false,
      threshold: clampThreshold(data.tabOverflowThreshold)
    };
  }

  // ---------- session 状态（带回退，页面/测试环境没有 session 时也能跑） ----------

  const memoryState = {};
  let memorySuppressUntil = 0;

  function sessionArea() {
    try {
      return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
    } catch (e) {
      return null;
    }
  }

  async function readState() {
    const area = sessionArea();
    if (!area) return { ...memoryState };
    try {
      const data = await area.get(STATE_KEY);
      return (data && data[STATE_KEY]) || {};
    } catch (e) {
      return { ...memoryState };
    }
  }

  async function writeState(state) {
    const area = sessionArea();
    if (!area) {
      for (const key of Object.keys(memoryState)) delete memoryState[key];
      Object.assign(memoryState, state);
      return;
    }
    try {
      await area.set({ [STATE_KEY]: state });
    } catch (e) {
      console.warn('[tab-overflow] 写入 session 状态失败:', e);
    }
  }

  async function suppressFor(ms) {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    const area = sessionArea();
    if (!area) {
      memorySuppressUntil = Math.max(memorySuppressUntil, until);
      return until;
    }
    try {
      const data = await area.get(SUPPRESS_KEY);
      const current = Number(data && data[SUPPRESS_KEY]) || 0;
      if (until > current) await area.set({ [SUPPRESS_KEY]: until });
      return Math.max(until, current);
    } catch (e) {
      memorySuppressUntil = Math.max(memorySuppressUntil, until);
      return until;
    }
  }

  async function suppressedUntil() {
    const area = sessionArea();
    if (!area) return memorySuppressUntil;
    try {
      const data = await area.get(SUPPRESS_KEY);
      return Number(data && data[SUPPRESS_KEY]) || 0;
    } catch (e) {
      return memorySuppressUntil;
    }
  }

  // ---------- 串行化 / 去抖 ----------

  let queue = Promise.resolve();
  function enqueue(task) {
    queue = queue.then(task).catch((err) => console.warn('[tab-overflow] 任务失败:', err));
    return queue;
  }

  const rearmTimers = new Map();
  function scheduleRearm(windowId) {
    if (typeof windowId !== 'number') return;
    const existing = rearmTimers.get(windowId);
    if (existing) clearTimeout(existing);
    rearmTimers.set(
      windowId,
      setTimeout(() => {
        rearmTimers.delete(windowId);
        enqueue(() => evaluateWindow(windowId, 'removed'));
      }, REARM_DEBOUNCE_MS)
    );
  }

  async function forgetWindow(windowId) {
    const state = await readState();
    if (!Object.prototype.hasOwnProperty.call(state, windowId)) return;
    delete state[windowId];
    await writeState(state);
  }

  // ---------- 角标 ----------

  function showBadge(count) {
    try {
      if (!chrome.action || !chrome.action.setBadgeText) return;
      chrome.action.setBadgeBackgroundColor({ color: '#444444' });
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        badgeTimer = null;
        try {
          chrome.action.setBadgeText({ text: '' });
        } catch (e) {
          // 扩展正在卸载
        }
      }, BADGE_MS);
    } catch (e) {
      // 角标只是提示，失败不影响归档
    }
  }

  // ---------- 核心：评估一个窗口 ----------

  async function evaluateWindow(windowId, trigger) {
    if (typeof windowId !== 'number') return { skipped: 'no-window' };

    const config = await readConfig();
    if (!config.enabled) return { skipped: 'disabled' };

    const until = await suppressedUntil();
    if (until > Date.now()) {
      return { skipped: 'suppressed', until };
    }

    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ windowId });
    } catch (e) {
      return { skipped: 'query-failed', error: e.message };
    }

    const count = tabs.length;
    const state = await readState();
    const entry = state[windowId] || { armed: true };

    if (!shouldArchive(count, config.threshold, entry.armed)) {
      // 回落到阈值以下 → 重新武装，下一次越线还能再归档
      if (count < config.threshold && entry.armed !== true) {
        entry.armed = true;
        state[windowId] = entry;
        await writeState(state);
        return { skipped: 're-armed', count };
      }
      return {
        skipped: entry.armed === true ? 'below-threshold' : 'already-fired',
        count
      };
    }

    // 先解除武装再动手：并发事件（一次恢复几十个标签）不会重复归档
    entry.armed = false;
    entry.lastFiredAt = Date.now();
    state[windowId] = entry;
    await writeState(state);

    const candidates = pickArchiveTabs(tabs);
    let archived = 0;
    try {
      archived = Number(await archiveTabs(candidates)) || 0;
    } catch (e) {
      console.warn('[tab-overflow] 归档失败:', e);
      // 失败就把武装状态放回去，下一次新增标签还能重试
      entry.armed = true;
      state[windowId] = entry;
      await writeState(state);
      return { skipped: 'archive-failed', count, error: e.message };
    }

    const result = {
      archived,
      total: count,
      threshold: config.threshold,
      windowId,
      trigger: trigger || 'created',
      at: Date.now()
    };
    try {
      await chrome.storage.local.set({ tabOverflowLastResult: result });
    } catch (e) {
      // 结果只是给设置页看的
    }
    showBadge(archived);
    console.info(
      '[tab-overflow] 窗口 ' + windowId + ' 有 ' + count + ' 个标签（阈值 ' +
        config.threshold + '），归档 ' + archived + ' 个（触发：' + result.trigger + '）'
    );
    return { archived, count, ...result };
  }

  // ---------- 事件注册 ----------

  let initialized = false;

  function init(deps) {
    if (initialized) return;
    initialized = true;
    if (deps && typeof deps.archiveTabs === 'function') archiveTabs = deps.archiveTabs;

    chrome.tabs.onCreated.addListener((tab) => {
      if (tab && typeof tab.windowId === 'number') {
        enqueue(() => evaluateWindow(tab.windowId, 'created'));
      }
    });

    // 标签被拖进另一个窗口也算一次越线
    chrome.tabs.onAttached.addListener((tabId, info) => {
      if (info && typeof info.newWindowId === 'number') {
        enqueue(() => evaluateWindow(info.newWindowId, 'attached'));
      }
    });

    chrome.tabs.onRemoved.addListener((tabId, info) => {
      if (info && typeof info.windowId === 'number') scheduleRearm(info.windowId);
    });

    if (chrome.windows && chrome.windows.onRemoved) {
      chrome.windows.onRemoved.addListener((windowId) => enqueue(() => forgetWindow(windowId)));
    }

    // 浏览器启动：会话恢复会批量建标签，先压住 60 秒。
    // 这里不设置抑制窗口——SW 每次被唤醒都会执行 init，若在 init 里抑制，
    // 用户开第 50 个标签时恰好唤醒 worker，就会被自己的抑制窗口吞掉。
    if (chrome.runtime && chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        suppressFor(STARTUP_SUPPRESS_MS);
      });
    }
  }

  globalThis.HJX_TAB_OVERFLOW = {
    DEFAULT_THRESHOLD,
    MIN_THRESHOLD,
    MAX_THRESHOLD,
    RESTORE_SUPPRESS_MS,
    clampThreshold,
    shouldArchive,
    pickArchiveTabs,
    readConfig,
    readState,
    suppressFor,
    evaluateWindow,
    forgetWindow,
    init
  };
})();
