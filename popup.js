/**
 * Popup UI: status, timer, session, tasks, blocked sites.
 * Uses chrome.storage + message passing to background.
 */

const timerDisplay = document.getElementById("timer-display");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const btnStart = document.getElementById("btn-start");
const btnEnd = document.getElementById("btn-end");
const customMinutes = document.getElementById("custom-minutes");
const tasksList = document.getElementById("tasks-list");
const taskInput = document.getElementById("task-input");
const btnAddTask = document.getElementById("btn-add-task");
const btnOpenTasks = document.getElementById("btn-open-tasks");
const toggleBlock = document.getElementById("toggle-block");
const siteInput = document.getElementById("site-input");
const btnAddSite = document.getElementById("btn-add-site");
const blockedSitesList = document.getElementById("blocked-sites-list");
const settingOpenCompleteTab = document.getElementById("setting-open-complete-tab");

let refreshInterval = null;

// ---------------------------------------------------------------------------
// Session state (from storage / GET_SESSION_STATE)
// ---------------------------------------------------------------------------

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

function formatRemaining(ms) {
  if (ms <= 0 || !Number.isFinite(ms)) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function refreshSessionState() {
  const res = await sendMessage({ type: "GET_SESSION_STATE" });
  if (!res) return;

  const { sessionActive, remainingMs } = res;

  statusDot.classList.toggle("active", sessionActive);
  statusDot.classList.toggle("inactive", !sessionActive);
  statusDot.setAttribute("aria-hidden", "true");

  if (sessionActive) {
    statusText.textContent = "Session active";
    timerDisplay.textContent = formatRemaining(remainingMs);
    timerDisplay.classList.remove("idle");
    btnStart.disabled = true;
    btnEnd.disabled = false;
    if (!refreshInterval) {
      refreshInterval = setInterval(refreshSessionState, 1000);
    }
  } else {
    statusText.textContent = "Session inactive";
    timerDisplay.textContent = "--:--";
    timerDisplay.classList.add("idle");
    btnStart.disabled = false;
    btnEnd.disabled = true;
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Timer presets & start/end
// ---------------------------------------------------------------------------

function getDurationMinutes() {
  const custom = parseInt(customMinutes.value, 10);
  if (Number.isFinite(custom) && custom >= 1 && custom <= 180) return custom;
  return 25;
}

document.querySelectorAll(".timer-presets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const min = parseInt(btn.dataset.minutes, 10);
    customMinutes.value = min;
  });
});

btnStart.addEventListener("click", async () => {
  const duration = getDurationMinutes();
  await sendMessage({ type: "START_SESSION", durationMinutes: duration });
  await refreshSessionState();
});

btnEnd.addEventListener("click", async () => {
  await sendMessage({ type: "END_SESSION" });
  await refreshSessionState();
});

// ---------------------------------------------------------------------------
// Tasks (chrome.storage.local)
// ---------------------------------------------------------------------------

async function loadTasks() {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  renderTasks(tasks);
}

function renderTasks(tasks) {
  tasksList.innerHTML = "";
  tasks.forEach((task) => {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!task.done;
    cb.setAttribute("aria-label", `Mark "${task.text}" as done`);
    cb.addEventListener("change", () => toggleTask(task.id));

    const span = document.createElement("span");
    span.className = "task-text" + (task.done ? " done" : "");
    span.textContent = task.text;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "remove-task";
    rm.textContent = "Remove";
    rm.setAttribute("aria-label", `Remove task "${task.text}"`);
    rm.addEventListener("click", () => removeTask(task.id));

    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(rm);
    tasksList.appendChild(li);
  });
}

async function toggleTask(id) {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const next = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  await chrome.storage.local.set({ tasks: next });
}

async function removeTask(id) {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const next = tasks.filter((t) => t.id !== id);
  await chrome.storage.local.set({ tasks: next });
}

async function addTask() {
  const text = taskInput.value.trim();
  if (!text) return;
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const id = "t_" + Date.now();
  await chrome.storage.local.set({ tasks: [...tasks, { id, text, done: false }] });
  taskInput.value = "";
  await loadTasks();
}

btnAddTask.addEventListener("click", addTask);
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTask();
});

btnOpenTasks.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("tasks.html") });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.tasks) loadTasks();
});

// ---------------------------------------------------------------------------
// Blocked sites
// ---------------------------------------------------------------------------

async function loadBlockedSites() {
  const res = await sendMessage({ type: "GET_BLOCKED_SITES" });
  if (!res) return;
  toggleBlock.classList.toggle("on", res.blockEnabled);
  toggleBlock.setAttribute("aria-checked", String(res.blockEnabled));
  blockedSitesList.innerHTML = "";
  (res.blockedSites || []).forEach((domain) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(domain)}</span><button type="button" class="btn btn-ghost btn-remove-site" data-domain="${escapeHtml(domain)}">Remove</button>`;
    li.querySelector(".btn-remove-site").addEventListener("click", () => removeBlockedSite(domain));
    blockedSitesList.appendChild(li);
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function addBlockedSite() {
  const raw = siteInput.value.trim();
  if (!raw) return;
  const res = await sendMessage({ type: "ADD_BLOCKED_SITE", domain: raw });
  if (res?.ok) {
    siteInput.value = "";
    await loadBlockedSites();
  }
}

async function removeBlockedSite(domain) {
  await sendMessage({ type: "REMOVE_BLOCKED_SITE", domain });
  await loadBlockedSites();
}

btnAddSite.addEventListener("click", addBlockedSite);
siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBlockedSite();
});

toggleBlock.addEventListener("click", async () => {
  const enabled = !toggleBlock.classList.contains("on");
  await sendMessage({ type: "SET_BLOCK_ENABLED", enabled });
  toggleBlock.classList.toggle("on", enabled);
  toggleBlock.setAttribute("aria-checked", String(enabled));
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (res?.settings) {
    settingOpenCompleteTab.checked = !!res.settings.openCompleteTab;
  }
}

settingOpenCompleteTab.addEventListener("change", async () => {
  await sendMessage({ type: "SET_SETTINGS", settings: { openCompleteTab: settingOpenCompleteTab.checked } });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  await refreshSessionState();
  await loadTasks();
  await loadBlockedSites();
  await loadSettings();
}

init();
