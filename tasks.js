/**
 * Full tasks page – live updates via chrome.storage.onChanged.
 */

const tasksList = document.getElementById("tasks-list");
const taskInput = document.getElementById("task-input");
const btnAddTask = document.getElementById("btn-add-task");

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

async function loadTasks() {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  renderTasks(tasks);
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
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.tasks) {
    const next = changes.tasks.newValue ?? [];
    renderTasks(next);
  }
});

btnAddTask.addEventListener("click", addTask);
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTask();
});

loadTasks();
