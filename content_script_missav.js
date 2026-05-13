// content_script_missav.js
(function() {
    const injectedCode = `(() => {
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

        window.addEventListener = function(type, listener, options) {
            if (blockedEvents.has(type)) {
                return;
            }

            return originalWindowAddEventListener(type, listener, options);
        };

        document.addEventListener = function(type, listener, options) {
            if (blockedEvents.has(type)) {
                return;
            }

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

        const observer = new MutationObserver(() => {
            const video = document.querySelector('video');

            if (video && video.paused) {
                // Intentionally passive. If site uses event-driven pause only,
                // visibility spoofing should be enough without forcing playback.
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
    })();`;

    const script = document.createElement('script');
    script.textContent = injectedCode;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
})();
