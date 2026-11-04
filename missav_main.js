// missav：阻止“切走标签就暂停”的检测
// 声明式 MAIN world 内容脚本（manifest 里 "world": "MAIN"），
// 不再用内联 <script> 注入 —— 那种做法会被页面 CSP 拦掉。
(() => {
  'use strict';

  const blockedEvents = new Set(['visibilitychange', 'webkitvisibilitychange', 'blur']);

  const defineValueProperty = (target, property, value) => {
    Object.defineProperty(target, property, {
      get: () => value,
      set: () => true,
      configurable: true
    });
  };

  const defineBlockedHandler = (target, property) => {
    Object.defineProperty(target, property, {
      get: () => null,
      set: () => true,
      configurable: true
    });
  };

  const originalWindowAddEventListener = window.addEventListener.bind(window);
  const originalDocumentAddEventListener = document.addEventListener.bind(document);

  window.addEventListener = function (type, listener, options) {
    if (blockedEvents.has(type)) return;
    return originalWindowAddEventListener(type, listener, options);
  };

  document.addEventListener = function (type, listener, options) {
    if (blockedEvents.has(type)) return;
    return originalDocumentAddEventListener(type, listener, options);
  };

  defineValueProperty(document, 'visibilityState', 'visible');
  defineValueProperty(document, 'hidden', false);
  defineValueProperty(document, 'webkitVisibilityState', 'visible');
  defineValueProperty(document, 'webkitHidden', false);

  defineBlockedHandler(window, 'onblur');
  defineBlockedHandler(document, 'onvisibilitychange');
  defineBlockedHandler(document, 'onwebkitvisibilitychange');
  defineBlockedHandler(window, 'onvisibilitychange');
  defineBlockedHandler(window, 'onwebkitvisibilitychange');

  const stopImmediate = (event) => {
    event.stopImmediatePropagation();
  };

  originalDocumentAddEventListener('visibilitychange', stopImmediate, true);
  originalDocumentAddEventListener('webkitvisibilitychange', stopImmediate, true);
  originalWindowAddEventListener('blur', stopImmediate, true);

  // 被动观察：只在视频被暂停时留日志，不强推播放
  const observer = new MutationObserver(() => {
    const video = document.querySelector('video');
    if (video && video.paused) {
      // 站点若只靠事件暂停，上面的可见性伪装已足够；这里不做强制播放
    }
  });

  const observeBody = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      return;
    }
    setTimeout(observeBody, 100);
  };

  observeBody();
})();
