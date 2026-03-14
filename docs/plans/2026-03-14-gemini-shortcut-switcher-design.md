# Design Doc: Gemini Shortcut Switcher

## Goal
Switch keyboard shortcuts on `gemini.google.com` to match common productivity app patterns:
- `Enter`: Send message
- `Ctrl+Enter`: New line
- `Shift+Enter`: New line (Keep existing behavior)

Currently:
- `Shift+Enter`: New line
- `Ctrl+Enter`: Send message

## Architecture
- A new content script `content_script_gemini.js` dedicated to Gemini logic.
- Managed injection via `manifest.json`.

## Implementation Details
1. **Targeting the Input:**
   - Use `MutationObserver` to detect when the Gemini rich text input (`div[contenteditable="true"]`) is added to the DOM.
   - Attach a `keydown` listener in the **capture phase** to intercept events before Gemini's internal handlers.

2. **Keyboard Event Handling:**
   - Listen for `Enter` key (keyCode 13).
   - If `Enter` + `no modifiers`:
     - Prevent default newline/send.
     - Find the "Send" button and trigger a `click()`.
   - If `Enter` + `Ctrl` or `Enter` + `Shift`:
     - Prevent default if it's `Ctrl+Enter` (to stop the send).
     - Ensure a newline is inserted at the cursor position.

3. **Selectors:**
   - Input: `div[contenteditable="true"]` (within the prompt area).
   - Send Button: `button[aria-label*="Send"]` or `button.send-button`.

## Verification Plan
- Load the extension in developer mode.
- Navigate to `gemini.google.com`.
- Verify `Enter` sends the message.
- Verify `Ctrl+Enter` adds a new line.
- Verify `Shift+Enter` adds a new line.
