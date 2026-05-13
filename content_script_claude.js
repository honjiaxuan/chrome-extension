(function() {
    'use strict';

    let chatInput = null;

    const findSendButton = () => {
        return document.querySelector('button[aria-label*="Send"]') ||
               document.querySelector('button[data-testid="send-button"]');
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
                console.error('Claude Shortcut Switcher: Could not find the send button.');
            }
        }
        else if (event.key === 'Enter' && event.shiftKey) {
            return;
        }
        else if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            chatInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13,
                shiftKey: true, ctrlKey: false,
                bubbles: true, cancelable: true,
            }));
        }
    };

    const findInputElement = () => {
        return document.querySelector('[aria-label="Send a message"][contenteditable="true"]') ||
               document.querySelector('.tiptap[contenteditable="true"]') ||
               document.querySelector('div[contenteditable="true"]') ||
               document.querySelector('div[role="textbox"]');
    };

    const setupListener = (inputElement) => {
        if (chatInput) {
            chatInput.removeEventListener('keydown', handleKeyDown, true);
        }
        chatInput = inputElement;
        chatInput.addEventListener('keydown', handleKeyDown, true);
    };

    const observer = new MutationObserver(() => {
        const input = findInputElement();
        if (input && input !== chatInput) {
            setupListener(input);
        }
    });

    const initialInput = findInputElement();
    if (initialInput) {
        setupListener(initialInput);
    }

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
