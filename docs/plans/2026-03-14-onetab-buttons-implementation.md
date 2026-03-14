# OneTab Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix and implement core OneTab buttons by standardizing background message handling and adding missing logic.

**Architecture:** Update the background service worker to handle both legacy short-type messages (Kt, Ua, kt) and new descriptive actions, ensuring Manifest V3 compatibility.

**Tech Stack:** Chrome Extension API (Tabs, Storage, Runtime), JavaScript (ES6+).

---

### Task 1: Update Manifest Permissions

**Files:**
- Modify: `manifest.json`

**Step 1: Add missing permissions**
Ensure `tabs`, `storage`, and `unlimitedStorage` are present.

**Step 2: Commit**
```bash
git add manifest.json
git commit -m "chore: ensure necessary permissions in manifest"
```

### Task 2: Implement Message Router in Background

**Files:**
- Modify: `background.js`

**Step 1: Add handleAction router**
Implement a function to handle both legacy and new message types.

**Step 2: Update onMessage listener**
Call `handleAction` from the listener and ensure `return true` is used.

**Step 3: Commit**
```bash
git add background.js
git commit -m "feat: add message router to background service worker"
```

### Task 3: Implement "Bring All Tabs" (Kt) Logic

**Files:**
- Modify: `background.js`

**Step 1: Implement BRING_ALL_TABS logic**
Query all non-pinned tabs in the current window, save them to `chrome.storage.local`, and close them.

**Step 2: Map 'Kt' to BRING_ALL_TABS**
Update the router to call this logic when `Kt` is received.

**Step 3: Commit**
```bash
git add background.js
git commit -m "feat: implement Bring All Tabs logic"
```

### Task 4: Implement Navigation Actions (kt, OPEN_OPTIONS)

**Files:**
- Modify: `background.js`

**Step 1: Implement OPEN_PAGE logic**
Use `chrome.tabs.create` to open internal or external pages.

**Step 2: Map 'kt' and 'OPEN_OPTIONS'**
Update the router to handle these actions.

**Step 3: Commit**
```bash
git add background.js
git commit -m "feat: implement navigation actions"
```

### Task 5: Implement "Share as Web Page" (Ua) Placeholder

**Files:**
- Modify: `background.js`

**Step 1: Implement SHARE_AS_WEB_PAGE logic**
For now, log the request and return a success response (or a mock URL).

**Step 2: Map 'Ua' to SHARE_AS_WEB_PAGE**
Update the router.

**Step 3: Commit**
```bash
git add background.js
git commit -m "feat: add placeholder for Share as Web Page"
```

### Task 6: Verification

**Step 1: Verify background logs**
Check that clicking buttons in the OneTab page triggers the correct logs in the background service worker.

**Step 2: Final Commit**
```bash
git commit --allow-empty -m "docs: implementation complete"
```
