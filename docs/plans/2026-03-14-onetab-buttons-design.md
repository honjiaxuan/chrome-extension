# Design Doc: OneTab Button Implementation and Background Communication

## 1. Overview
This document outlines the design for implementing core OneTab-like buttons ("Bring all tabs", "Share as web page", "Export/Import", "Options", "About/Feedback") in a Manifest V3 Chrome extension.

## 2. Architecture
The extension uses a **Standardized Action-Based Messaging** pattern to decouple the UI from the background logic.

### 2.1 Components
- **Frontend (onetab.html / popup.html)**: Contains the UI buttons and event listeners.
- **Messaging Layer**: Uses `chrome.runtime.sendMessage` with descriptive action strings.
- **Background Service Worker (background.js)**: Acts as the central controller, handling tab operations and storage.

## 3. Implementation Details

### 3.1 Messaging Protocol
Messages sent from the frontend will follow this structure:
```json
{
  "action": "ACTION_NAME",
  "args": []
}
```

### 3.2 Action Mapping
| Action | Description | Background Logic |
| :--- | :--- | :--- |
| `BRING_ALL_TABS` | Moves all tabs into OneTab | Query tabs, save to storage, close tabs |
| `SHARE_AS_WEB_PAGE` | Uploads tab list to a web page | Fetch API to upload data, open result URL |
| `OPEN_EXPORT_IMPORT` | Opens the Export/Import page | `chrome.tabs.create({ url: 'import-export.html' })` |
| `OPEN_OPTIONS` | Opens the extension options | `chrome.runtime.openOptionsPage()` |
| `OPEN_ABOUT_FEEDBACK` | Opens the About/Feedback site | `chrome.tabs.create({ url: 'https://www.one-tab.com' })` |

### 3.3 Background Router
The background script will implement a `handleAction` function to route requests:
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action) {
        handleAction(message.action, message.args, sendResponse);
        return true; // Async support
    }
});
```

## 4. Manifest V3 Considerations
- **Service Worker Lifecycle**: The background script is stateless. All data must be persisted in `chrome.storage.local`.
- **Permissions**: Requires `tabs`, `storage`, and `scripting` (if injecting logic).
- **Async Responses**: `sendResponse` must be handled correctly with `return true` in the listener.

## 5. Error Handling
- Use `try/catch` blocks for all `chrome.*` API calls.
- Log errors to the console for debugging.
- Provide user feedback in the UI if an action fails (e.g., "Failed to share tabs").
