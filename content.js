// 預設信任的 API 工具清單（當 storage 尚未初始化時的 fallback）
const DEFAULT_TRUSTED_TOOLS = new Set([
  "apply_patch",
  "exec_command",
  "write_stdin",
  "kill_session",
  "replace_text",
  "run_npm_test",
  "run_npm_typecheck",
  "run_npm_build",
  "git_status",
  "git_diff"
]);

// 預設信任的 MCP 伺服器清單
const DEFAULT_TRUSTED_SERVERS = new Set([
  "MCP Neverending Coding"
]);

let TRUSTED_TOOLS = new Set(DEFAULT_TRUSTED_TOOLS);
let TRUSTED_SERVERS = new Set(DEFAULT_TRUSTED_SERVERS);
let AUTO_APPROVE = false;

// 已經處理/點擊過核准的 Dialog 元素，避免重複觸發
const approvedDialogs = new WeakSet();

// 載入與監聽設定變更
async function initConfig() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get(["autoApprove", "trustedTools", "trustedServers"]);
      if (data.autoApprove !== undefined) {
        AUTO_APPROVE = data.autoApprove;
      }
      if (data.trustedTools !== undefined) {
        // 與 DEFAULT_TRUSTED_TOOLS 聯集，防止新追加的預設工具被排除
        TRUSTED_TOOLS = new Set([...DEFAULT_TRUSTED_TOOLS, ...data.trustedTools]);
      }
      if (data.trustedServers !== undefined) {
        // 與 DEFAULT_TRUSTED_SERVERS 聯集，防止新追加的預設伺服器被排除
        TRUSTED_SERVERS = new Set([...DEFAULT_TRUSTED_SERVERS, ...data.trustedServers]);
      }
    } catch (e) {
      console.error("無法自 chrome.storage 載入設定，使用預設值:", e);
    }

    // 監聽來自 options 頁面的即時變更
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "local") {
        if (changes.autoApprove) {
          AUTO_APPROVE = changes.autoApprove.newValue;
        }
        if (changes.trustedTools) {
          TRUSTED_TOOLS = new Set(changes.trustedTools.newValue);
        }
        if (changes.trustedServers) {
          TRUSTED_SERVERS = new Set(changes.trustedServers.newValue);
        }
        // 設定變更後立即重新掃描
        scan();
      }
    });
  }
}

// 動態新增信任工具並儲存
async function addNewTrustedTool(toolName) {
  if (!toolName) return;
  TRUSTED_TOOLS.add(toolName);
  
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      await chrome.storage.local.set({
        trustedTools: Array.from(TRUSTED_TOOLS)
      });
      console.log(`[MCP Helper] 已將工具 "${toolName}" 加入信任清單`);
    } catch (e) {
      console.error("無法將新工具存入 chrome.storage:", e);
    }
  } else {
    // Fallback 本地儲存（為 test_page 本地測試提供支援）
    try {
      const fallbackSettings = JSON.parse(localStorage.getItem("mcp_approval_settings_fallback_v2") || '{"autoApprove":false,"trustedTools":[],"trustedServers":[]}');
      if (!fallbackSettings.trustedTools.includes(toolName)) {
        fallbackSettings.trustedTools.push(toolName);
        localStorage.setItem("mcp_approval_settings_fallback_v2", JSON.stringify(fallbackSettings));
      }
      scan();
    } catch (e) {
      console.error("無法寫入 fallback 儲存:", e);
    }
  }
}

// 動態新增信任伺服器並儲存
async function addNewTrustedServer(serverName) {
  if (!serverName) return;
  TRUSTED_SERVERS.add(serverName);
  
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      await chrome.storage.local.set({
        trustedServers: Array.from(TRUSTED_SERVERS)
      });
      console.log(`[MCP Helper] 已將伺服器 "${serverName}" 加入信任清單`);
    } catch (e) {
      console.error("無法將新伺服器存入 chrome.storage:", e);
    }
  } else {
    // Fallback 本地儲存
    try {
      const fallbackSettings = JSON.parse(localStorage.getItem("mcp_approval_settings_fallback_v2") || '{"autoApprove":false,"trustedTools":[],"trustedServers":[]}');
      if (!fallbackSettings.trustedServers.includes(serverName)) {
        fallbackSettings.trustedServers.push(serverName);
        localStorage.setItem("mcp_approval_settings_fallback_v2", JSON.stringify(fallbackSettings));
      }
      scan();
    } catch (e) {
      console.error("無法寫入 fallback 儲存:", e);
    }
  }
}

