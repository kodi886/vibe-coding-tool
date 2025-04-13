// 全局變量
let editor;
let selectedFiles = new Set();
let workspacePath = '';
let currentOpenFilePath = '';
let currentModels = [];
let autoSaveTimer = null;
let isFileModified = false;
let originalContent = {};
let currentModelId = '';
let isDarkTheme = true; // 預設為深色模式

// DOM 加載完成後執行
document.addEventListener('DOMContentLoaded', () => {
    // 初始化代碼編輯器
    initCodeEditor();

    // 初始化事件監聽器
    initEventListeners();

    // 應用當前主題
    applyTheme();
    
    // 獲取可用的 LLM 模型
    fetchAvailableModels();
});

// 初始化 ACE 編輯器
function initCodeEditor() {
    editor = ace.edit("codeEditor");
    editor.setTheme("ace/theme/monokai");
    editor.setShowPrintMargin(false);
    editor.setOptions({
        fontSize: "14px",
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true
    });
}

// 初始化各種事件監聽器
function initEventListeners() {
    // 選擇資料夾按鈕
    document.getElementById('selectFolderBtn').addEventListener('click', selectWorkspaceFolder);

    // 資料夾選擇變更事件
    document.getElementById('folderSelector').addEventListener('change', handleFolderSelect);

    // 提交 Prompt 按鈕
    document.getElementById('submitPromptBtn').addEventListener('click', handlePromptSubmit);

    // 複製回覆內容按鈕
    document.getElementById('copyResponseBtn').addEventListener('click', copyResponseToClipboard);

    // 儲存檔案變更按鈕
    document.getElementById('saveFileBtn').addEventListener('click', saveFileChanges);

    // 編輯器內容變更事件
    editor.on('change', () => {
        document.getElementById('saveFileBtn').disabled = false;
        isFileModified = true;
        
        // 設置自動儲存計時器
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }
        autoSaveTimer = setTimeout(() => {
            saveFileChanges(true); // true表示靜默保存
        }, 5000); // 5秒後自動保存
    });
    
    // 切換編輯器/聊天視圖
    document.getElementById('editor-toggle-btn').addEventListener('click', () => {
        document.getElementById('editorPanel').classList.add('active');
        document.querySelector('.chat-container').style.display = 'none';
    });
    
    document.getElementById('back-to-chat').addEventListener('click', () => {
        document.getElementById('editorPanel').classList.remove('active');
        document.querySelector('.chat-container').style.display = 'flex';
    });
    
    // 處理模型選擇
    document.getElementById('modelSelector').addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-item')) {
            const modelId = e.target.dataset.modelId;
            const modelName = e.target.textContent;
            
            // 更新當前模型
            currentModelId = modelId;
            document.getElementById('currentModelName').textContent = modelName;
        }
    });
    
    // 按下 Ctrl+Enter 時送出 prompt
    document.getElementById('promptInput').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            handlePromptSubmit();
        }
    });
    
    // 主題切換按鈕
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
        toggleTheme();
    });
}

// 切換主題
function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    applyTheme();
    // 保存主題設置到本地存儲
    localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
}

// 選擇工作目錄
function selectWorkspaceFolder() {
    document.getElementById('folderSelector').click();
}

// 應用主題
function applyTheme() {
    const body = document.body;
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    
    if (isDarkTheme) {
        body.classList.remove('light-theme');
        themeToggleBtn.innerHTML = '<i class="bi bi-sun"></i>';
        themeToggleBtn.title = '切換至亮色模式';
    } else {
        body.classList.add('light-theme');
        themeToggleBtn.innerHTML = '<i class="bi bi-moon"></i>';
        themeToggleBtn.title = '切換至深色模式';
    }
}

// 處理資料夾選擇 (從舊版本保留，用於前端直接選擇資料夾)
function handleFolderSelect(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    // 獲取基本路徑
    const basePath = files[0].webkitRelativePath.split('/')[0];
    workspacePath = basePath;

    // 更新當前路徑顯示
    document.getElementById('currentPath').textContent = basePath;

    // 渲染檔案樹
    renderFileTree(Array.from(files).map(file => file.webkitRelativePath));

    // 清空選擇
    document.getElementById('folderSelector').value = '';
}

