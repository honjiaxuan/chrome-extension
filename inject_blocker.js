// inject_blocker.js
(function() {
    // 1. Aggressive Override: Make window.open non-configurable
    const originalWindowOpen = window.open;
    Object.defineProperty(window, 'open', {
        value: function(url, target, features) {
            // Check for ad URLs specifically
            if (url && (url.includes('tsyndicate.com') || url.includes('pop?url='))) {
                console.log('Blocked malicious forced window.open:', url);
                return null;
            }
            // Only allow if triggered by a user click (isTrusted)
            if (event && event.isTrusted) {
                return originalWindowOpen.apply(this, arguments);
            }
            console.log('Blocked forced window.open:', url);
            return null;
        },
        writable: false,
        configurable: false
    });

    // 2. Sanitize existing/future anchor tags
    function sanitizeAnchors() {
        document.querySelectorAll('a[target="_blank"]').forEach(a => {
            a.setAttribute('target', '_self');
        });
    }

    // Run initially
    sanitizeAnchors();

    // Use MutationObserver for dynamic content
    const observer = new MutationObserver(sanitizeAnchors);

    function observeBody(observer, config) {
        if (document.body) {
            observer.observe(document.body, config);
        } else {
            setTimeout(() => observeBody(observer, config), 100);
        }
    }

    observeBody(observer, { childList: true, subtree: true });

    // 3. Intercept click events to prevent bubbling pop-unders
    document.addEventListener('click', (e) => {
        // Stop bubbling of events that might trigger ad popups
        if (e.target && e.target.closest && e.target.closest('a')) {
            const anchor = e.target.closest('a');
            if (anchor.getAttribute('target') === '_blank') {
                e.stopImmediatePropagation();
            }
        }
    }, true);
})();
