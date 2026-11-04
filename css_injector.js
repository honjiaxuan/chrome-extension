// missav 样式覆盖：标题不再截断 + 隐藏右下角广告浮层
// 匹配范围由 manifest 限定，这里不再重复判断域名。
(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .my-2.text-sm.text-nord4.truncate {
      white-space: normal !important;
      overflow: visible !important;
      text-overflow: unset !important;
    }
    .root--26nWL.bottomRight--h0VsQ {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  console.log('[hjx] missav 样式覆盖已注入');
})();
