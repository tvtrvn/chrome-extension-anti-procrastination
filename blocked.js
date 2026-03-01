/**
 * Blocked page – show which domain was blocked and link to tasks.
 */

const params = new URLSearchParams(window.location.search);
const domain = params.get("domain") || "this site";

const domainLine = document.getElementById("domain-line");
const btnOpenTasks = document.getElementById("btn-open-tasks");

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

domainLine.textContent = domain;

btnOpenTasks.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL("tasks.html");
});
