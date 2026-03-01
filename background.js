/**
 * Anti-Procrastination Session - Service Worker (Manifest V3)
 * Handles: idle nudge, timer (alarms), site blocking (DNR), session state.
 */

const NUDGE_URL = "https://careers.mcdonalds.ca/";
const NUDGE_COOLDOWN_MS = 60 * 1000;       // 60 seconds between nudges (1 nudge per idle only)
const MAX_SESSION_MINUTES = 180;            // 3 hours max; user must start a new session to continue
const IDLE_DETECTION_INTERVAL = 120;       // seconds
const TIMER_ALARM_NAME = "sessionTimer";
const TIMER_TICK_SECONDS = 10;

const DNR_RULE_ID_BASE = 1000;
const DNR_RULE_ID_END = 1999;  // inclusive; range 1000..1999 for block rules

// ---------------------------------------------------------------------------
// Storage defaults & helpers
// ---------------------------------------------------------------------------

async function getStorage() {
  const o = await chrome.storage.local.get([
    "sessionActive", "sessionEndAt", "lastNudgeAt",
    "nudgedThisIdlePeriod", "nudgeTabId", "blockedSites", "blockEnabled",
    "tasks", "settings"
  ]);
  return {
    sessionActive: o.sessionActive ?? false,
    sessionEndAt: o.sessionEndAt ?? 0,
    lastNudgeAt: o.lastNudgeAt ?? 0,
    nudgedThisIdlePeriod: o.nudgedThisIdlePeriod ?? false,
    nudgeTabId: o.nudgeTabId ?? null,
    blockedSites: Array.isArray(o.blockedSites) ? o.blockedSites : [],
    blockEnabled: o.blockEnabled !== false,
    tasks: Array.isArray(o.tasks) ? o.tasks : [],
    settings: { openCompleteTab: false, ...o.settings }
  };
}

async function setStorage(updates) {
  await chrome.storage.local.set(updates);
}

// ---------------------------------------------------------------------------
// Idle & Nudge
// ---------------------------------------------------------------------------

function initIdleDetection() {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL);
}

async function maybeOpenNudgeTab() {
  const now = Date.now();
  const s = await getStorage();

  if (!s.sessionActive) return;
  if (s.nudgedThisIdlePeriod) return;
  if (now - s.lastNudgeAt < NUDGE_COOLDOWN_MS) return;

  // If we have a nudge tab, try to focus it (or clear if closed)
  if (s.nudgeTabId != null) {
    try {
      const tab = await chrome.tabs.get(s.nudgeTabId);
      if (tab?.id) {
        await chrome.tabs.update(s.nudgeTabId, { active: true });
        await setStorage({
          nudgedThisIdlePeriod: true,
          lastNudgeAt: now
        });
        return;
      }
    } catch (_) {
      // Tab was closed
      await setStorage({ nudgeTabId: null });
    }
  }

  const tab = await chrome.tabs.create({ url: NUDGE_URL, active: true });
  await setStorage({
    lastNudgeAt: now,
    nudgedThisIdlePeriod: true,
    nudgeTabId: tab.id
  });
}

function onIdleStateChange(newState) {
  if (newState === "active") {
    setStorage({ nudgedThisIdlePeriod: false });
    return;
  }
  if (newState === "idle" || newState === "locked") {
    maybeOpenNudgeTab();
  }
}

// Only listen to idle when session is active (we register once and check sessionActive inside handler)
chrome.idle.onStateChanged.addListener(onIdleStateChange);

// ---------------------------------------------------------------------------
// Declarative Net Request - block sites during session (block only, no redirect)
// ---------------------------------------------------------------------------

function getAllBlockRuleIds() {
  const ids = [];
  for (let id = DNR_RULE_ID_BASE; id <= DNR_RULE_ID_END; id++) ids.push(id);
  return ids;
}

/** Normalize domain: strip protocol, path, and optional www. */
function normalizeDomain(input) {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").split("/")[0];
  if (s.startsWith("www.")) s = s.slice(4);
  return s.replace(/^\./, "") || null;
}

/** Remove all dynamic block rules in range 1000..1999. */
async function clearRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: getAllBlockRuleIds()
  });
}

/**
 * Apply blocking from storage: if session inactive or block disabled, clear rules.
 * Otherwise remove rules 1000..1999 and add one block rule per blockedSites[i] with id = 1000 + i.
 */
