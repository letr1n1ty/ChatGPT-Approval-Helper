// Auto-approve ChatGPT GitHub connector permission dialogs when autoApprove is enabled.
// This is intentionally isolated from the MCP approval logic so existing MCP behavior stays unchanged.

const githubApprovedDialogs = new WeakSet();

function getGithubVisibleText(el) {
  return (el?.innerText || el?.textContent || "").trim();
}

function isGithubElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

async function isGithubAutoApproveEnabled() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(["autoApprove"]);
      return data.autoApprove === true;
    }
  } catch (error) {
    console.error("[GitHub Approval Helper] Failed to read autoApprove setting:", error);
  }

  try {
    const fallback = JSON.parse(localStorage.getItem("mcp_approval_settings_fallback_v2") || "{}");
    return fallback.autoApprove === true;
  } catch {
    return false;
  }
}

function isGithubApprovalText(text) {
  if (!text) return false;

  const lower = text.toLowerCase();
  const hasGithub = lower.includes("github");
  const hasChatGPT = lower.includes("chatgpt");
  const hasUseIntent = lower.includes("use") || text.includes("使用");
  const hasAllowIntent =
    lower.includes("allow") ||
    text.includes("允許") ||
    text.includes("同意") ||
    text.includes("授權");

  return hasGithub && hasChatGPT && (hasUseIntent || hasAllowIntent);
}

function findGithubApprovalDialog() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  for (const dialog of dialogs) {
    if (!isGithubElementVisible(dialog)) continue;
    const text = getGithubVisibleText(dialog);
    if (isGithubApprovalText(text)) return dialog;
  }

  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    if (!isGithubElementVisible(button)) continue;

    const buttonText = getGithubVisibleText(button).toLowerCase();
    const isAllowButton =
      buttonText === "allow" ||
      buttonText.includes("allow") ||
      buttonText.includes("允許") ||
      buttonText.includes("同意") ||
      buttonText.includes("授權");

    if (!isAllowButton) continue;

    let parent = button.parentElement;
    let depth = 0;
    while (parent && depth < 8) {
      if (isGithubApprovalText(getGithubVisibleText(parent))) return parent;
      parent = parent.parentElement;
      depth += 1;
    }
  }

  return null;
}

function findGithubAllowButton(dialog) {
  const buttons = Array.from(dialog.querySelectorAll("button")).filter(isGithubElementVisible);

  const priorityMatchers = [
    text => text.includes("always allow") || text.includes("一律允許") || text.includes("一律同意") || text.includes("永遠允許"),
    text => text === "allow" || text === "允許" || text === "同意" || text === "授權",
    text => text.includes("allow") || text.includes("允許") || text.includes("同意") || text.includes("授權")
  ];

  for (const matcher of priorityMatchers) {
    const matched = buttons.find(button => matcher(getGithubVisibleText(button).toLowerCase()));
    if (matched) return matched;
  }

  return null;
}

function isGithubButtonEnabled(button) {
  if (!button) return false;
  if (button.disabled) return false;
  if (button.getAttribute("aria-disabled") === "true") return false;

  const style = window.getComputedStyle(button);
  if (style.pointerEvents === "none") return false;

  return true;
}

function clickGithubButton(button) {
  if (!button) return;

  const rect = button.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };

  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(eventName => {
    button.dispatchEvent(new MouseEvent(eventName, eventInit));
  });

  button.click();
}

function logGithubApproval() {
  const key = "mcpApprovalHelperLog";
  try {
    const oldLog = JSON.parse(localStorage.getItem(key) || "[]");
    oldLog.push({
      toolName: "GitHub",
      trusted: true,
      time: new Date().toISOString(),
      url: location.href
    });
    localStorage.setItem(key, JSON.stringify(oldLog.slice(-200)));
  } catch (error) {
    console.error("[GitHub Approval Helper] Failed to write audit log:", error);
  }
}

async function scanGithubApproval() {
  const autoApprove = await isGithubAutoApproveEnabled();
  if (!autoApprove) return;

  const dialog = findGithubApprovalDialog();
  if (!dialog || githubApprovedDialogs.has(dialog)) return;

  const allowButton = findGithubAllowButton(dialog);
  if (!allowButton || !isGithubButtonEnabled(allowButton)) return;

  githubApprovedDialogs.add(dialog);
  logGithubApproval();
  console.log("[GitHub Approval Helper] Auto-approving ChatGPT GitHub connector permission.");
  clickGithubButton(allowButton);
}

let githubScanPending = false;
function throttleGithubScan() {
  if (githubScanPending) return;
  githubScanPending = true;

  requestAnimationFrame(() => {
    scanGithubApproval().finally(() => {
      githubScanPending = false;
    });
  });
}

const githubObserver = new MutationObserver(throttleGithubScan);
githubObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", throttleGithubScan, { once: true });
} else {
  throttleGithubScan();
}