// 渲染檔案樹
function renderFileTree(files) {
    const fileTreeElement = document.getElementById('fileTree');
    fileTreeElement.innerHTML = '';
    
    // 創建檔案結構
    const structure = {};
    
    for (const file of files) {
        const parts = file.split('/');
        let current = structure;
        
        // 構建目錄結構
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            // 如果是最後一部分，則為檔案
            if (i === parts.length - 1) {
                if (!current.files) current.files = [];
                current.files.push({
                    name: part,
                    fullPath: file,
                    type: getFileType(part)
                });
            } else {
                // 否則為目錄
                if (!current.dirs) current.dirs = {};
                if (!current.dirs[part]) current.dirs[part] = {};
                current = current.dirs[part];
            }
        }
    }
    
    // 渲染目錄
    renderFileTreeNode(structure, fileTreeElement);
}

// 渲染檔案樹節點
function renderFileTreeNode(node, parentElement, path = '') {
    // 渲染目錄
    if (node.dirs) {
        for (const dirName in node.dirs) {
            const dirPath = path ? `${path}/${dirName}` : dirName;
            const dirElement = document.createElement('div');
            dirElement.className = 'file-tree-folder';
            
            const folderHeader = document.createElement('div');
            folderHeader.className = 'file-item';
            folderHeader.innerHTML = `
                <i class="bi bi-folder-fill folder-icon"></i>
                <span>${dirName}</span>
            `;
            
            folderHeader.addEventListener('click', () => {
                // 切換資料夾開關狀態
                const content = dirElement.querySelector('.file-tree-indent');
                content.style.display = content.style.display === 'none' ? 'block' : 'none';
                const icon = folderHeader.querySelector('i');
                icon.className = icon.className.includes('fill') ?
                    'bi bi-folder folder-icon' : 'bi bi-folder-fill folder-icon';
            });
            
            dirElement.appendChild(folderHeader);
            
            const dirContent = document.createElement('div');
            dirContent.className = 'file-tree-indent';
            dirElement.appendChild(dirContent);
            
            parentElement.appendChild(dirElement);
            
            // 遞迴渲染子目錄
            renderFileTreeNode(node.dirs[dirName], dirContent, dirPath);
        }
    }
    
    // 渲染檔案
    if (node.files) {
        node.files.forEach(file => {
            const fullPath = file.fullPath;
            const fileElement = document.createElement('div');
            fileElement.className = 'file-item';
            
            fileElement.innerHTML = `
                <input type="checkbox" class="file-checkbox" data-path="${fullPath}">
                <i class="bi bi-file-earmark${file.type === 'code' ? '-code' : ''} file-icon"></i>
                <span>${file.name}</span>
            `;
            
            // 檔案點擊事件
            fileElement.addEventListener('click', (e) => {
                // 如果點擊的是 checkbox，則不做任何處理
                if (e.target.type === 'checkbox') {
                    const isChecked = e.target.checked;
                    if (isChecked) {
                        selectedFiles.add(fullPath);
                    } else {
                        selectedFiles.delete(fullPath);
                    }
                    return;
                }
                
                // 打開檔案
                openFile(fullPath);
                
                // 切換到編輯器標籤
                document.getElementById('editorPanel').classList.add('active');
                document.querySelector('.chat-container').style.display = 'none';
            });
            
            // 複選框變更事件
            const checkbox = fileElement.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const isChecked = e.target.checked;
                if (isChecked) {
                    selectedFiles.add(fullPath);
                } else {
                    selectedFiles.delete(fullPath);
                }
            });
            
            parentElement.appendChild(fileElement);
        });
    }
}

// 獲取檔案類型
function getFileType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    const codeExtensions = ['js', 'py', 'java', 'c', 'cpp', 'cs', 'php', 'html', 'css', 'ts', 'jsx', 'tsx', 'go', 'rs', 'rb', 'swift'];
    
    if (codeExtensions.includes(extension)) {
        return 'code';
    } else if (extension === 'md') {
        return 'markdown';
    } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(extension)) {
        return 'image';
    } else {
        return 'text';
    }
}

