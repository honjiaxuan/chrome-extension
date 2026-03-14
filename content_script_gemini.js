(function() {
    'use strict';

    let chatInput = null;

    const findSendButton = () => {
        return document.querySelector('button[aria-label*="Send message"]') ||
               document.querySelector('button[aria-label*="发送"]') ||
               document.querySelector('.send-button');
    };

    const handleKeyDown = (event) => {
        if (event.target !== chatInput) {
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            const sendButton = findSendButton();
            if (sendButton) {
                sendButton.click();
            } else {
                console.error('Gemini Shortcut Switcher: Could not find the send button.');
            }
        }
        else if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            document.execCommand('insertLineBreak');
        }
    };

    const setupListener = (inputElement) => {
        if (chatInput) {
            chatInput.removeEventListener('keydown', handleKeyDown, true);
        }
        chatInput = inputElement;
        chatInput.addEventListener('keydown', handleKeyDown, true);
    };

    const observer = new MutationObserver(() => {
        const input = document.querySelector('div[contenteditable="true"]');
        if (input && input !== chatInput) {
            setupListener(input);
        }
    });

    const initialInput = document.querySelector('div[contenteditable="true"]');
    if (initialInput) {
        setupListener(initialInput);
    }

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
