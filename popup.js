// popup.js

document.addEventListener('DOMContentLoaded', function () {
    const masterSwitch = document.getElementById('extension-master-switch');

    const keywordInput = document.getElementById('keyword-input');
    const addKeywordBtn = document.getElementById('add-keyword');

    addKeywordBtn.addEventListener('click', () => {
        const kw = keywordInput.value.trim();
        if (!kw) return;
        chrome.storage.local.get(['blockedKeywords'], function (data) {
            let keywords = data.blockedKeywords || [];
            if (!keywords.includes(kw)) {
                keywords.push(kw);
                chrome.storage.local.set({ blockedKeywords: keywords }, () => {
                    keywordInput.value = '';
                });
            }
        });
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