async function applyBlockingRules() {
  const s = await getStorage();
  if (!s.sessionActive || !s.blockEnabled) {
    await clearRules();
    return;
  }

  const removeRuleIds = getAllBlockRuleIds();
  const addRules = s.blockedSites.map((domain, i) => ({
    id: DNR_RULE_ID_BASE + i,
    priority: 1,
    action: { type: "block" },
    condition: {
      requestDomains: [domain],
      resourceTypes: ["main_frame"]
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

// ---------------------------------------------------------------------------
// Timer (alarms)
// ---------------------------------------------------------------------------

async function onTimerAlarm() {
  const s = await getStorage();
  if (!s.sessionActive || !s.sessionEndAt) return;

  const now = Date.now();
  if (now >= s.sessionEndAt) {
    await endSession(true);
    return;
  }

  // Reschedule next tick
  const remainingMs = s.sessionEndAt - now;
  const tickMs = Math.min(TIMER_TICK_SECONDS * 1000, remainingMs);
  chrome.alarms.create(TIMER_ALARM_NAME, { when: Date.now() + tickMs });
}

async function startTimer(durationMinutes) {
  const sessionEndAt = Date.now() + durationMinutes * 60 * 1000;
  await setStorage({
    sessionActive: true,
    sessionEndAt,
    lastNudgeAt: 0,
    nudgedThisIdlePeriod: false,
    nudgeTabId: null
  });
  initIdleDetection();
  await applyBlockingRules();
  chrome.alarms.create(TIMER_ALARM_NAME, { when: Date.now() + TIMER_TICK_SECONDS * 1000 });
}

async function endSession(timerExpired = false) {
  await setStorage({
    sessionActive: false,
    sessionEndAt: 0,
    nudgedThisIdlePeriod: false
  });
  chrome.alarms.clear(TIMER_ALARM_NAME);
  await applyBlockingRules();

  if (timerExpired) {
    const s = await getStorage();
    if (s.settings?.openCompleteTab) {
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#complete") });
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMER_ALARM_NAME) onTimerAlarm();
});

// ---------------------------------------------------------------------------
// Session start: refresh rules when block list or blockEnabled changes
// ---------------------------------------------------------------------------

async function onStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  if (changes.sessionActive || changes.blockEnabled || changes.blockedSites) {
    await applyBlockingRules();
  }
}

chrome.storage.onChanged.addListener(onStorageChange);

// ---------------------------------------------------------------------------
// Tab closed: clear nudgeTabId
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  getStorage().then((s) => {
    if (s.nudgeTabId === tabId) {
      setStorage({ nudgeTabId: null });
    }
  });
});

// ---------------------------------------------------------------------------
// Message handling (popup <-> background)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case "START_SESSION": {
        const durationMinutes = Math.min(MAX_SESSION_MINUTES, Math.max(1, message.durationMinutes || 25));
        await startTimer(durationMinutes);
        return { ok: true };
      }
      case "END_SESSION": {
        await endSession(false);
        return { ok: true };
      }
      case "GET_SESSION_STATE": {
        const s = await getStorage();
        const now = Date.now();
        let remainingMs = 0;
        if (s.sessionActive && s.sessionEndAt > now) {
          remainingMs = s.sessionEndAt - now;
        }
        return {
          sessionActive: s.sessionActive,
          sessionEndAt: s.sessionEndAt,
          remainingMs
        };
      }
      case "ADD_BLOCKED_SITE": {
        const raw = (message.domain || "").trim().toLowerCase();
        const domain = normalizeDomain(raw);
        if (!domain) return { ok: false, error: "Invalid domain" };
        const s = await getStorage();
        if (s.blockedSites.includes(domain)) return { ok: true };
        const blockedSites = [...s.blockedSites, domain];
        await setStorage({ blockedSites });
        await applyBlockingRules();
        return { ok: true, blockedSites };
      }
      case "REMOVE_BLOCKED_SITE": {
        const domain = message.domain;
        const s = await getStorage();
        const blockedSites = s.blockedSites.filter((d) => d !== domain);
        await setStorage({ blockedSites });
        await applyBlockingRules();
        return { ok: true, blockedSites };
      }
      case "GET_BLOCKED_SITES": {
        const s = await getStorage();
        return { blockedSites: s.blockedSites, blockEnabled: s.blockEnabled };
      }
      case "SET_BLOCK_ENABLED": {
        await setStorage({ blockEnabled: !!message.enabled });
        await applyBlockingRules();
        return { ok: true };
      }
      case "GET_SETTINGS": {
        const s = await getStorage();
        return { settings: s.settings };
      }
      case "SET_SETTINGS": {
        await setStorage({ settings: { ...(await getStorage()).settings, ...message.settings } });
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown message type" };
    }
  };
  handler().then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

// Startup: ensure idle interval and rules are in sync with storage
chrome.runtime.onStartup.addListener(async () => {
  initIdleDetection();
  await applyBlockingRules();
});