function getVisibleText(el) {
  return (el?.innerText || el?.textContent || "").trim();
}

// 尋找 MCP 授權 dialog
function findApprovalDialog() {
  // 方法 1：尋找標準 role="dialog" 或 aria-modal="true"
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  for (const el of dialogs) {
    const text = getVisibleText(el);
    const hasAllow = text.includes("Allow") || text.includes("允許") || text.includes("同意");
    const hasMcp = text.includes("MCP") || text.includes("tool") || text.includes("工具");
    if (hasAllow && hasMcp) {
      return el;
    }
  }

  // 方法 2：反向尋找法（針對非標準 dialog 結構但包含允許按鈕與 MCP 關鍵字的情境）
  const buttons = Array.from(document.querySelectorAll("button"));
  for (const btn of buttons) {
    if (btn.offsetWidth === 0 && btn.offsetHeight === 0) continue; // 排除隱藏按鈕
    
    const btnText = getVisibleText(btn).toLowerCase();
    const isAllowBtn = btnText === "allow" || btnText.includes("allow") || btnText.includes("允許") || btnText.includes("同意");
    
    if (isAllowBtn) {
      // 往向尋找最近的容器，並檢查容器內是否包含 MCP 相關關鍵字
      let parent = btn.parentElement;
      let depth = 0;
      // 往上找最多 6 層
      while (parent && depth < 6) {
        const parentText = getVisibleText(parent);
        const hasMcp = parentText.includes("MCP") || parentText.includes("tool") || parentText.includes("工具");
        if (hasMcp) {
          return parent;
        }
        parent = parent.parentElement;
        depth++;
      }
    }
  }

  return null;
}

// 從 dialog 文字中抽取 tool/server 名稱
function extractToolName(dialog) {
  const text = getVisibleText(dialog);
  
  // 1. 優先以完整匹配 allowlist 中的名稱（最精準）
  for (const server of TRUSTED_SERVERS) {
    if (text.includes(server)) return { name: server, type: "server" };
  }
  for (const tool of TRUSTED_TOOLS) {
    if (text.includes(tool)) return { name: tool, type: "tool" };
  }

  // 2. 針對 ChatGPT 特定問句的正規表達式提取 MCP Server 名稱
  // 中文："要允許 ChatGPT 使用 MCP Neverending Coding 嗎？"
  const zhMatch = text.match(/使用\s*([a-zA-Z0-9_\s\-]+)\s*嗎/);
  if (zhMatch && zhMatch[1]) {
    const extracted = zhMatch[1].trim();
    if (extracted.toLowerCase().includes("mcp") || extracted.length > 3) {
      return { name: extracted, type: "server" };
    }
  }

  // 英文："Allow ChatGPT to use MCP Neverending Coding?"
  const enMatch = text.match(/use\s*([a-zA-Z0-9_\s\-]+)\?/i);
  if (enMatch && enMatch[1]) {
    const extracted = enMatch[1].trim();
    if (extracted.toLowerCase().includes("mcp") || extracted.length > 3) {
      return { name: extracted, type: "server" };
    }
  }

  // 3. 模糊匹配：尋找底線連接的標記，如 "exec_command" 等
  const match = text.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g);
  if (!match) return { name: null, type: "unknown" };

  const foundToolName = match.find((token) =>
    token.includes("_") &&
    !["read_only", "tool_call", "tool_calls"].includes(token.toLowerCase())
  ) || null;

  return { name: foundToolName, type: foundToolName ? "tool" : "unknown" };
}

// 尋找 Allow 按鈕
function findAllowButton(dialog) {
  const buttons = Array.from(dialog.querySelectorAll("button"));
  
  // 優先級 1：尋找包含 "always allow" 或 "一律允許" 的按鈕，以達到最大 YOLO 效果
  const alwaysAllowBtn = buttons.find(button => {
    const text = getVisibleText(button).toLowerCase();
    return text.includes("always allow") || text.includes("一律允許") || text.includes("一律同意");
  });
  if (alwaysAllowBtn) return alwaysAllowBtn;

  // 優先級 2：尋找一般的 allow 按鈕
  return buttons.find((button) => {
    const text = getVisibleText(button).toLowerCase();
    return (
      text === "allow" ||
      text.includes("allow") ||
      text.includes("允許") ||
      text.includes("同意")
    );
  }) || null;
}

