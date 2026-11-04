// ACG 站点：访问拦截 + 内容过滤（isolated world）
// 依赖同一次注入的 config.js
(() => {
  'use strict';

  const CFG = globalThis.HJX_CONFIG;
  if (!CFG) {
    console.warn('[hjx] config.js 未加载，content.js 退出');
    return;
  }

  const HIDDEN_ATTR = 'data-acg-hidden';
  const ORIGINAL_TITLE_ATTR = 'data-acg-original-title';

  const host = location.hostname;
  const hostMatches = (hosts) => hosts.some((h) => host === h || host.endsWith('.' + h));

  const isWnacg = hostMatches(['wnacg.com']);
  const isChunman = hostMatches(CFG.chunman.hosts);
  const hasAccessBlock = CFG.accessBlocks.some((b) => hostMatches(b.hosts));
  const hasFilter = isWnacg || isChunman;

  // 状态只全量读一次，之后靠 storage.onChanged 增量更新（不再每 30 秒重读）
  const state = {
    accessBlock: true,
    contentFilter: true,
    unblockUntil: 0,
    keywords: []
  };

  const isUnblocked = () => Date.now() < state.unblockUntil;
  const filtersActive = () => state.contentFilter && !isUnblocked();

  const storageGet = (keys) =>
    chrome.storage.local.get(keys).catch(() => {
      // 扩展被重载/更新后上下文失效，静默降级
      return {};
    });

  function readSettings() {
    return storageGet(['extensionEnabled', 'contentFilterEnabled', 'unblockUntil', 'blockedKeywords']).then((d) => {
      state.accessBlock = d.extensionEnabled !== false;
      state.contentFilter = d.contentFilterEnabled !== false;
      state.unblockUntil = Number(d.unblockUntil) || 0;
      state.keywords = Array.isArray(d.blockedKeywords) ? d.blockedKeywords.filter(Boolean) : [];
    });
  }

  // ---------- 一次性跳转 ----------

  function runRedirects() {
    for (const rule of CFG.redirects) {
      if (!hostMatches(rule.hosts)) continue;
      const m = location.pathname.match(rule.from);
      if (!m) continue;
      const target = rule.to(m);
      if (target && target !== location.pathname) {
        console.log('[hjx] redirect ' + location.pathname + ' -> ' + target);
        location.replace(target);
      }
      return;
    }
  }

  // ---------- 访问拦截 ----------
  // 真正的机制不是页面遮罩：命中后让后台把 OneTab 队列里的一条弹出来顶替当前标签。
  // 队列为空时后台会跳到 onetab.html。

  function blockedPageName() {
    for (const block of CFG.accessBlocks) {
      if (!hostMatches(block.hosts)) continue;
      if (block.paths.includes(location.pathname)) return block.name;
    }
    return null;
  }

  // 同一次导航只顶替一次，避免轮询/observer 重复发消息
  let lastBlockKey = '';

  function applyAccessBlock() {
    if (!state.accessBlock || isUnblocked()) return;
    const name = blockedPageName();
    if (!name) return;
    const key = name + '|' + location.pathname;
    if (key === lastBlockKey) return;
    lastBlockKey = key;
    console.log('[hjx] 拦截 ' + name + ' ' + location.pathname);
    try {
      chrome.runtime.sendMessage({ action: 'popAndRedirect' }).catch(() => {});
    } catch (e) {
      // 扩展上下文失效
    }
  }

  // ---------- wnacg ----------

  const isWnacgListPage = () =>
    CFG.wnacg.listExact.includes(location.pathname) ||
    CFG.wnacg.listPrefixes.some((p) => location.pathname.startsWith(p));

  function isBlockedCategory(item) {
    const picBox = item.querySelector(".pic_box[class*='cate-']");
    if (!picBox) return false;
    if (CFG.wnacg.blockedClasses.some((cls) => picBox.classList.contains(cls))) return true;

    const raw = window.getComputedStyle(picBox, '::before').getPropertyValue('content') || '';
    const normalized = raw
      .replace(/['"]/g, '')
      .replace(/／/g, '/')
      .replace(/＆/g, '&');
    return CFG.wnacg.blockedCategoryText.some((text) => normalized.includes(text));
  }

  function cleanTitle(text) {
    let out = text;
    for (const re of CFG.wnacg.cleanupPatterns) out = out.replace(re, '');
    return out.replace(/\s+/g, ' ').trim();
  }

  function hideItem(item) {
    item.style.display = 'none';
    item.setAttribute(HIDDEN_ATTR, 'wnacg');
  }

  function showItem(item) {
    if (!item.hasAttribute(HIDDEN_ATTR)) return;
    item.style.display = '';
    item.removeAttribute(HIDDEN_ATTR);
  }

  function hideWnacgItems() {
    if (!isWnacgListPage()) return;

    document.querySelectorAll('.li.gallary_item').forEach((item) => {
      if (isBlockedCategory(item)) {
        hideItem(item);
        return;
      }

      const titleEl = item.querySelector('.title a');
      if (!titleEl) return;

      const titleText = titleEl.innerText || titleEl.textContent || '';
      if (state.keywords.some((kw) => titleText.includes(kw))) {
        hideItem(item);
        return;
      }

      // 关键词被删掉之后要能恢复
      showItem(item);

      // 标题清洗：原文存进属性，解锁/关过滤时可以还原（旧版改了就再也回不去）
      if (!titleEl.hasAttribute(ORIGINAL_TITLE_ATTR)) {
        const original = titleEl.innerText || '';
        const cleaned = cleanTitle(original);
        if (cleaned && cleaned !== original) {
          titleEl.setAttribute(ORIGINAL_TITLE_ATTR, original);
          titleEl.innerText = cleaned;
          titleEl.title = cleaned;
        }
      }
    });
  }

  function restoreWnacg() {
    document.querySelectorAll('[' + HIDDEN_ATTR + '="wnacg"]').forEach((item) => {
      item.style.display = '';
      item.removeAttribute(HIDDEN_ATTR);
    });
    document.querySelectorAll('[' + ORIGINAL_TITLE_ATTR + ']').forEach((el) => {
      el.innerText = el.getAttribute(ORIGINAL_TITLE_ATTR) || '';
      el.removeAttribute(ORIGINAL_TITLE_ATTR);
    });
  }

  // ---------- chunman4 ----------

  function hideChunmanThreads() {
    document.querySelectorAll('th.forumtit').forEach((cell) => {
      const titleEl = cell.querySelector('a.s.xst');
      if (!titleEl) return;
      const titleText = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!titleText) return;

      const row = cell.closest('tr') || cell;
      const blocked = CFG.chunman.blockedTitleKeywords.some((kw) => titleText.includes(kw));

      if (blocked) {
        row.style.display = 'none';
        row.setAttribute(HIDDEN_ATTR, 'chunman');
      } else {
        showItem(row);
      }
    });
  }

  function restoreChunman() {
    document.querySelectorAll('[' + HIDDEN_ATTR + '="chunman"]').forEach((row) => {
      row.style.display = '';
      row.removeAttribute(HIDDEN_ATTR);
    });
  }

  // ---------- 调度 ----------

  function apply() {
    if (hasAccessBlock) applyAccessBlock();
    if (!hasFilter) return;

    if (!filtersActive()) {
      if (isWnacg) restoreWnacg();
      if (isChunman) restoreChunman();
      return;
    }

    if (isWnacg) hideWnacgItems();
    if (isChunman) hideChunmanThreads();
  }

  // observer 只注册一次；回调里先看开关状态，临时解锁期间不会再隐藏/改标题
  function watchDom() {
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!filtersActive()) {
          if (isWnacg) restoreWnacg();
          if (isChunman) restoreChunman();
          return;
        }
        if (isWnacg) hideWnacgItems();
        if (isChunman) hideChunmanThreads();
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // SPA 跳转即时感知：popstate/hashchange + pushState 包裹 + 1 秒 href 兜底
  // isolated world 拦不到页面自己调用的 pushState，所以兜底轮询不能省
  function watchNavigation() {
    let lastHref = location.href;
    const onMaybeNavigate = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      lastBlockKey = '';
      apply();
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function wrapped(...args) {
        const result = original.apply(this, args);
        queueMicrotask(onMaybeNavigate);
        return result;
      };
    }

    addEventListener('popstate', onMaybeNavigate);
    addEventListener('hashchange', onMaybeNavigate);
    setInterval(onMaybeNavigate, 1000);
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const relevant = ['extensionEnabled', 'contentFilterEnabled', 'unblockUntil', 'blockedKeywords'];
      if (!relevant.some((key) => key in changes)) return;
      readSettings().then(apply);
    });
  }

  runRedirects();

  // 纯跳转站点（jmcomic / aaccnn / 8xbook）：不读存储、不注册观察者
  if (!hasAccessBlock && !hasFilter) return;

  readSettings().then(() => {
    apply();
    watchStorage();
    watchNavigation();
    if (hasFilter) watchDom();
  });
})();