// 打開檔案
async function openFile(filePath) {
    try {
        const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch file content');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 儲存原始內容，用於後續差異比較
            originalContent[filePath] = data.content;
            
            // 更新當前開啟的檔案路徑
            currentOpenFilePath = filePath;
            
            // 更新顯示檔案名稱
            document.getElementById('currentEditingFile').textContent = filePath;
            
            // 設定編輯器內容
            editor.setValue(data.content);
            editor.clearSelection();
            
            // 根據檔案類型設定編輯器模式
            setEditorMode(filePath);
            
            // 啟用儲存按鈕
            document.getElementById('saveFileBtn').disabled = true;
            isFileModified = false;
        } else {
            showError('開啟檔案失敗', data.error);
        }
    } catch (error) {
        showError('開啟檔案時發生錯誤', error.message);
    }
}

// 設定編輯器模式
function setEditorMode(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    
    // 根據檔案類型設定不同的模式
    let mode;
    switch (extension) {
        case 'js':
        case 'jsx':
            mode = 'ace/mode/javascript';
            break;
        case 'ts':
        case 'tsx':
            mode = 'ace/mode/typescript';
            break;
        case 'html':
            mode = 'ace/mode/html';
            break;
        case 'css':
            mode = 'ace/mode/css';
            break;
        case 'py':
            mode = 'ace/mode/python';
            break;
        case 'java':
            mode = 'ace/mode/java';
            break;
        case 'c':
        case 'cpp':
            mode = 'ace/mode/c_cpp';
            break;
        case 'cs':
            mode = 'ace/mode/csharp';
            break;
        case 'php':
            mode = 'ace/mode/php';
            break;
        case 'rb':
            mode = 'ace/mode/ruby';
            break;
        case 'go':
            mode = 'ace/mode/golang';
            break;
        case 'rs':
            mode = 'ace/mode/rust';
            break;
        case 'json':
            mode = 'ace/mode/json';
            break;
        case 'md':
            mode = 'ace/mode/markdown';
            break;
        default:
            mode = 'ace/mode/text';
    }
    
    editor.session.setMode(mode);
}

// 儲存檔案變更
async function saveFileChanges(silent = false) {
    if (!currentOpenFilePath || !isFileModified) {
        return;
    }
    
    try {
        const content = editor.getValue();
        
        const response = await fetch('/api/file', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentOpenFilePath,
                content: content
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save file');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 更新狀態
            isFileModified = false;
            document.getElementById('saveFileBtn').disabled = true;
            
            if (!silent) {
                // 顯示儲存成功消息 (如果不是靜默保存)
                const saveMessage = document.createElement('div');
                saveMessage.className = 'alert alert-success fade-in';
                saveMessage.style.position = 'fixed';
                saveMessage.style.bottom = '20px';
                saveMessage.style.right = '20px';
                saveMessage.style.zIndex = '1000';
                saveMessage.textContent = '檔案已成功儲存';
                
                document.body.appendChild(saveMessage);
                
                // 3秒後移除消息
                setTimeout(() => {
                    saveMessage.style.opacity = '0';
                    setTimeout(() => {
                        document.body.removeChild(saveMessage);
                    }, 300);
                }, 3000);
            }
        } else {
            showError('儲存檔案失敗', data.error);
        }
    } catch (error) {
        showError('儲存檔案時發生錯誤', error.message);
    }
}

// 獲取可用的 LLM 模型
async function fetchAvailableModels() {
    try {
        const response = await fetch('/api/llm/models');
        
        if (!response.ok) {
            throw new Error('Failed to fetch models');
        }
        
        const data = await response.json();
        
        if (data.success) {
            currentModels = data.models;
            renderModelSelector(data.models);
        } else {
            showError('獲取模型列表失敗', data.error);
        }
    } catch (error) {
        showError('獲取模型列表時發生錯誤', error.message);
    }
}

