// Auto-approve ChatGPT GitHub connector permission dialogs when autoApprove is enabled
// and GitHub is present in the connector allowlist.

const GithubDom = globalThis.ApprovalHelperDom;
const GithubStorage = globalThis.ApprovalHelperStorage;
const GithubClicker = globalThis.ApprovalHelperClicker;

const githubHandledDialogs = new WeakSet();
const githubPendingDialogs = new WeakSet();

let githubAutoApprove = false;
let githubConnectorTrusted = true;

function hasTrustedGithubConnector(connectors) {
  if (connectors === undefined) return true;
  if (!Array.isArray(connectors)) return false;
  return connectors.some(connector => String(connector).trim().toLowerCase() === "github");
}

async function refreshGithubSettings() {
  const settings = await GithubStorage.getSettings();
  githubAutoApprove = settings.autoApprove === true;
  githubConnectorTrusted = hasTrustedGithubConnector(settings.trustedConnectors);
}

function isGithubApprovalText(text) {
  if (!text) return false;

  const normalized = GithubDom.normalizeText(text);
  const compact = normalized.replace(/\s+/g, "");

  if (compact.includes("允許chatgpt使用github")) return true;
  if (compact.includes("要允許chatgpt使用github嗎")) return true;
  if (normalized.includes("allow chatgpt to use github")) return true;

  const hasGithub = normalized.includes("github");
  const hasChatGPT = normalized.includes("chatgpt") || normalized.includes("chat gpt");
  const hasPermissionIntent =
    normalized.includes("allow") ||
    normalized.includes("approve") ||
    normalized.includes("authorize") ||
    text.includes("允許") ||
    text.includes("同意") ||
    text.includes("授權");

  return hasGithub && hasChatGPT && hasPermissionIntent;
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
    if (!GithubDom.isElementVisible(dialog)) continue;
    if (isGithubApprovalText(GithubDom.getVisibleText(dialog))) return dialog;
  }

  return null;
}

function isGithubRejectButtonText(text) {
  const normalized = GithubDom.normalizeText(text);
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

function scoreGithubAllowButton(button) {
  const text = GithubDom.getAccessibleText(button);
  if (!text || isGithubRejectButtonText(text)) return 0;

  const normalized = GithubDom.normalizeText(text);

  if (normalized.includes("always allow") || text.includes("一律允許") || text.includes("一律同意")) return 100;
  if (normalized === "allow" || text === "允許") return 90;
  if (normalized === "authorize" || text === "授權") return 80;
  if (normalized.includes("allow") || text.includes("允許")) return 70;
  if (normalized.includes("authorize") || text.includes("授權")) return 60;

  return 0;
}

function findGithubAllowButton(dialog) {
  const buttons = Array.from(dialog.querySelectorAll("button, [role='button']"))
    .filter(GithubDom.isElementVisible)
    .map(button => ({ button, score: scoreGithubAllowButton(button) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return buttons[0]?.button || null;
}

function autoApproveGithubWithRetry(dialog) {
  if (githubPendingDialogs.has(dialog) || githubHandledDialogs.has(dialog)) return;
  githubPendingDialogs.add(dialog);

  GithubClicker.clickWithRetry({
    dialog,
    findButton: findGithubAllowButton,
    isEnabled: GithubDom.isButtonEnabled,
    click: GithubDom.simulateRealClick,
    onSuccess: () => {
      githubHandledDialogs.add(dialog);
      githubPendingDialogs.delete(dialog);
      GithubStorage.logApproval({ toolName: "GitHub", trusted: true });
      console.log("[GitHub Approval Helper] Auto-approving ChatGPT GitHub connector permission.");
    },
    onExhausted: () => githubPendingDialogs.delete(dialog)
  });
}

async function scanGithubApproval() {
  if (!githubAutoApprove || !githubConnectorTrusted) return;

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

GithubStorage.onSettingsChanged(async () => {
  await refreshGithubSettings();
  throttleGithubScan();
});

refreshGithubSettings().then(() => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", throttleGithubScan, { once: true });
  } else {
    throttleGithubScan();
  }
});
