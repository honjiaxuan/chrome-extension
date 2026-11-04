// AI 聊天页键盘习惯：Enter 发送、Shift+Enter 换行、Ctrl+Enter 换行
// 三个站点共用这一份，选择器在 config.js 的 aiSites 里
(() => {
  'use strict';

  const CFG = globalThis.HJX_CONFIG;
  if (!CFG || !Array.isArray(CFG.aiSites)) return;

  const host = location.hostname;
  const site = CFG.aiSites.find((s) => s.hosts.some((h) => host === h || host.endsWith('.' + h)));
  if (!site) return;

  const state = { enabled: true, disabledSites: [] };
  const isActive = () => state.enabled && !state.disabledSites.includes(site.id);

  const inputSelector = site.input.join(',');
  const isChatInput = (el) => el instanceof Element && !!el.closest(inputSelector);

  function findSendButton() {
    for (const sel of site.send) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) return btn;
    }
    return null;
  }

  function readSettings() {
    return chrome.storage.local
      .get(['aiShortcutsEnabled', 'aiDisabledSites'])
      .then((d) => {
        state.enabled = d.aiShortcutsEnabled !== false;
        state.disabledSites = Array.isArray(d.aiDisabledSites) ? d.aiDisabledSites : [];
      })
      .catch(() => {});
  }

  // 一个 document 级 capture 监听器，不跟随输入框重建，省掉 MutationObserver
  document.addEventListener(
    'keydown',
    (event) => {
      if (!isActive()) return;
      if (event.key !== 'Enter') return;
      // 中文输入法选词时按 Enter 不能当发送
      if (event.isComposing || event.keyCode === 229) return;
      if (!isChatInput(event.target)) return;

      // Shift+Enter / Alt+Enter / Cmd+Enter 保持站点默认（换行）
      if (event.shiftKey || event.altKey || event.metaKey) return;

      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        event.target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true
          })
        );
        return;
      }

      // 找不到发送按钮就不要拦截：让站点自己处理 Enter（旧版吞掉 Enter 后什么都不发生）
      const sendButton = findSendButton();
      if (!sendButton) {
        console.debug('[hjx] ' + site.label + ': 未找到发送按钮，放行 Enter');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      sendButton.click();
    },
    true
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!('aiShortcutsEnabled' in changes) && !('aiDisabledSites' in changes)) return;
    readSettings();
  });

  readSettings();
})();