// 渲染模型選擇器
function renderModelSelector(models) {
    const modelSelector = document.getElementById('modelSelector');
    modelSelector.innerHTML = '';
    
    if (models.length === 0) {
        const item = document.createElement('li');
        item.innerHTML = '<a class="dropdown-item">無可用模型</a>';
        modelSelector.appendChild(item);
        return;
    }
    
    models.forEach(model => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'dropdown-item';
        link.textContent = model.name;
        link.dataset.modelId = model.id;
        
        item.appendChild(link);
        modelSelector.appendChild(item);
    });
    
    // 預設選擇第一個模型
    currentModelId = models[0].id;
    document.getElementById('currentModelName').textContent = models[0].name;
}

// 處理 Prompt 提交
async function handlePromptSubmit() {
    // 獲取 prompt 輸入
    const promptInput = document.getElementById('promptInput');
    const promptText = promptInput.value.trim();
    
    if (!promptText) {
        showError('錯誤', '請輸入 prompt');
        return;
    }
    
    // 檢查是否已選擇模型
    if (!currentModelId) {
        showError('錯誤', '請選擇一個模型');
        return;
    }
    
    // 檢查是否選擇了檔案
    if (selectedFiles.size === 0) {
        showError('錯誤', '請至少選擇一個檔案');
        return;
    }
    
    // 顯示載入中
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.classList.remove('d-none');
    
    // 創建檔案內容陣列
    const filesContent = [];
    
    try {
        // 讀取所有選擇的檔案內容
        for (const filePath of selectedFiles) {
            const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch content for ${filePath}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                filesContent.push({
                    path: filePath,
                    content: data.content
                });
            } else {
                throw new Error(`Error reading ${filePath}: ${data.error}`);
            }
        }
        
        // 發送 prompt 和檔案內容給 LLM API
        const response = await fetch('/api/llm/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: promptText,
                files: filesContent,
                model: currentModelId
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to get response from LLM');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 顯示回應
            displayLLMResponse(data.response, data.changes);
            
            // 清空輸入框
            promptInput.value = '';
        } else {
            showError('LLM 查詢失敗', data.error);
        }
    } catch (error) {
        showError('發送 prompt 時發生錯誤', error.message);
    } finally {
        // 隱藏載入中
        loadingIndicator.classList.add('d-none');
    }
}

// 顯示 LLM 回應
function displayLLMResponse(response, changes) {
    const responseDisplay = document.getElementById('responseDisplay');
    
    // 創建新的回應卡片
    const responseCard = document.createElement('div');
    responseCard.className = 'response-card fade-in';
    
    // 轉換 Markdown 為 HTML
    const converter = new showdown.Converter({
        ghCodeBlocks: true,
        simpleLineBreaks: true
    });
    const htmlContent = converter.makeHtml(response);
    
    responseCard.innerHTML = `
        <div class="markdown-body">
            ${htmlContent}
        </div>
    `;
    
    // 如果有變更的代碼，添加應用按鈕
    if (changes && changes.changes) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'response-actions';
        actionsDiv.innerHTML = `
            <button class="btn btn-sm btn-primary apply-changes-btn">
                <i class="bi bi-code-slash"></i> 應用變更
            </button>
            <button class="btn btn-sm btn-outline-secondary show-diff-btn">
                <i class="bi bi-eye"></i> 查看差異
            </button>
        `;
        
        // 添加應用變更事件
        const applyBtn = actionsDiv.querySelector('.apply-changes-btn');
        applyBtn.addEventListener('click', () => {
            applyLLMChanges(changes.changes);
        });
        
        // 添加查看差異事件
        const diffBtn = actionsDiv.querySelector('.show-diff-btn');
        diffBtn.addEventListener('click', () => {
            showFileDiff(changes.changes);
        });
        
        responseCard.appendChild(actionsDiv);
    }
    
    // 添加到顯示區域
    responseDisplay.appendChild(responseCard);
    
    // 滾動到底部
    responseDisplay.scrollTop = responseDisplay.scrollHeight;
    
    // 為每個代碼塊添加語法高亮
    const codeBlocks = responseCard.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
        hljs.highlightElement(block);
    });
}

