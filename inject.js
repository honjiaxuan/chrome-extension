// inject.js
(function() {
    // 1. Override Page Visibility API
    Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true
    });

    Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true
    });

    // 2. Intercept visibilitychange and related events
    const originalAddEventListener = window.addEventListener;
    window.addEventListener = function(type, listener, options) {
        if (type === 'visibilitychange' || type === 'blur' || type === 'webkitvisibilitychange') {
            return; // Block the listener from being added
        }
        return originalAddEventListener.apply(this, arguments);
    };

    // 3. Prevent document focus loss detection
    document.addEventListener('visibilitychange', (e) => {
        e.stopImmediatePropagation();
    }, true);
    
    // Additional Plyr player check (MutationObserver to ensure playback)
    const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        if (video && video.paused) {
            // Optional: Uncomment the next line if you want to force play
            // video.play().catch(() => {}); 
        }
    });

    function observeBody(observer, config) {
        if (document.body) {
            observer.observe(document.body, config);
        } else {
            setTimeout(() => observeBody(observer, config), 100);
        }
    }

    observeBody(observer, { childList: true, subtree: true });
})();
