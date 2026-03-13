// content_script_blocker.js
(function() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject_blocker.js');
    s.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(s);
})();