// 顯示或更新右上角狀態 Badge
function showBadge(dialog, name, type, trusted) {
  let badge = document.getElementById("mcp-approval-helper-badge");

  if (!badge) {
    badge = document.createElement("div");
    badge.id = "mcp-approval-helper-badge";
    badge.style.position = "fixed";
    badge.style.zIndex = "2147483647";
    badge.style.top = "20px";
    badge.style.right = "20px";
    badge.style.padding = "12px 16px";
    badge.style.borderRadius = "12px";
    badge.style.fontSize = "13px";
    badge.style.fontWeight = "600";
    badge.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    badge.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.3)";
    badge.style.transition = "all 0.3s ease";
    badge.style.opacity = "0";
    badge.style.transform = "translateY(-10px)";
    document.body.appendChild(badge);
    
    // 微動畫滑入
    requestAnimationFrame(() => {
      badge.style.opacity = "1";
      badge.style.transform = "translateY(0)";
    });
  }

  const typeText = type === "server" ? "伺服器" : "工具";

  // 設定 Badge 樣式與文字
  if (trusted) {
    badge.style.background = "rgba(16, 185, 129, 0.95)"; /* Emerald Green */
    badge.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    badge.style.color = "white";
    badge.innerHTML = `🛡️ 信任的 MCP ${typeText}: <span style="text-decoration: underline;">${name || "未知"}</span><br><span style="font-size: 11px; font-weight: normal; opacity: 0.9;">按 Ctrl+Shift+Y 或點擊頁面核准</span>`;
    dialog.style.outline = "4px solid #10b981";
    dialog.style.outlineOffset = "2px";
  } else {
    badge.style.background = "rgba(239, 68, 68, 0.95)"; /* Rose Red */
    badge.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    badge.style.color = "white";
    
    // 一鍵信任按鈕
    let buttonHtml = "";
    if (name) {
      const btnText = type === "server" ? "一律信任此伺服器" : "一律信任此工具";
      buttonHtml = `<br><button id="mcp-helper-trust-btn" style="margin-top: 8px; display: inline-block; background: white; color: #dc3545; border: none; padding: 5px 12px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 11px; font-family: inherit; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: all 0.2s;">${btnText}</button>`;
    }
      
    badge.innerHTML = `⚠️ 未信任的 MCP ${typeText}: <span style="text-decoration: underline;">${name || "未知"}</span><br><span style="font-size: 11px; font-weight: normal; opacity: 0.9;">需手動點擊或按 Ctrl+Shift+Y 二次確認</span>${buttonHtml}`;
    dialog.style.outline = "4px solid #ef4444";
    dialog.style.outlineOffset = "2px";
    
    // 綁定點擊事件
    if (name) {
      setTimeout(() => {
        const trustBtn = document.getElementById("mcp-helper-trust-btn");
        if (trustBtn) {
          trustBtn.onclick = async () => {
            if (type === "server") {
              await addNewTrustedServer(name);
            } else {
              await addNewTrustedTool(name);
            }
          };
        }
      }, 0);
    }
  }
}

// 移除 Badge 與 Dialog 的樣式
function removeBadgeAndOutline() {
  const badge = document.getElementById("mcp-approval-helper-badge");
  if (badge) {
    badge.style.opacity = "0";
    badge.style.transform = "translateY(-10px)";
    setTimeout(() => badge.remove(), 300);
  }

  // 清除頁面上可能的 outline 樣式
  const dialogs = document.querySelectorAll('[role="dialog"], div');
  dialogs.forEach(el => {
    if (el.style.outline) {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }
  });
}

// 記錄審查日誌至 localStorage
function logApproval(toolName, trusted) {
  const key = "mcpApprovalHelperLog";
  try {
    const oldLog = JSON.parse(localStorage.getItem(key) || "[]");
    oldLog.push({
      toolName,
      trusted,
      time: new Date().toISOString(),
      url: location.href
    });
    // 保留最後 200 筆
    localStorage.setItem(key, JSON.stringify(oldLog.slice(-200)));
  } catch (e) {
    console.error("無法寫入稽核日誌:", e);
  }
}

// 模擬真實的滑鼠完整點擊事件流，提升 React 綁定與防護繞過的相容性
function simulateRealClick(element) {
  if (!element) return;
  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  events.forEach(eventName => {
    const event = new MouseEvent(eventName, {
      bubbles: true,
      cancelable: true,
      view: window,
      isTrusted: true
    });
    element.dispatchEvent(event);
  });
}

