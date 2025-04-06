# Vibe Coding Tool 設計文件

## 整體架構

### 前端架構
- 基於HTML、CSS和JavaScript
- 使用Bootstrap作為UI框架
- 分為四個主要區塊：
  1. Prompt編輯區
  2. 檔案瀏覽選擇區
  3. LLM回覆顯示區
  4. 快速編輯區

### 後端架構
- Python RESTful API伺服器
- Flask框架處理HTTP請求
- 負責處理：
  - LLM API整合
  - 檔案系統操作
  - 模型選擇與切換

### 數據流程
1. 使用者選擇工作目錄並在檔案瀏覽區選擇檔案
2. 使用者輸入Prompt
3. 前端將Prompt和選定檔案的內容發送到後端
4. 後端調用LLM API並返回結果
5. 前端顯示LLM回覆並提供編輯功能

## API設計

### 端點設計

| 端點 | 方法 | 描述 | 請求體 | 響應 |
|------|------|------|--------|------|
| `/api/workspace` | POST | 設置工作空間路徑 | `{"path": "工作空間路徑"}` | `{"success": true, "files": [...]}` |
| `/api/files` | GET | 獲取文件列表 | - | `{"files": [...]}` |
| `/api/file` | GET | 獲取文件內容 | `{"path": "檔案路徑"}` | `{"content": "檔案內容"}` |
| `/api/file` | PUT | 更新文件內容 | `{"path": "檔案路徑", "content": "新內容"}` | `{"success": true}` |
| `/api/llm/models` | GET | 獲取可用的LLM模型 | - | `{"models": [...]}` |
| `/api/llm/query` | POST | 發送查詢到LLM | `{"prompt": "...", "files": [...], "model": "..."}` | `{"response": "..."}` |

## 安全性考量

1. 文件系統存取限制
   - 限制可訪問的目錄範圍
   - 檢查路徑遍歷攻擊

2. 輸入驗證
   - 驗證所有API輸入
   - 防止注入攻擊

3. 錯誤處理
   - 適當的錯誤代碼
   - 不暴露敏感信息的錯誤訊息

## 用戶體驗設計

1. 回饋機制
   - Loading動畫
   - 成功/失敗提示
   - 進度指示器

2. 快捷操作
   - 快速複製按鈕
   - 檔案預覽
   - 快速修改功能
