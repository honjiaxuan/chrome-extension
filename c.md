You are modifying an existing Microsoft Edge (Chromium) extension.

Goal:
Add a new feature to toggle pin / unpin for the currently active tab, bound to a keyboard shortcut.

Requirements:
1. Use Manifest V3.
2. Shortcut key must be:
   ctrl + alt + shift + p
3. One shortcut toggles state:
   - If the active tab is pinned → unpin it
   - If the active tab is not pinned → pin it
4. Must work on the current window’s active tab.
5. No UI needed (no popup, no options page).
6. Use the background service worker.

Implementation steps:
- Update manifest.json:
  - Ensure "permissions" includes "tabs"
  - Add a "commands" entry with:
    name: toggle-pin
    suggested_key.default: Ctrl+Alt+Shift+P
    description: Toggle pin/unpin active tab
- In the background service worker:
  - Listen for chrome.commands.onCommand
  - When command === "toggle-pin":
    - Query the active tab in the current window
    - Call chrome.tabs.update(tab.id, { pinned: !tab.pinned })

Constraints:
- Do not break existing extension behavior
- Integrate cleanly with existing background logic
- Follow Chromium extension APIs only (no Edge-only APIs)

Deliverables:
- Updated manifest.json (only the relevant diff if possible)
- Background/service worker code implementing the toggle logic