// 檢查按鈕目前是否已經「開放點擊」
function isButtonEnabled(button) {
  if (!button) return false;
  
  // 1. 檢查原生 disabled 屬性
  if (button.disabled) return false;
  
  // 2. 檢查 aria-disabled 狀態
  if (button.getAttribute("aria-disabled") === "true") return false;
  
  // 3. 檢查 class 是否有隱性 disabled 或 loading 特徵 (防範客製化按鈕)
  const classList = Array.from(button.classList).map(c => c.toLowerCase());
  const isBlocked = classList.some(c => c.includes("disabled") || c.includes("loading") || c.includes("wait"));
  if (isBlocked) return false;

  return true;
}

// 進行溫和的多階段重試點擊，解決 React 異步事件註冊延遲，同時避免高頻機械化行為被偵測
function autoApproveWithRetry(dialog, toolName) {
  // 不使用高頻的 setInterval 點擊（避免被 Cloudflare/OpenAI 偵測為 Bot 操作）
  // 改用模擬人類正常反應的「溫和且遞增的 30 秒時間序列 (30s Humanized Delay Sequence)」
  const delaySequence = [
    100, 400, 800, 1500, 2500, 4000, 6000, 9000, 12000, 16000, 20000, 25000, 30000
  ]; // 30秒內共嘗試點擊 13 次，間隔逐漸拉長
  
  delaySequence.forEach((delay, index) => {
    setTimeout(() => {
      // 點擊成功關閉後：如果 dialog 已經在 DOM 中被關閉，直接停止後續所有的點擊！
      if (!document.body.contains(dialog)) return;
      
      const allowButton = findAllowButton(dialog);
      // 關鍵優化：只有偵測到按鈕「已開放點擊 (Enabled)」時，才發送真實點擊模擬！
      if (allowButton && isButtonEnabled(allowButton)) {
        console.log(`[MCP Helper] 偵測到按鈕開放點擊，執行核准 (第 ${index + 1} 次, 延遲: ${delay}ms)`);
        simulateRealClick(allowButton);
      } else if (allowButton) {
        console.log(`[MCP Helper] 發現按鈕，但目前處於停用狀態，跳過此點擊 (延遲: ${delay}ms)`);
      }
    }, delay);
  });
}

// 掃描頁面並處理核准邏輯
function scan() {
  const dialog = findApprovalDialog();
  
  if (!dialog) {
    removeBadgeAndOutline();
    return;
  }

  // 避免重複處理已核准的同一個彈窗
  if (approvedDialogs.has(dialog)) return;

  const { name, type } = extractToolName(dialog);
  const trusted = name && (
    (type === "server" && TRUSTED_SERVERS.has(name)) ||
    (type === "tool" && TRUSTED_TOOLS.has(name))
  );

  showBadge(dialog, name, type, trusted);

  // 自動核准邏輯：如果啟用自動核准且該工具為信任工具
  if (AUTO_APPROVE && trusted) {
    approvedDialogs.add(dialog);
    logApproval(name, true);
    console.log(`[MCP Helper] 自動核准信任${type === "server" ? "伺服器" : "工具"}: ${name}`);
    
    // 執行溫和重試點擊機制
    autoApproveWithRetry(dialog, name);
  }
}

// 快捷鍵監聽器 Ctrl + Shift + Y
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "y")) {
    return;
  }

  const dialog = findApprovalDialog();
  if (!dialog) return;

  if (approvedDialogs.has(dialog)) return;

  const { name, type } = extractToolName(dialog);
  const trusted = name && (
    (type === "server" && TRUSTED_SERVERS.has(name)) ||
    (type === "tool" && TRUSTED_TOOLS.has(name))
  );

  // 若非信任工具，跳出 confirm 詢問二次確認而非直接封鎖
  if (!trusted) {
    const typeText = type === "server" ? "伺服器" : "工具";
    const confirmApprove = confirm(`警告：此 MCP ${typeText} [${name || "未知"}] 不在您的信任清單中。\n\n您確定要手動核准並執行嗎？`);
    if (!confirmApprove) return;
  }

  const allowButton = findAllowButton(dialog);
  if (!allowButton) {
    alert("找不到「允許」或「Allow」按鈕，請手動點擊。");
    return;
  }

  approvedDialogs.add(dialog);
  logApproval(name, trusted);
  console.log(`[MCP Helper] 快捷鍵核准${type === "server" ? "伺服器" : "工具"}: ${name} (信任狀態: ${trusted})`);
  simulateRealClick(allowButton);
});

let scanPending = false;
function throttleScan() {
  if (scanPending) return;
  scanPending = true;
  requestAnimationFrame(() => {
    scan();
    scanPending = false;
  });
}

// 使用 MutationObserver 監控 DOM
const observer = new MutationObserver(throttleScan);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

// 初始化設定並執行首次掃描
initConfig().then(() => {
  throttleScan();
});