// 應用 LLM 變更
async function applyLLMChanges(changes) {
    try {
        const response = await fetch('/api/llm/apply-changes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                changes: changes
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to apply changes');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 顯示成功消息
            const successMessage = document.createElement('div');
            successMessage.className = 'alert alert-success fade-in';
            successMessage.style.position = 'fixed';
            successMessage.style.bottom = '20px';
            successMessage.style.right = '20px';
            successMessage.style.zIndex = '1000';
            successMessage.textContent = '變更已成功應用到檔案';
            
            document.body.appendChild(successMessage);
            
            // 3秒後移除消息
            setTimeout(() => {
                successMessage.style.opacity = '0';
                setTimeout(() => {
                    document.body.removeChild(successMessage);
                }, 300);
            }, 3000);
            
            // 如果有受影響的檔案且當前有開啟檔案，重新載入編輯器內容
            if (data.affected_files && data.affected_files.includes(currentOpenFilePath)) {
                openFile(currentOpenFilePath);
            }
        } else {
            showError('應用變更失敗', data.error);
        }
    } catch (error) {
        showError('應用變更時發生錯誤', error.message);
    }
}

// 顯示檔案差異
async function showFileDiff(changes) {
    if (!changes) {
        showError('錯誤', '無法顯示差異，沒有提供變更內容');
        return;
    }
    
    // 創建模態對話框
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'diffModal';
    modal.setAttribute('tabindex', '-1');
    modal.setAttribute('aria-hidden', 'true');
    
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">檔案變更差異</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <pre class="diff-content"></pre>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">關閉</button>
                    <button type="button" class="btn btn-primary confirm-changes-btn">確認並應用變更</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    // 處理差異內容，添加顏色高亮
    const diffContent = modal.querySelector('.diff-content');
    let formattedDiff = '';
    const lines = changes.split('\n');
    
    lines.forEach(line => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            formattedDiff += `<span class="diff-addition">${line}</span>\n`;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            formattedDiff += `<span class="diff-deletion">${line}</span>\n`;
        } else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++')) {
            formattedDiff += `<span class="diff-header">${line}</span>\n`;
        } else {
            formattedDiff += `${line}\n`;
        }
    });
    
    diffContent.innerHTML = formattedDiff;
        
    // 設置確認按鈕事件
    const confirmBtn = modal.querySelector('.confirm-changes-btn');
    confirmBtn.addEventListener('click', () => {
        applyLLMChanges(changes);
        const bsModal = bootstrap.Modal.getInstance(modal);
        bsModal.hide();
    });
    
    // 顯示模態對話框
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    // 當模態對話框隱藏時清理
    modal.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modal);
    });
}

// 複製回應到剪貼簿
function copyResponseToClipboard() {
    const responseDisplay = document.getElementById('responseDisplay');
    const responseText = responseDisplay.textContent;
    
    if (!responseText.trim()) {
        showError('錯誤', '沒有內容可複製');
        return;
    }
    
    navigator.clipboard.writeText(responseText).then(() => {
        // 顯示成功消息
        const copyMessage = document.createElement('div');
        copyMessage.className = 'alert alert-success fade-in';
        copyMessage.style.position = 'fixed';
        copyMessage.style.bottom = '20px';
        copyMessage.style.right = '20px';
        copyMessage.style.zIndex = '1000';
        copyMessage.textContent = '內容已複製到剪貼簿';
        
        document.body.appendChild(copyMessage);
        
        // 3秒後移除消息
        setTimeout(() => {
            copyMessage.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(copyMessage);
            }, 300);
        }, 3000);
    }).catch(error => {
        showError('複製失敗', error.message);
    });
}

// 載入時檢查保存的主題設置
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        isDarkTheme = savedTheme === 'dark';
        applyTheme();
    } else {
        // 預設為深色模式
        isDarkTheme = true;
        // 因為 DOMContentLoaded 第一次執行時已經 applyTheme() 了
        // 所以這裡如果 localStorage 沒有值，不需要再呼叫 applyTheme()
        // 但如果希望明確設定一次，加上也無妨
        // applyTheme(); 
    }
});

// 顯示錯誤對話框
function showError(title, message) {
    const errorModal = document.getElementById('errorModal');
    const errorModalBody = document.getElementById('errorModalBody');
    
    errorModalBody.textContent = message;
    
    const modal = new bootstrap.Modal(errorModal);
    modal.show();
}