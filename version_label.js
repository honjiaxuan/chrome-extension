// 版本号唯一来源是 manifest.json，这里只负责显示
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('extension-version');
  if (el) el.textContent = 'OneTab build · v' + chrome.runtime.getManifest().version;
});
