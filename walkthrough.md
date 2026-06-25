# Anti-Procrastination Session — Complete Codebase Walkthrough

A comprehensive guide for anyone who wants to understand every part of this Chrome extension: what it does, how it works under the hood (service worker, Manifest V3, declarativeNetRequest), where each piece lives, and what every term means.

---

## 1. Introduction

This is a **Chrome extension** (Manifest V3) that helps the user run focused work sessions. It is built with vanilla HTML, CSS, and JavaScript — no framework, no build step, no npm packages. You can drop the folder into `chrome://extensions` and use it directly.

The extension does four things during a "focus session":

1. **Timer.** Runs a countdown for 1–180 minutes (default presets are 25 or 50). When time hits zero, the session auto-ends.
2. **Site blocking.** While the session is active, any domain on the user's block list is dropped at the request layer (you see Chrome's default "ERR_BLOCKED_BY_CLIENT" page).
3. **AFK nudge.** If the user is idle or the OS is locked for 120 seconds, a tab opens to a "wake-up" URL (default: a McDonald's careers page — a deliberately absurd nudge). Only one nudge per idle period; a 60-second cooldown sits between any two nudges.
4. **Task list.** A tiny todo list lives in the popup; the same data also renders in a full-page **Tasks** tab. Both views stay in sync via `chrome.storage`.

Outside a session: the timer doesn't run, blocking is off, idle is ignored. The session is the only "mode" — everything is gated on `sessionActive` in storage.

The whole thing is roughly:

- 1 service worker (`background.js`) — the actual logic.
- 3 HTML pages (`popup.html`, `tasks.html`, `blocked.html`) — UI surfaces.
- 3 JS files (`popup.js`, `tasks.js`, `blocked.js`) — wire the DOM to messages and storage.
- 1 stylesheet (`styles.css`) — shared visual language.
- 1 `manifest.json` — declares everything to Chrome.

`blocked.html` ships with the extension as a "what would the user see if a block redirected here" page, but the live blocker is implemented with `action: { type: "block" }` (no redirect) for reliability — so this page is currently only reachable manually via its `chrome-extension://…/blocked.html?domain=…` URL.

---

## 2. High-Level Architecture

A Manifest V3 extension lives in two cooperating worlds: the **service worker** (one background script, can be suspended at any time) and **document contexts** (the popup, the tasks tab, the blocked page). The two communicate only through `chrome.storage` and `chrome.runtime.sendMessage`.

```
+-----------------------------------------------------------+
|                       Chrome browser                      |
|                                                           |
|  +-------------+      +-------------+      +-------------+|
|  |  popup.html |      |  tasks.html |      | blocked.html||
|  |  + popup.js |      |  + tasks.js |      | + blocked.js||
|  +------+------+      +------+------+      +-------------+|
|         |                    |                            |
|         | sendMessage()      |  storage.get/set            |
|         | storage.get/set    |  storage.onChanged          |
|         v                    v                            |
|  +-----------------------------------------------------+  |
|  |                background.js                        |  |
|  |  (service worker, MV3)                              |  |
|  |                                                     |  |
|  |  • chrome.runtime.onMessage   (popup messages)      |  |
|  |  • chrome.idle.onStateChanged (AFK detection)       |  |
|  |  • chrome.alarms.onAlarm      (timer ticks)         |  |
|  |  • chrome.storage.onChanged   (block-rule refresh)  |  |
|  |  • chrome.tabs.onRemoved      (nudge tab tracking)  |  |
|  |  • chrome.runtime.onStartup   (sync on browser boot)|  |
|  |                                                     |  |
|  |  -> chrome.declarativeNetRequest.updateDynamicRules |  |
|  |  -> chrome.alarms.create / clear                    |  |
|  |  -> chrome.tabs.create / get / update               |  |
|  +-----------------------------------------------------+  |
|                          |                                |
|                          v                                |
|                 chrome.storage.local                      |
|        (single source of truth across reloads)            |
+-----------------------------------------------------------+
```

**Key implications of MV3:**

- The service worker is **ephemeral**. Chrome can suspend it any time the extension is idle. Any in-memory state would be lost on suspension — so this extension keeps *everything* in `chrome.storage.local` and recomputes derived state (remaining time, nudge eligibility) from absolute timestamps.
- The popup is also ephemeral — closing it tears down its JS context. The popup's "1-second refresh loop" only ticks while the popup is open.
- All long-lived periodic work runs through `chrome.alarms`, not `setTimeout` or `setInterval`. `chrome.alarms` survives service-worker suspension and wakes the worker back up when it fires.

---

## 3. Tech Stack at a Glance

| Layer | Technology | Purpose |
|---|---|---|
| Platform | Chrome Extension Manifest V3 | Service-worker-based extension model |
| Background | `chrome.idle`, `chrome.alarms`, `chrome.declarativeNetRequest`, `chrome.tabs`, `chrome.storage` | All session machinery |
| UI | Plain HTML + CSS + vanilla JS | No framework, no bundler, no transpiler |
| Storage | `chrome.storage.local` | Session state, tasks, block list, settings |
| Cross-context messaging | `chrome.runtime.sendMessage` + `onMessage` | Popup → background commands |
| Fonts | Google Fonts (DM Sans) | Loaded via `<link>` in each HTML page |
| Networking | declarativeNetRequest dynamic rules | Site blocking — no content scripts, no webRequest |
| Build | None | The folder is the extension; load unpacked or zip and upload |

---

## 4. Project Layout

```
my-procrastination-extension-app/
├── manifest.json       # Extension manifest (V3): permissions, scripts, action
├── background.js       # Service worker: timer, idle, blocking, message bus
├── popup.html          # The toolbar popup UI
├── popup.js            # Popup logic + message-passing to background
├── tasks.html          # Full-page tasks view (opened in a regular tab)
├── tasks.js            # Tasks page logic (storage-only, no messages)
├── blocked.html        # Standalone blocked-state placeholder page
├── blocked.js          # Reads ?domain= query and renders it
├── styles.css          # Shared visual language for popup/tasks/blocked
├── README.md           # User-facing docs
├── AGENTS.md / CLAUDE.md  # GitNexus notes for AI coding agents
└── .gitignore
```

No subdirectories — everything is at the root, which is required by the manifest for the listed paths to resolve.

---

## 5. How to Run Locally

### Prerequisites

- Google Chrome (or any Chromium-based browser that supports MV3: Edge, Brave, Arc, etc.). No Node, no npm.

### Load as unpacked

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Pick this project's folder. The extension icon appears in the toolbar.
5. Pin it via the puzzle icon for easy access.

### Apply changes

After editing any file:

- Open `chrome://extensions`.
- Click the circular reload icon on the extension's card.

Chrome reloads the manifest, restarts the service worker, and reloads the popup HTML on next open. The blocking rules and alarms persist across reloads only if the extension was active when the reload happened — to be safe, click the toolbar icon → **End session** → **Start session** after a reload to re-seed everything.

### Inspect the service worker

`chrome://extensions` → on this extension's card click **service worker** (under "Inspect views"). A DevTools window opens with the worker's console. Useful for watching the timer tick, the idle handler, and DNR rule applications.

### Inspect the popup

Right-click the toolbar icon → **Inspect popup**. A DevTools window opens scoped to the popup. The popup is a separate JS context from the service worker.

---

## 6. How to Distribute

This is a personal-grade extension; treat it as portfolio code. To ship via the Chrome Web Store:

1. Strip dev-only files (`.git/`, `.DS_Store`, `README.md` if you don't want it visible — though Web Store accepts the source as-is).
2. Required files at the **root of the zip**: `manifest.json`, `background.js`, `popup.html`, `popup.js`, `tasks.html`, `tasks.js`, `blocked.html`, `blocked.js`, `styles.css`.
3. Zip them so that `manifest.json` is at the top level of the archive (not inside a subfolder).
4. Submit through the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). A one-time $5 USD developer registration fee applies.
5. The Web Store reviewer will scrutinize **broad host permissions** (`<all_urls>`) and any use of `declarativeNetRequest` — be ready to explain that blocking is user-driven and only active during a session.

For private use, "Load unpacked" is enough. You can also pack the extension as a `.crx` from `chrome://extensions` → **Pack extension** for ad-hoc distribution, but that requires your users to enable developer mode.

---

## 7. Code Deep-Dive

### 7.1 `manifest.json` — what Chrome sees

```json
{
  "manifest_version": 3,
  "name": "Anti-Procrastination Session",
  "version": "1.0.0",
  "description": "Focus sessions with AFK nudge, site blocking, and timer.",
  "permissions": [
    "idle", "storage", "tabs", "alarms",
    "declarativeNetRequest",
    "declarativeNetRequestWithHostAccess"
  ],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "declarative_net_request": { "rule_resources": [] }
}
```

| Permission | Why this extension needs it |
|---|---|
| `idle` | Subscribe to `chrome.idle.onStateChanged` to detect AFK (idle/locked). |
| `storage` | Persist session, tasks, block list, settings to `chrome.storage.local`. |
| `tabs` | Open the nudge tab, focus a previously-opened nudge tab, open the Tasks tab and (optionally) the completion tab. |
| `alarms` | Schedule the timer ticks. `chrome.alarms` survives service-worker suspension. |
| `declarativeNetRequest` + `declarativeNetRequestWithHostAccess` | Add/remove dynamic block rules for user-supplied domains. |
| `host_permissions: ["<all_urls>"]` | Required by DNR's `requestDomains` matcher so blocks can apply to any site the user enters. |

`rule_resources: []` is intentional — this extension uses **dynamic** DNR rules at runtime (added/removed by the service worker), not a static rules file declared at install time.

### 7.2 `background.js` — the service worker

This is the brain of the extension. About 300 lines of plain JS, organized into seven sections by comment banners:

1. Storage defaults & helpers
2. Idle & nudge
3. declarativeNetRequest blocking
4. Timer (alarms)
5. Storage-change watcher
6. Tab-closed listener
7. Message handler + startup

#### Storage shape

The truth lives in `chrome.storage.local`:

| Key | Type | Meaning |
|---|---|---|
| `sessionActive` | `boolean` | Is a focus session currently running? |
| `sessionEndAt` | `number` (ms since epoch) | Absolute time the session ends. `0` if inactive. |
| `lastNudgeAt` | `number` (ms) | Timestamp of the last nudge open. Used for the 60s cooldown. |
| `nudgedThisIdlePeriod` | `boolean` | Have we already nudged the user since the most recent active→idle transition? Reset to `false` whenever idle state returns to `active`. |
| `nudgeTabId` | `number \| null` | If a nudge tab is open, we remember its ID so we focus it next time instead of opening a duplicate. |
| `blockedSites` | `string[]` | User-provided domain list (normalized, no protocol/path/`www.`). |
| `blockEnabled` | `boolean` | Master switch for the block toggle. Defaults `true`. |
| `tasks` | `Array<{id, text, done}>` | User task list. |
| `settings` | `{ openCompleteTab: boolean }` | Misc per-user options. |

`getStorage()` fills in defaults so the rest of the code can treat the returned object as fully populated. `setStorage(updates)` is a thin wrapper around `chrome.storage.local.set`.

#### Idle / nudge logic

```js
chrome.idle.setDetectionInterval(120);            // 120 seconds
chrome.idle.onStateChanged.addListener(onIdleStateChange);
```

When Chrome judges the user has been idle for 120s (no input) or the screen locks, `onStateChanged` fires with `"idle"` or `"locked"`. The handler `onIdleStateChange`:

- If the new state is `"active"`, set `nudgedThisIdlePeriod = false` — the user came back; the next idle period gets a fresh nudge budget.
- If the new state is `"idle"` or `"locked"`, call `maybeOpenNudgeTab()`.

`maybeOpenNudgeTab()` is the only nudge gatekeeper. It bails out early when:

1. No session is active.
2. We've already nudged this idle period (`nudgedThisIdlePeriod === true`).
3. The 60-second cooldown since the last nudge has not elapsed.

If a previous `nudgeTabId` is stored and that tab still exists, the function **refocuses** it instead of opening a second nudge. Otherwise it opens a new tab to `NUDGE_URL` (default: `https://careers.mcdonalds.ca/` — the joke is "go apply for a job if you can't focus"), records the tab ID, and flips `nudgedThisIdlePeriod` so a second AFK-and-back-quickly cycle doesn't immediately spawn another nudge.

#### Timer (alarms)

```js
const TIMER_TICK_SECONDS = 10;
chrome.alarms.create("sessionTimer", { when: Date.now() + TIMER_TICK_SECONDS * 1000 });
```

A one-shot alarm is scheduled, not a periodic one. Inside `onTimerAlarm()`:

1. If the session is no longer active, return.
2. If `Date.now() >= sessionEndAt`, call `endSession(true)` — the `true` flag means the timer expired (so the optional completion tab can open).
3. Otherwise, **reschedule** another single-shot alarm for `min(10 seconds, remainingMs)` from now.

The reason for "reschedule rather than periodic" is twofold: (a) it lets the final tick fire **exactly** at `sessionEndAt` instead of up to 10 seconds late, and (b) when the worker has been suspended for a while, a single re-arming keeps things drift-free.

`startTimer(durationMinutes)` writes the new state to storage, calls `applyBlockingRules()`, and arms the first tick. `endSession()` does the inverse.

#### Declarative Net Request — site blocking

```js
const DNR_RULE_ID_BASE = 1000;
const DNR_RULE_ID_END = 1999;
```

A 1000-slot range is reserved exclusively for this extension's dynamic rules so a future feature could use, say, 2000+ without colliding. On each rule sync, the worker removes everything in the range and re-adds rules for the current `blockedSites` list with `id = 1000 + i`.

Each rule is a "block main frame requests to this domain":

```js
{
  id: 1000 + i,
  priority: 1,
  action: { type: "block" },
  condition: {
    requestDomains: [domain],
    resourceTypes: ["main_frame"]
  }
}
```

`requestDomains` matches the domain *and its subdomains*. `resourceTypes: ["main_frame"]` keeps the block scoped to top-level navigations — embedded `<iframe>`s or sub-resources on unrelated sites don't get filtered. Chrome shows its built-in "blocked by an extension" error page when the navigation is dropped, which is why `blocked.html` is not currently reached as a redirect destination.

`normalizeDomain(input)` strips `http://`, `https://`, the path, and a leading `www.` so the user can paste `https://www.youtube.com/feed/subscriptions` and it becomes `youtube.com`.

`applyBlockingRules()` reads storage and:

- If `sessionActive === false` or `blockEnabled === false`, **clear** every rule. No session, no blocking — even if the user has 30 domains on the list.
- Otherwise, remove the entire 1000–1999 range and add fresh rules for every domain.

#### Reactive sync

```js
chrome.storage.onChanged.addListener(onStorageChange);
```

Any time `sessionActive`, `blockEnabled`, or `blockedSites` changes (regardless of which context wrote it — popup, tasks page, or the worker itself), the worker re-syncs DNR rules. This is what makes the toggle switch in the popup feel "instant".

#### Tab close → forget the nudge tab

```js
chrome.tabs.onRemoved.addListener((tabId) => { ... });
```

If the user closes the nudge tab manually, `nudgeTabId` is cleared so the next nudge opens a fresh tab instead of trying to focus a dead ID.

#### Message bus (popup → worker)

The popup never mutates session state directly. It calls `chrome.runtime.sendMessage({type: "START_SESSION", durationMinutes: 25})` and the worker handles it. The full message vocabulary:

| `message.type` | Worker action | Returns |
|---|---|---|
| `START_SESSION` | `startTimer(min(180, max(1, durationMinutes \|\| 25)))` | `{ok: true}` |
| `END_SESSION` | `endSession(false)` | `{ok: true}` |
| `GET_SESSION_STATE` | Computes `remainingMs = max(0, sessionEndAt - now)` | `{sessionActive, sessionEndAt, remainingMs}` |
| `ADD_BLOCKED_SITE` | Normalize, dedupe, append to `blockedSites`, re-apply DNR | `{ok, blockedSites}` |
| `REMOVE_BLOCKED_SITE` | Filter out the domain, re-apply DNR | `{ok, blockedSites}` |
| `GET_BLOCKED_SITES` | Read from storage | `{blockedSites, blockEnabled}` |
| `SET_BLOCK_ENABLED` | Flip `blockEnabled`, re-apply DNR | `{ok: true}` |
| `GET_SETTINGS` | Read `settings` | `{settings}` |
| `SET_SETTINGS` | Shallow-merge into `settings` | `{ok: true}` |

The handler `return true`s synchronously so Chrome keeps the message channel open while the async work runs — a common MV3 gotcha.

#### Startup hook

```js
chrome.runtime.onStartup.addListener(async () => {
  initIdleDetection();
  await applyBlockingRules();
});
```

When Chrome starts and re-spins this extension's service worker, we re-arm idle detection and replay the DNR rules from storage so the user doesn't have to reopen the popup to "refresh" anything.

---

### 7.3 `popup.html` + `popup.js` — the toolbar UI

`popup.html` is a 78-line static document. It is organized into five `<section>`s:

1. **Status & timer display** — a coloured dot and a `mm:ss` countdown that reads `--:--` when no session is running.
2. **Session duration** — two preset buttons (`25 min`, `50 min`) and a number input clamped to 1–180.
3. **Session control** — Start / End buttons + a "Open Session complete tab when timer ends" checkbox.
4. **Tasks** — inline task list with a New-task input and a button to open the full Tasks tab.
5. **Site blocking** — a switch + an Add input + the current list of blocked domains.

Every section uses `aria-labelledby` / `aria-live` attributes so screen readers announce status and timer changes correctly.

`popup.js` (250 lines) does five jobs:

**1. Session state refresh.** `refreshSessionState()` posts `GET_SESSION_STATE` to the worker, then:

- Toggles `.active`/`.inactive` on `#status-dot`.
- Renders `mm:ss` via `formatRemaining(ms)` (which uses `Math.floor(totalSec / 60)` for minutes and `String(s).padStart(2, "0")` for seconds).
- Disables/enables Start vs End buttons.
- While the session is active, **the popup ticks at 1 Hz** via `setInterval(refreshSessionState, 1000)` so the displayed time stays current. The interval is cleared when the session ends.

Important: the popup's `setInterval` only runs **while the popup is open**. If you close and reopen, the popup recomputes from `sessionEndAt` — there is no drift because the worker is the source of truth.

**2. Start / End wiring.** `btnStart` reads `getDurationMinutes()` (custom input, falls back to 25), sends `START_SESSION`, then refreshes the status. `btnEnd` sends `END_SESSION` and refreshes.

**3. Tasks.** Reads and writes `chrome.storage.local.tasks` directly (no message round-trip — the popup is allowed to use storage straight). `renderTasks(tasks)` rebuilds the `<ul>` from scratch on each change. Tasks have shape `{id: "t_<timestamp>", text, done}`.

The popup also subscribes to `chrome.storage.onChanged` so if the Tasks tab adds an item, the popup's inline list updates while it remains open.

**4. Blocked sites.** All mutations go through messages (`ADD_BLOCKED_SITE`, `REMOVE_BLOCKED_SITE`, `SET_BLOCK_ENABLED`) because the worker needs to immediately re-apply DNR. After each command, the popup posts `GET_BLOCKED_SITES` to refresh the list.

The toggle is a styled `<button role="switch">` rather than a checkbox, so `aria-checked` updates instead of `checked`.

**5. Settings.** A single checkbox bound to `settings.openCompleteTab`. Round-trips through `GET_SETTINGS` / `SET_SETTINGS`.

Defensive note: every dynamic insertion into the blocked list runs the domain through `escapeHtml()` first to prevent injecting markup via a malicious-looking string in the input.

---

### 7.4 `tasks.html` + `tasks.js` — the full-page tasks view

`tasks.html` is a stripped-down version of the popup's tasks section, rendered as a normal tab page (because the popup is too narrow to make tasks the focus). 

`tasks.js` is a near-duplicate of `popup.js`'s task code. The duplication is deliberate: keeping the two pages independent means a regression in the popup can't break the full-page tasks tab, and the page is portable to other extensions.

Both views subscribe to `chrome.storage.onChanged` filtered on `areaName === "local" && changes.tasks`, so editing a task in one window updates the list in the other tab live — no manual refresh.

---

### 7.5 `blocked.html` + `blocked.js` — the bypassed redirect page

`blocked.html` is a stub "you tried to visit a blocked site" landing page. It reads `?domain=` off the URL and renders it via `escapeHtml`-equivalent (`textContent`).

The page is **not** currently wired in as a redirect target — the README explicitly notes this:

> Redirect-to-blocked.html is intentionally not used to avoid DNR redirect schema issues; we use `action.type: "block"` for maximum reliability.

It is here as a future hook: to enable it, switch the DNR rule from

```js
action: { type: "block" }
```

to

```js
action: {
  type: "redirect",
  redirect: { regexSubstitution: chrome.runtime.getURL("blocked.html") + "?domain=\\1" }
}
```

and add `regexFilter` to the `condition`. The file is already styled with `styles.css` so it would render in-theme immediately.

---

### 7.6 `styles.css` — the visual language

About 440 lines of vanilla CSS, no preprocessor. The popup is fixed at 360px wide. The design uses:

- **Font:** DM Sans (weights 400/500/600/700) from Google Fonts.
- **Theme:** A clean light theme with soft greys for surfaces, a primary accent color for the Start button, danger red on End, and a tinted block-page card.
- **Components:** buttons (`.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`), the toggle switch (`.toggle-switch.on`), the status dot (`.status-dot.active` / `.inactive`), the timer display (`.timer-display.idle` is greyed out), task rows (`.task-text.done` is struck through), and the blocked page card (`.blocked-page`).
- **Layout:** flexbox throughout; no grid, no positioned absolutes for layout.

The same stylesheet is shared by all three HTML files so the popup, tasks tab, and blocked page look like the same product.

---

## 8. Data Flow End-to-End

Walking through a full "user clicks Start with youtube.com on the block list" sequence:

```
User                  popup.js              background.js          chrome APIs
 |                       |                       |                       |
 |-- click Start ------->|                       |                       |
 |                       |-- sendMessage         |                       |
 |                       |   START_SESSION ----->|                       |
 |                       |                       |-- startTimer(25)      |
 |                       |                       |   write storage:      |
 |                       |                       |    sessionActive=true |
 |                       |                       |    sessionEndAt=now+  |
 |                       |                       |                25*60s |
 |                       |                       |-- initIdleDetection   |
 |                       |                       |--------------------->idle.setDetectionInterval(120)
 |                       |                       |-- applyBlockingRules  |
 |                       |                       |--------------------->DNR.updateDynamicRules
 |                       |                       |                       |   remove 1000..1999
 |                       |                       |                       |   add { id:1000, action:block,
 |                       |                       |                       |          condition:{requestDomains:[youtube.com]}}
 |                       |                       |-- alarms.create("sessionTimer", when=now+10s) -> alarms API
 |                       |<-- {ok:true} --------|                       |
 |                       |-- refreshSessionState                          |
 |                       |   sendMessage         |                       |
 |                       |   GET_SESSION_STATE -->|                      |
 |                       |<-- {active, remaining}|                       |
 |   popup shows 25:00   |                       |                       |
 |   ticks every 1s      |                       |                       |
 |                       |                       |                       |
 |                       |                       |   alarm fires every   |
 |                       |                       |   ~10s -> onTimerAlarm|
 |                       |                       |   re-arm or endSession|
 |                       |                       |                       |
 |-- visits youtube.com  |                       |                       |
 |                       |                       |    DNR rule matches   |
 |                       |                       |    request -> blocked |
 |   sees ERR_BLOCKED... |                       |                       |
 |                       |                       |                       |
 |-- walks away >120s    |                       |                       |
 |                       |                       |<- onStateChanged("idle")
 |                       |                       |-- maybeOpenNudgeTab() |
 |                       |                       |--------------------->tabs.create(NUDGE_URL)
 |   sees McDonald's tab |                       |                       |
 |                       |                       |                       |
 |-- comes back          |                       |                       |
 |                       |                       |<- onStateChanged("active")
 |                       |                       |   nudgedThisIdle=false|
 |                       |                       |                       |
 |   25 minutes pass     |                       |                       |
 |                       |                       |   alarm: now>=endAt   |
 |                       |                       |   endSession(true)    |
 |                       |                       |   clear DNR, clear alarm
 |                       |                       |   maybe open complete |
```

The whole sequence touches **four** Chrome APIs (`storage`, `alarms`, `idle`, `declarativeNetRequest`) plus `tabs` for the nudge. No content scripts, no webRequest, no remote backend.

---

## 9. Cross-Context Communication

Three rules govern who reads/writes what.

**Rule 1: `chrome.storage.local` is the source of truth.** Every persistent fact (session state, tasks, block list, settings) lives here. The service worker, popup, and tasks tab all read directly from it.

**Rule 2: Anything that has side effects beyond storage goes through messages.** Starting a session means scheduling an alarm and applying DNR rules — that's not pure storage, so the popup posts `START_SESSION` and lets the worker do those things. Adding a blocked site means updating DNR rules — same story; the popup posts `ADD_BLOCKED_SITE`.

**Rule 3: `storage.onChanged` is the bus for cross-context reactivity.** If the popup writes to `tasks`, the tasks tab's listener fires automatically. If the worker writes to `sessionActive`, the popup's next `GET_SESSION_STATE` (via its 1s tick) reflects it. The worker even listens to its own writes (and the popup's writes) to re-sync DNR.

A nice property of this design: opening the popup never re-creates state. The popup is a *view* over storage. Closing and reopening is a no-op.

---

## 10. Plain-English Glossary

**Action (manifest):** The toolbar button that the extension exposes. When clicked, Chrome opens `popup.html` in a hovering panel.

**Alarm (`chrome.alarms`):** A timer registered with Chrome that survives service-worker suspension. Used here for the session timer instead of `setTimeout`/`setInterval`, which die when the worker sleeps.

**AFK nudge:** When the user is detected as idle/locked for ≥120s, the extension opens a single tab to the configured `NUDGE_URL`. Designed to interrupt unproductive doomscrolling more than to enforce focus.

**`blockedSites`:** The user-curated list of normalized domains in `chrome.storage.local`. Each entry generates one DNR rule while a session is active.

**`blockEnabled`:** Master switch. When `false`, the extension keeps the list but applies zero DNR rules. Defaults to `true`.

**Cooldown (nudge):** `NUDGE_COOLDOWN_MS = 60 * 1000` (60 seconds). Prevents the extension from rapid-firing nudge tabs if the idle/active cycle happens to flap.

**Declarative Net Request (DNR):** The MV3 successor to the old `webRequest` API. Extensions declare rules; Chrome enforces them in-engine, no JS callbacks per request. This extension uses **dynamic** rules (added/removed at runtime) rather than static rule files.

**`DNR_RULE_ID_BASE` / `_END`:** The reserved range 1000–1999 for this extension's dynamic rules. Reserving a contiguous block makes "clear all of mine" a single API call.

**Document context:** A page that runs in its own window/tab (popup, tasks tab, blocked page) — distinct from the service worker context. Communicates with the worker via storage and messages.

**Host permissions (`<all_urls>`):** Required so DNR's `requestDomains` matcher can apply to any domain the user types in. Without this, DNR would silently refuse to register rules for arbitrary hosts.

**Idle detection interval:** Set with `chrome.idle.setDetectionInterval(120)`. Chrome polls input/lock state at most this often.

**Main frame:** The top-level navigation of a tab (the URL you see in the address bar) — not iframes, not images, not XHRs. The DNR rules restrict to `resourceTypes: ["main_frame"]` so blocking is scoped to "the user trying to load youtube.com" rather than every cross-site request that happens to mention it.

**Manifest V3:** The current Chrome extension platform version. Replaces background pages with service workers (ephemeral, can be terminated), restricts remote-hosted code, and uses DNR instead of webRequest blocking.

**Nudge tab:** The single tab opened in response to an AFK event during a session. Tracked by `nudgeTabId` so subsequent nudges focus the same tab instead of opening duplicates.

**`nudgedThisIdlePeriod`:** A per-idle-period flag that ensures only **one** nudge per AFK episode. Reset to `false` whenever the user returns to active.

**Service worker (in extension context):** A single JS file (`background.js`) that runs in the background. Has no DOM. Receives events from `chrome.*` APIs. Chrome can suspend it after periods of inactivity; surviving state must live in `chrome.storage`.

**Session:** A user-initiated interval of focused work, started by clicking Start in the popup. Capped at 180 minutes (`MAX_SESSION_MINUTES`). While active: idle is being watched, DNR rules are in effect, the countdown is running.

**`sessionEndAt`:** Absolute millisecond timestamp. Remaining time is always computed as `max(0, sessionEndAt - Date.now())` so the popup never holds a stale relative-seconds counter.

**Settings:** A small dict for cross-cutting preferences. Currently only `openCompleteTab`.

**Toggle switch (in popup):** A styled `<button role="switch">` that flips `blockEnabled`. The `.on` class drives the visual state; `aria-checked` drives the assistive-tech state.

---

## 11. Common Tasks

### Change the nudge URL

Edit the constant at the top of `background.js`:

```js
const NUDGE_URL = "https://your-replacement-url.example/";
```

Reload the extension at `chrome://extensions`. The change takes effect on the next nudge.

### Change the idle threshold

Same file:

```js
const IDLE_DETECTION_INTERVAL = 120;   // seconds
```

Chrome enforces a minimum of 15 seconds; values below that are clamped silently.

### Change the maximum session length

```js
const MAX_SESSION_MINUTES = 180;
```

The popup input also has `max="180"` — bump it in `popup.html` if you raise this.

### Change the timer tick rate

```js
const TIMER_TICK_SECONDS = 10;
```

A smaller value makes the worker wake up more often (slightly higher idle CPU). A larger value increases the worst-case lag between actual expiry and the worker realizing it; the worker compensates by also rescheduling against `remainingMs` so the *final* tick lands close to the actual deadline.

### Move blocking off-session

To make the block list always-on regardless of `sessionActive`, change `applyBlockingRules()`:

```js
if (!s.blockEnabled) { await clearRules(); return; }
// drop the "!s.sessionActive" check
```

And clear the `chrome.storage.onChanged` filter to fire on `blockedSites` changes regardless of session state (already does).

### Add a new message type

1. Pick a unique string (e.g. `"GET_STATS"`).
2. Add a `case` branch inside the `chrome.runtime.onMessage` handler in `background.js`, returning a plain object.
3. Call it from any page: `const res = await chrome.runtime.sendMessage({type: "GET_STATS"});`.
4. Keep the `handler().then(sendResponse)` pattern intact — the `return true` at the end of the listener is what tells Chrome to keep the message channel open for the async response.

### Enable the `blocked.html` redirect path

Currently blocks are silent. To redirect to the in-extension page:

1. Change the rule action in `applyBlockingRules()`:
   ```js
   action: {
     type: "redirect",
     redirect: { url: chrome.runtime.getURL("blocked.html") + "?domain=" + encodeURIComponent(domain) }
   }
   ```
2. The extension already has `declarativeNetRequestWithHostAccess` permission, which is required for redirect rules.
3. Reload the extension and test.

The README's caveat about "DNR redirect schema issues" refers to past Chrome bugs around `regexSubstitution` — using the simpler `redirect.url` form above avoids them.

### Reset all extension state

Open the service worker DevTools console and run:

```js
chrome.storage.local.clear()
```

Then reload the extension. All tasks, block list, and settings are wiped.

---

## 12. Troubleshooting

**Timer doesn't update / stops at a number.**

You probably closed and reopened the popup, and the 1-second `setInterval` only runs while the popup is open. The displayed time is computed from `sessionEndAt - Date.now()`, so it should be correct on reopen even if it appeared frozen. If the worker has been suspended and not woken up, the *count* is right but the auto-end at zero might be a few seconds late — that is by design (the alarm reschedules tightly near the deadline).

**Blocked sites don't seem blocked.**

Check the obvious things in order:

1. Is a session active? Blocking only applies during a session.
2. Is "Block distracting sites" toggled on?
3. Did you add the domain *without* `http://` or `https://`? The normalizer should handle it, but if you copied a path it might have been stored oddly — remove and re-add as plain `youtube.com`.
4. Open the service worker DevTools and run `chrome.declarativeNetRequest.getDynamicRules()` to inspect the active rules.

**The McDonald's tab never opens.**

- Make sure a session is active.
- Make sure you have actually been idle for 120 full seconds (move-the-mouse-once is enough to reset).
- Open the service worker console and watch for `chrome.idle.onStateChanged` calls.
- Check that the 60-second cooldown hasn't been triggered by an earlier nudge.

**`Service worker registration failed`.**

Look at the service worker section of `chrome://extensions` for the error. The most common causes:

- Syntax error in `background.js` (open the DevTools service worker console).
- Manifest references a path that doesn't exist (typo in `service_worker` or `default_popup`).

**Popup shows the wrong remaining time briefly when reopened.**

That's the gap before the first `refreshSessionState()` completes. The displayed `--:--` flashes once; ignore. If it persists for more than a second, the message handler in the worker likely errored — check the worker console.

**Tasks added in the popup don't appear in the Tasks tab.**

Both pages subscribe to `chrome.storage.onChanged`. If the listener doesn't fire, the most likely cause is that the Tasks tab is from a previous extension load (after you reloaded at `chrome://extensions`). Close and reopen the Tasks tab.

**`Cannot read properties of undefined (reading 'sendMessage')` in some other extension context.**

The popup uses `chrome.runtime.sendMessage` which only exists inside the extension's contexts. If you opened `popup.html` directly via `file://`, it won't work. Always interact with it through the toolbar button or `chrome-extension://...` URLs.

**Block list overflows beyond ID 1999.**

Each added domain uses one ID, so the reserved range supports 1000 simultaneous blocked sites. If you somehow get there, bump `DNR_RULE_ID_END` and call it a day — or move to a different storage scheme that maps domains to deterministic hashed IDs.
