// Auto-approve ChatGPT GitHub connector permission dialogs when autoApprove is enabled
// and GitHub is present in the connector allowlist.
(() => {
  const GithubDom = globalThis.ApprovalHelperDom;
  const GithubStorage = globalThis.ApprovalHelperStorage;
  const GithubClicker = globalThis.ApprovalHelperClicker;

  if (!GithubDom || !GithubStorage || !GithubClicker) {
    console.error("[GitHub Approval Helper] Shared helpers are unavailable. Check manifest content script order.");
    return;
  }

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

  function hasGithubApprovalIntent(text) {
    const normalized = GithubDom.normalizeText(text);
    const compact = GithubDom.compactText(text);

    return (
      normalized.includes("allow") ||
      normalized.includes("approve") ||
      normalized.includes("authorize") ||
      normalized.includes("connect") ||
      normalized.includes("permission") ||
      normalized.includes("access") ||
      normalized.includes("use github") ||
      compact.includes("允許") ||
      compact.includes("允许") ||
      compact.includes("同意") ||
      compact.includes("授權") ||
      compact.includes("授权") ||
      compact.includes("核准") ||
      compact.includes("批准") ||
      compact.includes("連接") ||
      compact.includes("连接") ||
      compact.includes("存取") ||
      compact.includes("使用github")
    );
  }

  function isGithubApprovalText(text) {
    if (!text) return false;

    const normalized = GithubDom.normalizeText(text);
    const compact = GithubDom.compactText(text);
    const hasGithub = normalized.includes("github");
    if (!hasGithub) return false;

    if (compact.includes("允許chatgpt使用github")) return true;
    if (compact.includes("允许chatgpt使用github")) return true;
    if (compact.includes("要允許chatgpt使用github嗎")) return true;
    if (compact.includes("要允许chatgpt使用github吗")) return true;
    if (normalized.includes("allow chatgpt to use github")) return true;
    if (normalized.includes("connect github")) return true;
    if (normalized.includes("authorize github")) return true;

    const hasChatGPT = normalized.includes("chatgpt") || normalized.includes("chat gpt") || normalized.includes("connector") || normalized.includes("app");
    return hasGithub && hasGithubApprovalIntent(text) && hasChatGPT;
  }

  function isGithubRejectButtonText(text) {
    const normalized = GithubDom.normalizeText(text);
    return (
      normalized.includes("cancel") ||
      normalized.includes("dismiss") ||
      normalized.includes("deny") ||
      normalized.includes("reject") ||
      normalized.includes("not now") ||
      normalized === "no" ||
      text.includes("取消") ||
      text.includes("拒絕") ||
      text.includes("拒绝") ||
      text.includes("不要") ||
      text.includes("稍後") ||
      text.includes("稍后")
    );
  }

  function scoreGithubAllowButton(button) {
    const text = GithubDom.getAccessibleText(button);
    if (!text || isGithubRejectButtonText(text)) return 0;

    const normalized = GithubDom.normalizeText(text);
    const compact = GithubDom.compactText(text);

    if (normalized.includes("always allow") || compact.includes("一律允許") || compact.includes("一律允许") || compact.includes("一律同意")) return 130;
    if (normalized === "allow" || compact === "允許" || compact === "允许") return 120;
    if (normalized === "authorize" || compact === "授權" || compact === "授权") return 115;
    if (normalized === "connect" || compact === "連接" || compact === "连接") return 110;
    if (normalized === "approve" || compact === "核准" || compact === "批准") return 105;
    if (normalized === "continue" || compact === "繼續" || compact === "继续") return 80;
    if (normalized === "confirm" || compact === "確認" || compact === "确认") return 75;
    if (normalized.includes("allow") || compact.includes("允許") || compact.includes("允许") || compact.includes("同意")) return 70;
    if (normalized.includes("authorize") || compact.includes("授權") || compact.includes("授权")) return 68;
    if (normalized.includes("connect") || compact.includes("連接") || compact.includes("连接")) return 66;
    if (normalized.includes("approve") || compact.includes("核准") || compact.includes("批准")) return 64;
    if (normalized.includes("continue") || compact.includes("繼續") || compact.includes("继续")) return 50;

    return 0;
  }

  function findGithubAllowButton(dialog) {
    const buttons = GithubDom.queryAllDeep("button, [role='button']", dialog)
      .filter(GithubDom.isElementVisible)
      .map(button => ({ button, score: scoreGithubAllowButton(button) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return buttons[0]?.button || null;
  }

  function isGithubApprovalRoot(root) {
    if (!root || !GithubDom.isElementVisible(root)) return false;
    if (!isGithubApprovalText(GithubDom.getVisibleText(root))) return false;
    return Boolean(findGithubAllowButton(root));
  }

  function getGithubDialogCandidates() {
    const explicitCandidates = GithubDom.queryAllDeep([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[data-testid*="modal" i]',
      '[data-testid*="dialog" i]',
      '[data-radix-dialog-content]',
      '[data-radix-portal]',
      '[popover]'
    ].join(", "));

    const buttonParentCandidates = GithubDom.queryAllDeep("button, [role='button']")
      .filter(button => scoreGithubAllowButton(button) > 0)
      .flatMap(button => GithubDom.getComposedParents(button, 10));

    return Array.from(new Set([...explicitCandidates, ...buttonParentCandidates]))
      .filter(GithubDom.isElementVisible)
      .sort((a, b) => GithubDom.getVisibleText(a).length - GithubDom.getVisibleText(b).length);
  }

  function findGithubApprovalDialog() {
    return getGithubDialogCandidates().find(isGithubApprovalRoot) || null;
  }

  function autoApproveGithubWithRetry(dialog) {
    if (githubPendingDialogs.has(dialog) || githubHandledDialogs.has(dialog)) return;
    githubPendingDialogs.add(dialog);

    GithubClicker.clickWithRetry({
      dialog,
      findButton: findGithubAllowButton,
      isEnabled: GithubDom.isButtonEnabled,
      click: GithubDom.simulateRealClick,
      onClick: (_button, meta) => {
        console.log(`[GitHub Approval Helper] Attempting GitHub connector approval (${meta.index + 1}, ${meta.delay}ms).`);
      },
      onSuccess: () => {
        githubHandledDialogs.add(dialog);
        githubPendingDialogs.delete(dialog);
        GithubStorage.logApproval({ toolName: "GitHub", trusted: true });
        console.log("[GitHub Approval Helper] Approved ChatGPT GitHub connector permission.");
      },
      onExhausted: reason => {
        githubPendingDialogs.delete(dialog);
        console.warn(`[GitHub Approval Helper] GitHub connector approval retry exhausted: ${reason}`);
      }
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
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-disabled", "disabled", "data-state", "data-disabled", "open", "popover"]
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
    window.setInterval(throttleGithubScan, 1200);
  });
})();
