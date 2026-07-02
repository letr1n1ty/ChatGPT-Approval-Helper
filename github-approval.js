// Auto-approve ChatGPT GitHub connector permission dialogs when autoApprove is enabled.
// This is intentionally isolated from the MCP approval logic so existing MCP behavior stays unchanged.

const githubHandledDialogs = new WeakSet();
const githubPendingDialogs = new WeakSet();

function getGithubVisibleText(el) {
  return (el?.innerText || el?.textContent || "").trim();
}

function getGithubAccessibleText(el) {
  return [
    getGithubVisibleText(el),
    el?.getAttribute?.("aria-label") || "",
    el?.getAttribute?.("title") || ""
  ].join(" ").trim();
}

function normalizeGithubText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

  const normalized = normalizeGithubText(text);
  const compact = normalized.replace(/\s+/g, "");

  // Exact ChatGPT connector permission prompts observed in zh/English UI.
  if (compact.includes("允許chatgpt使用github")) return true;
  if (compact.includes("要允許chatgpt使用github嗎")) return true;
  if (normalized.includes("allow chatgpt to use github")) return true;

  const hasGithub = normalized.includes("github");
  const hasChatGPT = normalized.includes("chatgpt") || normalized.includes("chat gpt");
  const hasUseIntent =
    normalized.includes("use") ||
    normalized.includes("connect") ||
    normalized.includes("authorize") ||
    text.includes("使用") ||
    text.includes("連接") ||
    text.includes("授權");
  const hasAllowIntent =
    normalized.includes("allow") ||
    normalized.includes("approve") ||
    text.includes("允許") ||
    text.includes("同意") ||
    text.includes("授權");

  return hasGithub && hasChatGPT && (hasUseIntent || hasAllowIntent);
}

function findGithubApprovalDialog() {
  const dialogSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-testid*="modal"]',
    '[data-testid*="dialog"]'
  ].join(", ");

  const dialogs = Array.from(document.querySelectorAll(dialogSelectors));
  for (const dialog of dialogs) {
    if (!isGithubElementVisible(dialog)) continue;
    const text = getGithubVisibleText(dialog);
    if (isGithubApprovalText(text)) return dialog;
  }

  const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
  for (const candidate of candidates) {
    if (!isGithubElementVisible(candidate)) continue;
    if (!isGithubAllowButtonText(getGithubAccessibleText(candidate))) continue;

    let parent = candidate.parentElement;
    let depth = 0;
    while (parent && depth < 10) {
      if (isGithubApprovalText(getGithubVisibleText(parent))) return parent;
      parent = parent.parentElement;
      depth += 1;
    }
  }

  return null;
}

function isGithubRejectButtonText(text) {
  const normalized = normalizeGithubText(text);
  return (
    normalized.includes("cancel") ||
    normalized.includes("dismiss") ||
    normalized.includes("deny") ||
    normalized.includes("not now") ||
    text.includes("取消") ||
    text.includes("拒絕") ||
    text.includes("不要") ||
    text.includes("稍後")
  );
}

function isGithubAllowButtonText(text) {
  if (!text || isGithubRejectButtonText(text)) return false;

  const normalized = normalizeGithubText(text);
  return (
    normalized === "allow" ||
    normalized === "approve" ||
    normalized === "authorize" ||
    normalized === "connect" ||
    normalized === "continue" ||
    normalized.includes("always allow") ||
    normalized.includes("allow") ||
    normalized.includes("approve") ||
    normalized.includes("authorize") ||
    normalized.includes("connect") ||
    text.includes("允許") ||
    text.includes("一律允許") ||
    text.includes("同意") ||
    text.includes("授權") ||
    text.includes("連接") ||
    text.includes("繼續")
  );
}

function scoreGithubAllowButton(button) {
  const text = getGithubAccessibleText(button);
  const normalized = normalizeGithubText(text);

  if (normalized.includes("always allow") || text.includes("一律允許") || text.includes("一律同意")) return 100;
  if (normalized === "allow" || text === "允許") return 90;
  if (normalized === "authorize" || text === "授權") return 80;
  if (normalized === "connect" || text === "連接") return 70;
  if (normalized === "continue" || text === "繼續") return 60;
  if (isGithubAllowButtonText(text)) return 50;
  return 0;
}

function findGithubAllowButton(dialog) {
  const buttons = Array.from(dialog.querySelectorAll("button, [role='button']"))
    .filter(isGithubElementVisible)
    .filter(button => isGithubAllowButtonText(getGithubAccessibleText(button)))
    .sort((a, b) => scoreGithubAllowButton(b) - scoreGithubAllowButton(a));

  return buttons[0] || null;
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

function autoApproveGithubWithRetry(dialog) {
  if (githubPendingDialogs.has(dialog) || githubHandledDialogs.has(dialog)) return;
  githubPendingDialogs.add(dialog);

  const delaySequence = [100, 300, 700, 1200, 2000, 3500, 5500, 8000, 12000, 18000, 25000, 30000];

  delaySequence.forEach((delay, index) => {
    setTimeout(() => {
      if (!document.body.contains(dialog) || githubHandledDialogs.has(dialog)) return;

      const allowButton = findGithubAllowButton(dialog);
      if (!allowButton || !isGithubButtonEnabled(allowButton)) {
        if (index === delaySequence.length - 1) githubPendingDialogs.delete(dialog);
        return;
      }

      githubHandledDialogs.add(dialog);
      githubPendingDialogs.delete(dialog);
      logGithubApproval();
      console.log("[GitHub Approval Helper] Auto-approving ChatGPT GitHub connector permission.");
      clickGithubButton(allowButton);
    }, delay);
  });
}

async function scanGithubApproval() {
  const autoApprove = await isGithubAutoApproveEnabled();
  if (!autoApprove) return;

  const dialog = findGithubApprovalDialog();
  if (!dialog || githubHandledDialogs.has(dialog)) return;

  autoApproveGithubWithRetry(dialog);
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

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.autoApprove) throttleGithubScan();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", throttleGithubScan, { once: true });
} else {
  throttleGithubScan();
}
