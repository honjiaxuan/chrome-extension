// popup.js

document.addEventListener('DOMContentLoaded', function () {
    const masterSwitch = document.getElementById('extension-master-switch');

    const keywordInput = document.getElementById('keyword-input');
    const addKeywordBtn = document.getElementById('add-keyword');
    const keywordList = document.getElementById('keyword-list');
    const unblockInput = document.getElementById('unblock-input');
    const confirmationDialog = document.getElementById('confirmation-dialog');
    const confirmBtn = document.getElementById('confirm-btn');
    const meditateBtn = document.getElementById('meditate-btn');

    function renderKeywords(keywords) {
        keywordList.innerHTML = '';
        keywords.forEach((kw, idx) => {
            const li = document.createElement('li');
            li.className = 'keyword-item';
            const span = document.createElement('span');
            span.textContent = kw;
            const removeBtn = document.createElement('span');
            removeBtn.textContent = '✕';
            removeBtn.className = 'remove-btn';
            removeBtn.addEventListener('click', () => {
                keywords.splice(idx, 1);
                chrome.storage.local.set({ blockedKeywords: keywords }, () => {
                    renderKeywords(keywords);
                });
            });
            li.appendChild(span);
            li.appendChild(removeBtn);
            keywordList.appendChild(li);
        });
    }

    function showConfirmationDialog() {
        confirmationDialog.style.display = 'flex';
    }

    function hideConfirmationDialog() {
        confirmationDialog.style.display = 'none';
    }

    function executeUnblock() {
        // Set temporary unblock for 5 minutes
        const unblockUntil = Date.now() + 5 * 60 * 1000; // 5 minutes
        chrome.runtime.sendMessage({ action: 'setTemporaryUnblock', unblockUntil }, (response) => {
            if (response && response.success) {
                // Also remove overlay from current tab
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    if (tabs[0] && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: 'removeOverlay' }, (response) => {
                            // Success - no alert needed
                        });
                    }
                });
            }
        });
    }

    chrome.storage.local.get(['blockedKeywords'], function (data) {
        renderKeywords(data.blockedKeywords || []);
    });

    addKeywordBtn.addEventListener('click', () => {
        const kw = keywordInput.value.trim();
        if (!kw) return;
        chrome.storage.local.get(['blockedKeywords'], function (data) {
            let keywords = data.blockedKeywords || [];
            if (!keywords.includes(kw)) {
                keywords.push(kw);
                chrome.storage.local.set({ blockedKeywords: keywords }, () => {
                    renderKeywords(keywords);
                    keywordInput.value = '';
                });
            }
        });
    });

    // Handle unblock input field
    unblockInput.addEventListener('input', () => {
        const requiredText = '我是一个很自律很少刷网页的人';
        if (unblockInput.value === requiredText) {
            // Clear the input field
            unblockInput.value = '';
            // Show confirmation dialog
            showConfirmationDialog();
        }
    });

    // Handle confirmation dialog buttons
    confirmBtn.addEventListener('click', () => {
        hideConfirmationDialog();
        executeUnblock();
    });

    meditateBtn.addEventListener('click', () => {
        hideConfirmationDialog();
        // Redirect to meditation timer
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.update(tabs[0].id, { url: 'https://hidden-timer-gck8.vercel.app/' });
            }
        });
    });

    // Close dialog when clicking outside
    confirmationDialog.addEventListener('click', (e) => {
        if (e.target === confirmationDialog) {
            hideConfirmationDialog();
        }
    });

    // Handle master switch
    chrome.storage.local.get(['extensionEnabled'], function (data) {
        masterSwitch.checked = data.extensionEnabled !== false; // Default to true
    });

    masterSwitch.addEventListener('change', () => {
        chrome.storage.local.set({ extensionEnabled: masterSwitch.checked });
        // Send message to current tab to refresh blocking state
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshBlocking' });
            }
        });
    });

}); 