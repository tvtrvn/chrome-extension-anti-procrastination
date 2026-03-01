# Anti-Procrastination Session

A production-ready Chrome Extension (Manifest V3) that helps you stay focused with **focus sessions**, **AFK nudge**, **site blocking**, and a **countdown timer**. Built with vanilla HTML, CSS, and JavaScript (no frameworks).

## Features

- **Focus Session** – Start/end a session. While active: idle detection opens a nudge tab after 120s AFK; distracting sites are blocked; a configurable timer counts down and auto-ends the session.
- **AFK Nudge** – After 120 seconds idle/locked, opens a single nudge tab per idle period (60s cooldown; no per-session cap—each new idle period can trigger one nudge).
- **Site Blocking** – Declarative Net Request (MV3) blocks user-defined domains during sessions using `action.type: "block"` (no redirect).
- **Timer** – Presets (25, 50 min) or custom 1–180 minutes (max 3 hours). Sessions auto-end at 3 hours so you must start a new session to continue. Uses `chrome.alarms` so the timer keeps running when the popup is closed.
- **Tasks** – Simple task list in the popup and a full **Tasks** tab that stays in sync via `chrome.storage`.

---

## How to Load the Unpacked Extension

1. Open Chrome and go to **chrome://extensions**.
2. Turn on **Developer mode** (toggle in the top-right).
3. Click **Load unpacked**.
4. Select the folder that contains this project (e.g. zip this project: `my-procrastination-extension-app`).
5. The extension should appear in the toolbar. Click the puzzle icon and pin **Anti-Procrastination Session** if you like.

---

## How to Test the AFK Nudge

1. **Start a session** from the popup (e.g. 25 min).
2. **Stay idle** (or lock your computer) for **more than 120 seconds**.
3. When Chrome’s idle state becomes **“idle”** or **“locked”**, the extension will open **one** nudge tab to the configured `NUDGE_URL` (default: `https://careers.mcdonalds.ca/`).
4. **Return** (move mouse or unlock). The “nudged this idle period” flag resets, so the next time you’re idle 120+ seconds you can get one more nudge. There is **no per-session cap**—only **one nudge per idle period**.
5. **Limits**: one nudge per idle period; at least **60 seconds** between nudge tabs (cooldown). If a nudge tab is already open, the extension will focus it instead of opening a duplicate.

---

## How to Use the Timer (Presets + Custom)

- **Presets**: In the popup, click **25 min** or **50 min** to set the duration. Then click **Start session**. The countdown is shown in **mm:ss**.
- **Custom**: Enter a number between **1** and **180** in the “Custom (1–180 min, max 3 hr)” field, then **Start session**. Session duration is capped at **3 hours** so the extension does not stay on indefinitely; you must start a new session to continue.
- The timer runs in the background (service worker + `chrome.alarms`). You can close the popup; when you reopen it, the remaining time is recalculated from `sessionEndAt` in storage.
- When the timer reaches **0**, the session ends automatically: blocking rules are removed and idle nudging stops. If you enabled **“Open ‘Session complete’ tab when timer ends”**, a tab will open to the popup (or a completion URL you configure).

---

## How Site Blocking Works (MV3 declarativeNetRequest)

- Blocking uses **declarativeNetRequest** with **dynamic rules** only (no static rule file in the manifest).
- When you **start a session** and **“Block distracting sites”** is on, the service worker creates one **block** rule per blocked domain: `action: { type: "block" }`, `condition: { requestDomains: [domain], resourceTypes: ["main_frame"] }`. This blocks main-frame navigation to that domain (and subdomains) during an active session.
- When you **end the session** (or turn off the block toggle), the service worker **removes** all dynamic rules in the reserved range (1000..1999), so sites load normally again.
- Rule ID strategy: `blockedSites[i]` → rule id `1000 + i`. On any change, rules 1000..1999 are removed and new rules are added for the current list.
- **Note:** Redirect-to-blocked.html is intentionally not used to avoid DNR redirect schema issues; we use `action.type: "block"` for maximum reliability.

---

## How to Add Blocked Sites

1. Open the extension **popup**.
2. In **“Block sites during session”**, ensure the **“Block distracting sites”** toggle is **on**.
3. Type a **domain** in the input (e.g. `youtube.com`, `twitter.com`, `reddit.com`) and click **Add**.
4. The domain appears in the list. It will be blocked only **while a session is active**.
5. Use **Remove** next to a domain to stop blocking it.

Domains are stored in `chrome.storage.local` and applied as dynamic DNR rules when a session is active.

---

## How to Change the Nudge URL

1. Open **background.js** in the project.
2. Find the constant at the top:
   ```js
   const NUDGE_URL = "https://careers.mcdonalds.ca/";
   ```
3. Replace it with your desired URL (e.g. a focus reminder or your task list), then save.
4. Reload the extension at **chrome://extensions** (click the refresh icon on the extension card).

---

## How to Package (Zip) for the Chrome Web Store

1. **Remove** any dev-only files (e.g. `.git`, `node_modules`, `.DS_Store`, `README.md` if you don’t want it in the zip).
2. **Include** at least:
   - `manifest.json`
   - `background.js`
   - `popup.html`, `popup.js`
   - `tasks.html`, `tasks.js`
   - `blocked.html`, `blocked.js`
   - `styles.css`
3. Create a **zip** of the extension folder (all required files at the **root** of the zip, i.e. `manifest.json` in the root of the zip, not inside a subfolder).
4. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), create a new item or update an existing one and **upload** this zip as the package.

---

## Project Layout

```
my-procrastination-extension-app/
├── manifest.json
├── background.js      # Service worker: idle, alarms, DNR, messages
├── popup.html
├── popup.js
├── styles.css
├── tasks.html
├── tasks.js
├── blocked.html
├── blocked.js
└── README.md
```

---

## Permissions

- **idle** – Detect when the user is idle or locked (120s interval).
- **storage** – Persist session state, tasks, blocked sites, settings.
- **tabs** – Open nudge tab, focus existing nudge tab, optional “Session complete” tab.
- **alarms** – Timer that keeps running when the popup is closed.
- **declarativeNetRequest** / **declarativeNetRequestWithHostAccess** – Block sites during sessions (block only, no redirect).
- **host_permissions**: `<all_urls>` – Required for declarativeNetRequest to match requests to blocked domains.

---

## Technical Notes

- **Service worker** may suspend; the timer and session state rely on **chrome.alarms** and **chrome.storage.local** as the source of truth.
- **Popup** remaining time is computed from `sessionEndAt` (and current time), not from in-memory state.
- **Blocking rules** are removed when the session ends or when “Block distracting sites” is turned off.
- Starting a **new session** overwrites the previous `sessionEndAt` and refreshes DNR rules and nudge state. Session duration is capped at **3 hours** (see `MAX_SESSION_MINUTES` in `background.js`).
