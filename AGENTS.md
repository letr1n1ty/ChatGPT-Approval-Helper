# AGENTS.md

## Overview
這是一個 Chrome Extension 專案，名為 `chatgpt-mcp-approval-helper`。
主要功能是偵測 ChatGPT 網頁上的 MCP (Model Context Protocol) 授權彈窗，標示信任的工具並提供自動或快捷鍵核准功能，以提升開發效率並保留安全稽核日誌。

## Structure
- `/Users/sigi/.gemini/antigravity/scratch/chatgpt-mcp-approval-helper/`
  - `manifest.json`: Extension 規格定義檔 (Manifest V3)
  - `content.js`: 負責注入 ChatGPT 頁面，進行 DOM 偵測與自動/快捷鍵核准邏輯
  - `options.html` / `options.js` (預計新增): 提供使用者管理信任工具清單與設定模式的設定頁面
  - `AGENTS.md`: 本專案開發與維護指引

## Build, Run, and Test
- 本專案為純前端 Chrome Extension，無須編譯步驟。
- 測試方式：
  1. 開啟 Chrome 瀏覽器，進入 `chrome://extensions`。
  2. 開啟右上角「開發者模式 (Developer mode)」。
  3. 點擊「載入未封裝項目 (Load unpacked)」，選擇專案目錄。
  4. 開啟 ChatGPT 進行功能驗證。

## Development Conventions
- 採用 **繁體中文** 撰寫說明與日誌（程式碼與變數除外）。
- 遵守 Manifest V3 規範，避免使用 `eval()`，使用非同步 `async/await` 代替 Promise 鏈。
- 修改 DOM 時使用強健的 selector，並考慮 ChatGPT 介面更新的相容性。

## Notes and Risks
- ChatGPT 的 DOM 結構（如彈窗、按鈕的 class 或文字）若發生重大更新，可能導致偵測失效，content.js 的 selector 需保持高可維護性與容錯設計。
- 自動 Approve 功能若過度寬鬆，可能帶來安全風險。本 Extension 預設應以半自動（僅信任 allowlist 中的工具）為主。
