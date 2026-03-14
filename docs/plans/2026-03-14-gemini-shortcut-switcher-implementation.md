# Gemini Shortcut Switcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch keyboard shortcuts on `gemini.google.com` so `Enter` sends the message, and `Ctrl+Enter`/`Shift+Enter` create a new line.

**Architecture:** A dedicated content script `content_script_gemini.js` will be injected into Gemini pages. It will use a `MutationObserver` to find the chat input and intercept `keydown` events in the capture phase.

**Tech Stack:** JavaScript (Chrome Extension Content Scripts), DOM API.

---

### Task 1: Update manifest.json

**Files:**
- Modify: `manifest.json`

**Step 1: Add Gemini permissions and content script entry**

Add `https://gemini.google.com/*` to `host_permissions` and `content_scripts`.

```json
// manifest.json
{
  ...
  "host_permissions": [
    ...
    "https://gemini.google.com/*"
  ],
  ...
  "content_scripts": [
    ...
    {
      "matches": [
        "https://gemini.google.com/*"
      ],
      "js": ["content_script_gemini.js"],
      "run_at": "document_end"
    }
  ]
}
```

**Step 2: Commit**

```bash
git add manifest.json
git commit -m "feat(gemini): add gemini.google.com to manifest"
```

---

### Task 2: Create content_script_gemini.js

**Files:**
- Create: `content_script_gemini.js`

**Step 1: Implement the shortcut logic**

```javascript
(function() {
  'use strict';

  function setupShortcutSwitcher(input) {
    if (input.dataset.shortcutSetup) return;
    input.dataset.shortcutSetup = 'true';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const isMod = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;

        if (!isMod) {
          // Enter (no modifiers) -> Send
          // We let it pass if Gemini already sends on Enter, 
          // but usually we want to ensure it clicks the send button.
          // Gemini's default might be Enter = send, but user says:
          // "currently Shift+Enter is next line and Ctrl+Enter is send"
          // This implies Enter might be doing nothing or newline.
          
          e.preventDefault();
          e.stopPropagation();
          
          const sendButton = document.querySelector('button[aria-label*="Send message"], button[aria-label*="发送"], .send-button');
          if (sendButton && !sendButton.disabled) {
            sendButton.click();
          }
        } else if (e.ctrlKey || e.shiftKey) {
          // Ctrl+Enter or Shift+Enter -> New Line
          // Stop Gemini from sending on Ctrl+Enter
          e.stopPropagation();
          
          // If it's Ctrl+Enter, we might need to manually insert newline 
          // if Gemini doesn't handle it. Shift+Enter usually works by default.
          if (e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              document.execCommand('insertLineBreak');
          }
        }
      }
    }, true); // Capture phase
  }

  const observer = new MutationObserver((mutations) => {
    const input = document.querySelector('div[contenteditable="true"]');
    if (input) {
      setupShortcutSwitcher(input);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial check
  const input = document.querySelector('div[contenteditable="true"]');
  if (input) {
    setupShortcutSwitcher(input);
  }
})();
```

**Step 2: Commit**

```bash
git add content_script_gemini.js
git commit -m "feat(gemini): implement shortcut switcher logic"
```

---

### Task 3: Verification

**Step 1: Manual Verification**

1. Open Chrome and go to `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the extension directory.
4. Go to `https://gemini.google.com/`.
5. Type something in the chat box.
6. Press `Enter` -> Verify message is sent.
7. Press `Ctrl+Enter` -> Verify a new line is added.
8. Press `Shift+Enter` -> Verify a new line is added.

**Step 2: Commit**

```bash
git add docs/plans/2026-03-14-gemini-shortcut-switcher-implementation.md
git commit -m "docs: add implementation plan for gemini shortcuts"
```
