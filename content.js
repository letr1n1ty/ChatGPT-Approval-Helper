(() => {
  const Dom = globalThis.ApprovalHelperDom;
  const Storage = globalThis.ApprovalHelperStorage;
  const Clicker = globalThis.ApprovalHelperClicker;
  const Defaults = globalThis.ApprovalHelperDefaults;

  if (!Dom || !Storage || !Clicker || !Defaults) {
    console.error("[Approval Helper] Shared helpers are unavailable. Check manifest content script order.");
    return;
  }

  const APPROVAL_KIND = Object.freeze({
    CONNECTOR: "connector",
    SERVER: "server",
    TOOL: "tool",
    UNKNOWN: "unknown"
  });

  const KNOWN_CONNECTORS = Object.freeze([
    { name: "GitHub", aliases: ["github"] },
    { name: "Google Drive", aliases: ["google drive", "googledrive", "drive"] },
    { name: "Gmail", aliases: ["gmail", "google mail"] },
    { name: "Google Calendar", aliases: ["google calendar", "calendar"] },
    { name: "Notion", aliases: ["notion"] },
    { name: "Slack", aliases: ["slack"] },
    { name: "Dropbox", aliases: ["dropbox"] },
    { name: "Microsoft OneDrive", aliases: ["microsoft onedrive", "onedrive", "one drive"] }
  ]);

  const DISALLOWED_APP_CHROME_SELECTORS = [
    "nav",
    "aside",
    "[data-testid*='sidebar' i]",
    "[data-testid*='history' i]",
    "[data-testid*='conversation-list' i]",
    "[data-testid*='nav' i]",
    "[aria-label*='sidebar' i]",
    "[aria-label*='history' i]",
    "[aria-label*='chat history' i]",
    "[aria-label*='conversation history' i]"
  ].join(", ");

  const SEMANTIC_APPROVAL_SURFACE_SELECTORS = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-testid*="modal" i]',
    '[data-testid*="dialog" i]',
    '[data-radix-dialog-content]',
    '[data-radix-portal]',
    '[popover]'
  ].join(", ");

  const handledApprovals = new WeakSet();
  const pendingApprovals = new WeakSet();

  let settings = Defaults.getDefaultSettings();
  let trustedTools = new Set(settings.trustedTools);
  let trustedServers = new Set(settings.trustedServers);
  let trustedConnectors = new Set(settings.trustedConnectors);

  function normalizeForCompare(value) {
    return Dom.normalizeText(value).replace(/[^a-z0-9]+/g, "");
  }

  function refreshDerivedSettings() {
    trustedTools = new Set(settings.trustedTools || []);
    trustedServers = new Set(settings.trustedServers || []);
    trustedConnectors = new Set(settings.trustedConnectors || []);
  }

  async function refreshSettings() {
    settings = await Storage.getSettings();
    refreshDerivedSettings();
  }

  async function saveTrustedValue(kind, value) {
    if (!value || kind === APPROVAL_KIND.UNKNOWN) return;

    const keyByKind = {
      [APPROVAL_KIND.CONNECTOR]: "trustedConnectors",
      [APPROVAL_KIND.SERVER]: "trustedServers",
      [APPROVAL_KIND.TOOL]: "trustedTools"
    };
    const key = keyByKind[kind];
    if (!key) return;

    const existing = settings[key] || [];
    const existingNormalized = new Set(existing.map(normalizeForCompare));
    const nextValues = existingNormalized.has(normalizeForCompare(value))
      ? existing
      : [...existing, value];

    const nextSettings = Defaults.normalizeSettings({
      ...settings,
      [key]: nextValues
    });

    settings = await Storage.saveSettings(nextSettings);
    refreshDerivedSettings();
    scheduleScan();
  }

  function safeMatches(el, selector) {
    try {
      return Boolean(el?.matches?.(selector));
    } catch (_) {
      return false;
    }
  }

  function safeClosest(el, selector) {
    try {
      return el?.closest?.(selector) || null;
    } catch (_) {
      return null;
    }
  }

  function isInsideAppChrome(el) {
    return Boolean(safeClosest(el, DISALLOWED_APP_CHROME_SELECTORS));
  }

  function isSemanticApprovalSurface(el) {
    return safeMatches(el, SEMANTIC_APPROVAL_SURFACE_SELECTORS) || Boolean(safeClosest(el, SEMANTIC_APPROVAL_SURFACE_SELECTORS));
  }

  function isInsideConversationSurface(el) {
    const main = safeClosest(el, "main, [role='main']");
    if (!main) return false;
    if (isInsideAppChrome(el)) return false;
    return true;
  }

  function isAllowedScanRegion(el) {
    if (!el || isInsideAppChrome(el)) return false;
    return isSemanticApprovalSurface(el) || isInsideConversationSurface(el);
  }

  function textContainsName(text, name) {
    if (!text || !name) return false;
    const normalizedText = Dom.normalizeText(text);
    const normalizedName = Dom.normalizeText(name);
    return normalizedText.includes(normalizedName);
  }

  function textContainsNameLoose(text, name) {
    if (!text || !name) return false;
    return normalizeForCompare(text).includes(normalizeForCompare(name));
  }

  function hasTrustedValue(collection, value, { loose = false } = {}) {
    if (!value) return false;
    if (!loose) return collection.has(value);

    const normalizedValue = normalizeForCompare(value);
    return Array.from(collection).some(item => normalizeForCompare(item) === normalizedValue);
  }

  function isRejectButtonText(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      normalized.includes("cancel") ||
      normalized.includes("dismiss") ||
      normalized.includes("deny") ||
      normalized.includes("reject") ||
      normalized.includes("not now") ||
      normalized === "no" ||
      compact.includes("取消") ||
      compact.includes("拒絕") ||
      compact.includes("拒绝") ||
      compact.includes("不要") ||
      compact.includes("稍後") ||
      compact.includes("稍后") ||
      compact.includes("略過") ||
      compact.includes("跳过")
    );
  }

  function scoreApprovalButton(button) {
    if (!isAllowedScanRegion(button)) return 0;

    const text = Dom.getAccessibleText(button);
    if (!text || isRejectButtonText(text)) return 0;

    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    if (normalized.includes("always allow") || compact.includes("一律允許") || compact.includes("一律允许") || compact.includes("一律同意")) return 130;
    if (normalized === "allow" || compact === "允許" || compact === "允许") return 120;
    if (normalized === "approve" || compact === "核准" || compact === "批准") return 115;
    if (normalized === "authorize" || compact === "授權" || compact === "授权") return 110;
    if (normalized === "connect" || compact === "連接" || compact === "连接") return 105;
    if (normalized === "run" || compact === "執行" || compact === "执行") return 100;
    if (normalized === "continue" || compact === "繼續" || compact === "继续") return 85;
    if (normalized === "confirm" || compact === "確認" || compact === "确认") return 80;
    if (normalized.includes("allow") || compact.includes("允許") || compact.includes("允许") || compact.includes("同意")) return 75;
    if (normalized.includes("approve") || compact.includes("核准") || compact.includes("批准")) return 72;
    if (normalized.includes("authorize") || compact.includes("授權") || compact.includes("授权")) return 70;
    if (normalized.includes("connect") || compact.includes("連接") || compact.includes("连接")) return 68;
    if (normalized.includes("run") || normalized.includes("execute") || compact.includes("執行") || compact.includes("执行")) return 65;
    if (normalized.includes("continue") || compact.includes("繼續") || compact.includes("继续")) return 52;

    return 0;
  }

  function findApprovalButton(root) {
    const buttons = Dom.queryAllDeep("button, [role='button']", root)
      .filter(button => Dom.isElementVisible(button) && isAllowedScanRegion(button))
      .map(button => ({ button, score: scoreApprovalButton(button) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return buttons[0]?.button || null;
  }

  function hasApprovalIntent(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      normalized.includes("allow") ||
      normalized.includes("approve") ||
      normalized.includes("authorize") ||
      normalized.includes("connect") ||
      normalized.includes("permission") ||
      normalized.includes("access") ||
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
      compact.includes("連接") ||
      compact.includes("连接") ||
      compact.includes("存取") ||
      compact.includes("使用") ||
      compact.includes("執行") ||
      compact.includes("执行")
    );
  }

  function hasCommandLikeSignal(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      /\b[a-zA-Z_][a-zA-Z0-9_]*_[a-zA-Z0-9_]+\b/.test(text) ||
      /\bgit\s+(status|diff|commit|push|pull|checkout|branch|log|show|add|reset|restore)\b/i.test(text) ||
      normalized.includes("terminal") ||
      normalized.includes("shell") ||
      normalized.includes("command") ||
      normalized.includes("python") ||
      normalized.includes("node") ||
      normalized.includes("npm") ||
      compact.includes("終端機") ||
      compact.includes("终端") ||
      compact.includes("命令")
    );
  }

  function getMatchedConnector(text) {
    const configuredConnectors = Array.from(trustedConnectors).map(name => ({ name, aliases: [name] }));
    const candidates = [...configuredConnectors, ...KNOWN_CONNECTORS];
    const seen = new Set();

    for (const connector of candidates) {
      const normalizedName = normalizeForCompare(connector.name);
      if (!normalizedName || seen.has(normalizedName)) continue;
      seen.add(normalizedName);

      const aliases = [connector.name, ...(connector.aliases || [])];
      if (aliases.some(alias => textContainsNameLoose(text, alias))) {
        return connector.name;
      }
    }

    return null;
  }

  function hasConnectorIntent(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      normalized.includes("connector") ||
      normalized.includes("connect") ||
      normalized.includes("authorize") ||
      normalized.includes("allow") ||
      normalized.includes("permission") ||
      normalized.includes("access") ||
      normalized.includes("use") ||
      compact.includes("連接") ||
      compact.includes("连接") ||
      compact.includes("授權") ||
      compact.includes("授权") ||
      compact.includes("允許") ||
      compact.includes("允许") ||
      compact.includes("權限") ||
      compact.includes("权限") ||
      compact.includes("存取") ||
      compact.includes("使用")
    );
  }

  function hasTargetSignal(text) {
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    return (
      Boolean(getMatchedConnector(text)) ||
      Array.from(trustedServers).some(name => textContainsName(text, name)) ||
      Array.from(trustedTools).some(name => textContainsName(text, name)) ||
      normalized.includes("mcp") ||
      normalized.includes("tool") ||
      normalized.includes("server") ||
      hasCommandLikeSignal(text) ||
      compact.includes("工具") ||
      compact.includes("伺服器") ||
      compact.includes("服务器")
    );
  }

  function isApprovalCandidate(root) {
    if (!root || !Dom.isElementVisible(root) || !isAllowedScanRegion(root)) return false;

    const text = Dom.getVisibleText(root);
    if (!text || text.length < 4) return false;
    if (!hasApprovalIntent(text) || !hasTargetSignal(text)) return false;

    return Boolean(findApprovalButton(root));
  }

  function getApprovalCandidates() {
    const explicitCandidates = Dom.queryAllDeep(SEMANTIC_APPROVAL_SURFACE_SELECTORS)
      .filter(candidate => isAllowedScanRegion(candidate));

    const buttonParentCandidates = Dom.queryAllDeep("button, [role='button']")
      .filter(button => Dom.isElementVisible(button) && scoreApprovalButton(button) > 0)
      .flatMap(button => Dom.getComposedParents(button, 10))
      .filter(parent => isAllowedScanRegion(parent));

    return Array.from(new Set([...explicitCandidates, ...buttonParentCandidates]))
      .filter(isApprovalCandidate)
      .sort((a, b) => Dom.getVisibleText(a).length - Dom.getVisibleText(b).length);
  }

  function cleanCandidateName(value) {
    return String(value || "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^[:：\-\s]+|[:：\-\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractCodeLikeName(root, text) {
    const codeLikeElements = Dom.queryAllDeep([
      "code",
      "kbd",
      "samp",
      "pre",
      "[data-testid*='tool' i]",
      "[data-testid*='server' i]",
      "[data-testid*='command' i]"
    ].join(", "), root)
      .filter(element => Dom.isElementVisible(element) && isAllowedScanRegion(element))
      .map(Dom.getVisibleText)
      .map(cleanCandidateName)
      .filter(Boolean);

    return codeLikeElements.find(value =>
      Array.from(trustedTools).some(name => name === value) ||
      Array.from(trustedServers).some(name => name === value) ||
      /^MCP\b/i.test(value) ||
      /^[a-zA-Z_][a-zA-Z0-9_]{2,}$/.test(value) ||
      /^git\s+(status|diff|commit|push|pull|checkout|branch|log|show|add|reset|restore)$/i.test(value)
    ) || null;
  }

  function detectConnector(root) {
    const text = Dom.getVisibleText(root);
    const connectorName = getMatchedConnector(text);
    if (!connectorName || !hasConnectorIntent(text)) return null;

    return {
      kind: APPROVAL_KIND.CONNECTOR,
      name: connectorName,
      title: "Connector",
      policyKey: "trustedConnectors",
      button: findApprovalButton(root),
      root
    };
  }

  function detectMcpServer(root) {
    const text = Dom.getVisibleText(root);
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    const explicitServer = Array.from(trustedServers).find(name => textContainsName(text, name));
    if (explicitServer) {
      return {
        kind: APPROVAL_KIND.SERVER,
        name: explicitServer,
        title: "MCP Server",
        policyKey: "trustedServers",
        button: findApprovalButton(root),
        root
      };
    }

    const hasServerSignal = normalized.includes("mcp") || normalized.includes("server") || compact.includes("伺服器") || compact.includes("服务器");
    if (!hasServerSignal) return null;

    const codeLikeName = extractCodeLikeName(root, text);
    if (codeLikeName && /^MCP\b/i.test(codeLikeName)) {
      return {
        kind: APPROVAL_KIND.SERVER,
        name: codeLikeName,
        title: "MCP Server",
        policyKey: "trustedServers",
        button: findApprovalButton(root),
        root
      };
    }

    const patterns = [
      /\b(MCP\s+[a-zA-Z0-9][a-zA-Z0-9_\-\s]{2,80})\b/,
      /(?:mcp\s+server|server)\s*["'`“”]?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{2,80})["'`“”]?/i,
      /(?:MCP\s*)?(?:伺服器|服务器)\s*[「『“”\"'`]?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{2,80})[」』“”\"'`]?/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const name = cleanCandidateName(match?.[1]);
      if (name) {
        return {
          kind: APPROVAL_KIND.SERVER,
          name,
          title: "MCP Server",
          policyKey: "trustedServers",
          button: findApprovalButton(root),
          root
        };
      }
    }

    return null;
  }

  function detectApiTool(root) {
    const text = Dom.getVisibleText(root);
    const normalized = Dom.normalizeText(text);
    const compact = Dom.compactText(text);

    const explicitTool = Array.from(trustedTools).find(name => textContainsName(text, name));
    if (explicitTool) {
      return {
        kind: APPROVAL_KIND.TOOL,
        name: explicitTool,
        title: "API Tool",
        policyKey: "trustedTools",
        button: findApprovalButton(root),
        root
      };
    }

    const codeLikeName = extractCodeLikeName(root, text);
    if (codeLikeName && !/^MCP\b/i.test(codeLikeName)) {
      const normalizedCodeName = Dom.normalizeText(codeLikeName);
      const name = normalizedCodeName.startsWith("git ") ? codeLikeName.replace(/\s+/g, "_") : codeLikeName;
      return {
        kind: APPROVAL_KIND.TOOL,
        name,
        title: "API Tool",
        policyKey: "trustedTools",
        button: findApprovalButton(root),
        root
      };
    }

    const hasToolSignal = normalized.includes("tool") || normalized.includes("command") || normalized.includes("run") || normalized.includes("execute") || compact.includes("工具") || compact.includes("命令") || hasCommandLikeSignal(text);
    if (!hasToolSignal) return null;

    const tokenMatches = Array.from(text.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g))
      .map(match => cleanCandidateName(match[1]))
      .filter(value => value.includes("_"))
      .filter(value => !["read_only", "tool_call", "tool_calls"].includes(value.toLowerCase()));

    if (tokenMatches.length) {
      return {
        kind: APPROVAL_KIND.TOOL,
        name: tokenMatches[0],
        title: "API Tool",
        policyKey: "trustedTools",
        button: findApprovalButton(root),
        root
      };
    }

    const gitCommandMatch = text.match(/\bgit\s+(status|diff|commit|push|pull|checkout|branch|log|show|add|reset|restore)\b/i);
    if (gitCommandMatch) {
      return {
        kind: APPROVAL_KIND.TOOL,
        name: `git_${gitCommandMatch[1].toLowerCase()}`,
        title: "API Tool",
        policyKey: "trustedTools",
        button: findApprovalButton(root),
        root
      };
    }

    return null;
  }

  const DETECTORS = Object.freeze([
    detectConnector,
    detectMcpServer,
    detectApiTool
  ]);

  function detectApproval(root) {
    for (const detector of DETECTORS) {
      const result = detector(root);
      if (result) return result;
    }

    return {
      kind: APPROVAL_KIND.UNKNOWN,
      name: null,
      title: "Approval Item",
      policyKey: null,
      button: findApprovalButton(root),
      root
    };
  }

  function isTrustedTarget(target) {
    if (!target?.name) return false;

    if (target.kind === APPROVAL_KIND.CONNECTOR) {
      return hasTrustedValue(trustedConnectors, target.name, { loose: true });
    }
    if (target.kind === APPROVAL_KIND.SERVER) {
      return trustedServers.has(target.name);
    }
    if (target.kind === APPROVAL_KIND.TOOL) {
      return trustedTools.has(target.name);
    }

    return false;
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

  function getTypeText(target) {
    if (target.kind === APPROVAL_KIND.CONNECTOR) return "Connector";
    if (target.kind === APPROVAL_KIND.SERVER) return "MCP Server";
    if (target.kind === APPROVAL_KIND.TOOL) return "API Tool";
    return "Approval Item";
  }

  function getTrustActionLabel(target) {
    if (target.kind === APPROVAL_KIND.CONNECTOR) return "Trust this connector";
    if (target.kind === APPROVAL_KIND.SERVER) return "Trust this MCP server";
    if (target.kind === APPROVAL_KIND.TOOL) return "Trust this API tool";
    return "Trust this item";
  }

  function showBadge(target, trusted) {
    ensureApprovalHelperStyles();

    let badge = document.getElementById("mcp-approval-helper-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "mcp-approval-helper-badge";
      document.body.appendChild(badge);
      requestAnimationFrame(() => badge.classList.add("mcp-helper-visible"));
    }

    const typeText = getTypeText(target);
    const safeName = Dom.escapeHTML(target.name || "Unknown");
    const title = trusted ? `Trusted ${typeText}` : `Review ${typeText}`;
    const subtitle = trusted
      ? "This item is in your allowlist. Auto-approval can run when enabled."
      : "This item is not in your allowlist. Manual confirmation is required.";
    const icon = trusted ? "✓" : "!";
    const iconClass = trusted ? "trusted" : "untrusted";
    const actionHtml = !trusted && target.name && target.kind !== APPROVAL_KIND.UNKNOWN
      ? `<div class="mcp-helper-actions"><button id="mcp-helper-trust-btn" type="button">${getTrustActionLabel(target)}</button></div>`
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

    target.root.dataset.mcpApprovalHelperOutline = "true";
    target.root.style.outline = trusted ? "2px solid rgba(158, 206, 106, 0.88)" : "2px solid rgba(247, 118, 142, 0.88)";
    target.root.style.outlineOffset = "3px";
    target.root.style.boxShadow = trusted
      ? "0 0 0 6px rgba(158, 206, 106, 0.12), 0 22px 70px rgba(0, 0, 0, 0.28)"
      : "0 0 0 6px rgba(247, 118, 142, 0.12), 0 22px 70px rgba(0, 0, 0, 0.28)";

    if (!trusted && target.name && target.kind !== APPROVAL_KIND.UNKNOWN) {
      setTimeout(() => {
        const trustButton = document.getElementById("mcp-helper-trust-btn");
        if (!trustButton) return;
        trustButton.onclick = async () => saveTrustedValue(target.kind, target.name);
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

  function logTargetApproval(target, trusted) {
    Storage.logApproval({
      toolName: target.name || getTypeText(target),
      trusted,
      url: location.href
    });
  }

  function autoApproveWithRetry(target) {
    if (!target.root || pendingApprovals.has(target.root) || handledApprovals.has(target.root)) return;
    pendingApprovals.add(target.root);

    Clicker.clickWithRetry({
      dialog: target.root,
      findButton: findApprovalButton,
      isEnabled: Dom.isButtonEnabled,
      click: Dom.simulateRealClick,
      onClick: (_button, meta) => {
        console.log(`[Approval Helper] Attempting to approve ${target.kind}:${target.name} (${meta.index + 1}, ${meta.delay}ms).`);
      },
      onSuccess: () => {
        pendingApprovals.delete(target.root);
        handledApprovals.add(target.root);
        logTargetApproval(target, true);
        console.log(`[Approval Helper] Approved ${target.kind}:${target.name}.`);
      },
      onExhausted: reason => {
        pendingApprovals.delete(target.root);
        console.warn(`[Approval Helper] Approval retry exhausted for ${target.kind}:${target.name}: ${reason}`);
      }
    });
  }

  function getCurrentApproval() {
    const candidates = getApprovalCandidates();
    for (const candidate of candidates) {
      const target = detectApproval(candidate);
      if (target?.button) return target;
    }
    return null;
  }

  function scan() {
    if (settings.autoApprove !== true) {
      removeBadgeAndOutline();
      return;
    }

    const target = getCurrentApproval();

    if (!target) {
      removeBadgeAndOutline();
      return;
    }

    const trusted = isTrustedTarget(target);
    showBadge(target, trusted);

    if (trusted) {
      autoApproveWithRetry(target);
    }
  }

  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "y")) return;

    const target = getCurrentApproval();
    if (!target || handledApprovals.has(target.root)) return;

    const trusted = isTrustedTarget(target);
    if (!trusted) {
      const confirmApprove = confirm(`Warning: this ${getTypeText(target)} [${target.name || "Unknown"}] is not in your allowlist.\n\nApprove it manually?`);
      if (!confirmApprove) return;
    }

    if (!target.button) {
      alert("Approval button was not found. Please click it manually.");
      return;
    }

    logTargetApproval(target, trusted);
    Dom.simulateRealClick(target.button);
  });

  let scanPending = false;
  function scheduleScan() {
    if (settings.autoApprove !== true) {
      removeBadgeAndOutline();
      return;
    }

    if (scanPending) return;
    scanPending = true;

    const run = () => {
      scanPending = false;
      scan();
    };

    if (document.hidden) {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(run);
      } else {
        setTimeout(run, 0);
      }
      return;
    }

    requestAnimationFrame(run);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-disabled", "disabled", "data-state", "data-disabled", "open", "popover"]
  });

  document.addEventListener("visibilitychange", scheduleScan);
  window.addEventListener("focus", scheduleScan);

  Storage.onSettingsChanged(async () => {
    await refreshSettings();
    if (settings.autoApprove === true) {
      scheduleScan();
    } else {
      removeBadgeAndOutline();
    }
  });

  refreshSettings().then(() => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
    } else {
      scheduleScan();
    }

    window.setInterval(() => {
      if (settings.autoApprove === true) scheduleScan();
    }, 1200);
  });
})();
