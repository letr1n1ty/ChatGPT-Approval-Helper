(() => {
  const Dom = globalThis.ApprovalHelperDom;
  const Storage = globalThis.ApprovalHelperStorage;
  const Clicker = globalThis.ApprovalHelperClicker;
  const Defaults = globalThis.ApprovalHelperDefaults;

  if (!Dom || !Storage || !Clicker || !Defaults) {
    console.error("[Approval Helper] Shared helpers are unavailable. Check manifest content script order.");
    return;
  }

  const approvedDialogs = new WeakSet();
  const pendingDialogs = new WeakSet();

  let settings = Defaults.getDefaultSettings();
  let trustedTools = new Set(settings.trustedTools);
  let trustedServers = new Set(settings.trustedServers);

  function refreshDerivedSettings() {
    trustedTools = new Set(settings.trustedTools || []);
    trustedServers = new Set(settings.trustedServers || []);
  }

  async function refreshSettings() {
    settings = await Storage.getSettings();
    refreshDerivedSettings();
  }

  async function saveTrustedValue(key, value) {
    if (!value) return;
    const nextSettings = Defaults.normalizeSettings({
      ...settings,
      [key]: [...new Set([...(settings[key] || []), value])]
    });
    settings = await Storage.saveSettings(nextSettings);
    refreshDerivedSettings();
    scan();
  }

  function isRejectButtonText(text) {
    const normalized = Dom.normalizeText(text);
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
      text.includes("稍后") ||
      text.includes("略過") ||
      text.includes("跳过")
    );
  }

  function scoreApprovalButton(button) {
    const text = Dom.getAccessibleText(button);
    if (!text || isRejectButtonText(text)) return 0;

    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    if (normalized.includes("always allow") || compact.includes("一律允許") || compact.includes("一律允许") || compact.includes("一律同意")) return 120;
    if (normalized === "allow" || compact === "允許" || compact === "允许") return 110;
    if (normalized === "approve" || compact === "核准" || compact === "批准") return 105;
    if (normalized === "authorize" || compact === "授權" || compact === "授权") return 100;
    if (normalized === "run" || compact === "執行" || compact === "执行") return 95;
    if (normalized === "continue" || compact === "繼續" || compact === "继续") return 85;
    if (normalized === "confirm" || compact === "確認" || compact === "确认") return 80;
    if (normalized.includes("allow") || compact.includes("允許") || compact.includes("允许") || compact.includes("同意")) return 75;
    if (normalized.includes("approve") || compact.includes("核准") || compact.includes("批准")) return 72;
    if (normalized.includes("authorize") || compact.includes("授權") || compact.includes("授权")) return 70;
    if (normalized.includes("run") || normalized.includes("execute") || compact.includes("執行") || compact.includes("执行")) return 65;
    if (normalized.includes("continue") || compact.includes("繼續") || compact.includes("继续")) return 55;

    return 0;
  }

  function findApprovalButton(root) {
    const buttons = Dom.queryAllDeep("button, [role='button']", root)
      .filter(Dom.isElementVisible)
      .map(button => ({ button, score: scoreApprovalButton(button) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return buttons[0]?.button || null;
  }

  function hasKnownTrustedName(text) {
    return [...trustedTools, ...trustedServers].some(name => name && text.includes(name));
  }

  function hasApprovalIntent(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      normalized.includes("allow") ||
      normalized.includes("approve") ||
      normalized.includes("authorize") ||
      normalized.includes("permission") ||
      normalized.includes("use") ||
      normalized.includes("run") ||
      normalized.includes("execute") ||
      compact.includes("允許") ||
      compact.includes("允许") ||
      compact.includes("同意") ||
      compact.includes("授權") ||
      compact.includes("授权") ||
      compact.includes("核准") ||
      compact.includes("批准") ||
      compact.includes("使用") ||
      compact.includes("執行") ||
      compact.includes("执行")
    );
  }

  function hasApprovalTargetSignal(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      hasKnownTrustedName(text) ||
      normalized.includes("mcp") ||
      normalized.includes("tool") ||
      normalized.includes("server") ||
      normalized.includes("terminal") ||
      normalized.includes("shell") ||
      normalized.includes("command") ||
      normalized.includes("python") ||
      normalized.includes("node") ||
      normalized.includes("npm") ||
      normalized.includes("git") ||
      compact.includes("工具") ||
      compact.includes("伺服器") ||
      compact.includes("服务器") ||
      compact.includes("終端機") ||
      compact.includes("终端") ||
      compact.includes("命令")
    );
  }

  function isApprovalRoot(root) {
    if (!root || !Dom.isElementVisible(root)) return false;
    const text = Dom.getVisibleText(root);
    if (!text || text.length < 6) return false;
    if (!hasApprovalIntent(text) || !hasApprovalTargetSignal(text)) return false;
    return Boolean(findApprovalButton(root));
  }

  function getDialogCandidates() {
    const explicitCandidates = Dom.queryAllDeep([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[data-testid*="modal" i]',
      '[data-testid*="dialog" i]',
      '[data-radix-dialog-content]',
      '[data-radix-portal]',
      '[popover]'
    ].join(", "));

    const buttonParentCandidates = Dom.queryAllDeep("button, [role='button']")
      .filter(button => scoreApprovalButton(button) > 0)
      .flatMap(button => Dom.getComposedParents(button, 10));

    return Array.from(new Set([...explicitCandidates, ...buttonParentCandidates]))
      .filter(Dom.isElementVisible)
      .sort((a, b) => Dom.getVisibleText(a).length - Dom.getVisibleText(b).length);
  }

  function findApprovalDialog() {
    return getDialogCandidates().find(isApprovalRoot) || null;
  }

  function cleanCandidateName(value) {
    return String(value || "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^[:：\-\s]+|[:：\-\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferTypeFromName(name, text) {
    const normalizedName = Dom.normalizeText(name);
    const normalizedText = Dom.normalizeText(text);

    if (trustedServers.has(name) || normalizedName.includes("mcp") || normalizedText.includes("mcp server")) return "server";
    if (trustedTools.has(name) || name.includes("_")) return "tool";
    return normalizedText.includes("server") || text.includes("伺服器") || text.includes("服务器") ? "server" : "tool";
  }

  function extractNameFromCode(dialog, text) {
    const codeLikeElements = Dom.queryAllDeep("code, kbd, samp, pre, [data-testid*='tool' i], [data-testid*='server' i]", dialog)
      .filter(Dom.isElementVisible)
      .map(Dom.getVisibleText)
      .map(cleanCandidateName)
      .filter(Boolean);

    const codeName = codeLikeElements.find(value =>
      trustedTools.has(value) ||
      trustedServers.has(value) ||
      /^MCP\b/i.test(value) ||
      /^[a-zA-Z_][a-zA-Z0-9_]{2,}$/.test(value)
    );

    if (!codeName) return null;
    return { name: codeName, type: inferTypeFromName(codeName, text) };
  }

  function extractToolName(dialog) {
    const text = Dom.getVisibleText(dialog);

    for (const server of trustedServers) {
      if (server && text.includes(server)) return { name: server, type: "server" };
    }
    for (const tool of trustedTools) {
      if (tool && text.includes(tool)) return { name: tool, type: "tool" };
    }

    const codeMatch = extractNameFromCode(dialog, text);
    if (codeMatch) return codeMatch;

    const patterns = [
      /(?:allow|approve|authorize|use|run|execute)\s+(?:the\s+)?(?:mcp\s+server|server|tool|command)?\s*["'`“”]?([a-zA-Z_][a-zA-Z0-9_\-\s]{2,80})["'`“”]?/i,
      /(?:允許|允许|同意|授權|授权|核准|批准|使用|執行|执行)\s*(?:MCP\s*)?(?:伺服器|服务器|工具|命令)?\s*[「『“”\"'`]?([a-zA-Z_][a-zA-Z0-9_\-\s]{2,80})[」』“”\"'`]?/,
      /\b(MCP\s+[a-zA-Z0-9][a-zA-Z0-9_\-\s]{2,80})\b/,
      /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g
    ];

    for (const pattern of patterns) {
      if (pattern.global) {
        const matches = Array.from(text.matchAll(pattern));
        const token = matches
          .map(match => cleanCandidateName(match[1]))
          .find(value => value.includes("_") && !["read_only", "tool_call", "tool_calls"].includes(value.toLowerCase()));
        if (token) return { name: token, type: "tool" };
        continue;
      }

      const match = text.match(pattern);
      const extracted = cleanCandidateName(match?.[1]);
      if (extracted) return { name: extracted, type: inferTypeFromName(extracted, text) };
    }

    return { name: null, type: "unknown" };
  }

  function escapeHTML(value) {
    return Dom.escapeHTML(value);
  }

  function ensureApprovalHelperStyles() {
    if (document.getElementById("mcp-approval-helper-style")) return;

    const style = document.createElement("style");
    style.id = "mcp-approval-helper-style";
    style.textContent = `
      #mcp-approval-helper-badge {
        position: fixed;
        z-index: 2147483647;
        top: 20px;
        right: 20px;
        width: min(360px, calc(100vw - 32px));
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(122, 162, 247, 0.22);
        background:
          radial-gradient(circle at 0% 0%, rgba(122, 162, 247, 0.16), transparent 42%),
          rgba(31, 35, 53, 0.90);
        color: #c0caf5;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.46), inset 0 1px rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(22px) saturate(1.2);
        -webkit-backdrop-filter: blur(22px) saturate(1.2);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        opacity: 0;
        transform: translateY(-10px) scale(0.98);
        transition: opacity 180ms ease, transform 180ms ease;
        pointer-events: auto;
      }

      #mcp-approval-helper-badge.mcp-helper-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .mcp-helper-card { padding: 14px; }
      .mcp-helper-top { display: flex; align-items: center; gap: 12px; }
      .mcp-helper-icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        border-radius: 12px;
        color: #101014;
        font-size: 17px;
        font-weight: 900;
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.24);
      }
      .mcp-helper-icon.trusted { background: linear-gradient(135deg, #9ece6a, #7dcfff); }
      .mcp-helper-icon.untrusted { background: linear-gradient(135deg, #f7768e, #e0af68); }
      .mcp-helper-title { color: #d5dcff; font-size: 14px; font-weight: 760; letter-spacing: -0.01em; line-height: 1.25; }
      .mcp-helper-subtitle { margin-top: 3px; color: #a9b1d6; font-size: 12px; line-height: 1.38; }
      .mcp-helper-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .mcp-helper-chip {
        display: inline-flex;
        max-width: 100%;
        align-items: center;
        min-height: 30px;
        padding: 6px 10px;
        color: #7dcfff;
        background: rgba(122, 162, 247, 0.13);
        border: 1px solid rgba(122, 162, 247, 0.24);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
      }
      .mcp-helper-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mcp-helper-actions { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(122, 162, 247, 0.12); }
      #mcp-helper-trust-btn {
        width: 100%;
        height: 38px;
        border: 0;
        border-radius: 12px;
        padding: 0 13px;
        color: #101014;
        background: linear-gradient(135deg, #7aa2f7, #7dcfff);
        font: 800 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 10px 22px rgba(122, 162, 247, 0.18);
      }
      #mcp-helper-trust-btn:hover { filter: brightness(1.05); }
    `;
    document.documentElement.appendChild(style);
  }

  function showBadge(dialog, name, type, trusted) {
    ensureApprovalHelperStyles();

    let badge = document.getElementById("mcp-approval-helper-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "mcp-approval-helper-badge";
      document.body.appendChild(badge);
      requestAnimationFrame(() => badge.classList.add("mcp-helper-visible"));
    }

    const typeText = type === "server" ? "MCP Server" : type === "tool" ? "API Tool" : "Approval Item";
    const safeName = escapeHTML(name || "Unknown");
    const title = trusted ? `Trusted ${typeText}` : `Review ${typeText}`;
    const subtitle = trusted
      ? "This item is in your allowlist. Auto-approval can run when enabled."
      : "This item is not in your allowlist. Manual confirmation is required.";
    const icon = trusted ? "✓" : "!";
    const iconClass = trusted ? "trusted" : "untrusted";
    const actionLabel = type === "server" ? "Trust this MCP server" : "Trust this API tool";
    const actionHtml = !trusted && name && type !== "unknown"
      ? `<div class="mcp-helper-actions"><button id="mcp-helper-trust-btn" type="button">${actionLabel}</button></div>`
      : "";

    badge.innerHTML = `
      <div class="mcp-helper-card">
        <div class="mcp-helper-top">
          <div class="mcp-helper-icon ${iconClass}">${icon}</div>
          <div>
            <div class="mcp-helper-title">${title}</div>
            <div class="mcp-helper-subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="mcp-helper-chip-row">
          <div class="mcp-helper-chip"><span>${safeName}</span></div>
        </div>
        ${actionHtml}
      </div>
    `;

    dialog.dataset.mcpApprovalHelperOutline = "true";
    dialog.style.outline = trusted ? "2px solid rgba(158, 206, 106, 0.88)" : "2px solid rgba(247, 118, 142, 0.88)";
    dialog.style.outlineOffset = "3px";
    dialog.style.boxShadow = trusted
      ? "0 0 0 6px rgba(158, 206, 106, 0.12), 0 22px 70px rgba(0, 0, 0, 0.28)"
      : "0 0 0 6px rgba(247, 118, 142, 0.12), 0 22px 70px rgba(0, 0, 0, 0.28)";

    if (!trusted && name && type !== "unknown") {
      setTimeout(() => {
        const trustButton = document.getElementById("mcp-helper-trust-btn");
        if (!trustButton) return;
        trustButton.onclick = async () => {
          await saveTrustedValue(type === "server" ? "trustedServers" : "trustedTools", name);
        };
      }, 0);
    }
  }

  function removeBadgeAndOutline() {
    const badge = document.getElementById("mcp-approval-helper-badge");
    if (badge) {
      badge.classList.remove("mcp-helper-visible");
      setTimeout(() => badge.remove(), 180);
    }

    document.querySelectorAll('[data-mcp-approval-helper-outline="true"]').forEach(el => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.style.boxShadow = "";
      delete el.dataset.mcpApprovalHelperOutline;
    });
  }

  function isTrustedTarget({ name, type }) {
    if (!name) return false;
    if (type === "server") return trustedServers.has(name);
    if (type === "tool") return trustedTools.has(name);
    return false;
  }

  function autoApproveWithRetry(dialog, target) {
    if (pendingDialogs.has(dialog) || approvedDialogs.has(dialog)) return;
    pendingDialogs.add(dialog);

    Clicker.clickWithRetry({
      dialog,
      findButton: findApprovalButton,
      isEnabled: Dom.isButtonEnabled,
      click: Dom.simulateRealClick,
      onClick: (_button, meta) => {
        console.log(`[Approval Helper] Attempting to approve ${target.name} (${meta.index + 1}, ${meta.delay}ms)`);
      },
      onSuccess: () => {
        pendingDialogs.delete(dialog);
        approvedDialogs.add(dialog);
        Storage.logApproval({ toolName: target.name, trusted: true });
        console.log(`[Approval Helper] Approved ${target.name}.`);
      },
      onExhausted: reason => {
        pendingDialogs.delete(dialog);
        console.warn(`[Approval Helper] Approval retry exhausted for ${target.name}: ${reason}`);
      }
    });
  }

  function scan() {
    const dialog = findApprovalDialog();

    if (!dialog) {
      removeBadgeAndOutline();
      return;
    }

    const target = extractToolName(dialog);
    const trusted = isTrustedTarget(target);

    showBadge(dialog, target.name, target.type, trusted);

    if (settings.autoApprove === true && trusted) {
      autoApproveWithRetry(dialog, target);
    }
  }

  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "y")) return;

    const dialog = findApprovalDialog();
    if (!dialog || approvedDialogs.has(dialog)) return;

    const target = extractToolName(dialog);
    const trusted = isTrustedTarget(target);

    if (!trusted) {
      const typeText = target.type === "server" ? "MCP server" : "API tool";
      const confirmApprove = confirm(`Warning: this ${typeText} [${target.name || "Unknown"}] is not in your allowlist.\n\nApprove it manually?`);
      if (!confirmApprove) return;
    }

    const allowButton = findApprovalButton(dialog);
    if (!allowButton) {
      alert("Approval button was not found. Please click it manually.");
      return;
    }

    Storage.logApproval({ toolName: target.name, trusted });
    Dom.simulateRealClick(allowButton);
  });

  let scanPending = false;
  function throttleScan() {
    if (scanPending) return;
    scanPending = true;
    requestAnimationFrame(() => {
      try {
        scan();
      } finally {
        scanPending = false;
      }
    });
  }

  const observer = new MutationObserver(throttleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-disabled", "disabled", "data-state", "data-disabled", "open", "popover"]
  });

  Storage.onSettingsChanged(async () => {
    await refreshSettings();
    throttleScan();
  });

  refreshSettings().then(() => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", throttleScan, { once: true });
    } else {
      throttleScan();
    }
    window.setInterval(throttleScan, 1200);
  });
})();
