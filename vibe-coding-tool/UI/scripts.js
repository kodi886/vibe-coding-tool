// 全局變量
let editor;
let selectedFiles = new Set();
let workspacePath = '';
let currentOpenFilePath = '';
let currentModels = [];

// DOM 加載完成後執行
document.addEventListener('DOMContentLoaded', () => {
    // 初始化代碼編輯器
    initCodeEditor();

    // 初始化事件監聽器
    initEventListeners();

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
    document.getElementById('selectFolderBtn').addEventListener('click', () => {
        document.getElementById('folderSelector').click();
    });

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
    });
}

// 處理資料夾選擇
async function handleFolderSelect(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    // 獲取基本路徑
    const basePath = files[0].webkitRelativePath.split('/')[0];
    workspacePath = basePath;

    // 更新當前路徑顯示
    document.getElementById('currentPath').textContent = basePath;

    // 創建資料夾結構
    const fileStructure = createFileStructure(files);

    // 渲染檔案樹
    renderFileTree(fileStructure);

    // 清空選擇
    document.getElementById('folderSelector').value = '';
}

// 從 FileList 創建檔案結構
function createFileStructure(files) {
    const structure = {};

    for (const file of files) {
        const relativePath = file.webkitRelativePath;
        const parts = relativePath.split('/');

        // 跳過根目錄
        if (parts.length <= 1) continue;

        let current = structure;

        // 構建目錄結構
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];

            // 如果是最後一部分，則為檔案
            if (i === parts.length - 1) {
                if (!current.files) current.files = [];
                current.files.push({
                    name: part,
                    fullPath: relativePath,
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

    return structure;
}

// 獲取檔案類型
function getFileType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    const codeExtensions = ['js', 'py', 'java', 'c', 'cpp', 'cs', 'php', 'html', 'css', 'ts', 'jsx', 'tsx', 'rb', 'go', 'rs', 'swift'];

    if (codeExtensions.includes(extension)) {
        return 'code';
    }

    return 'file';
}

// 渲染檔案樹
function renderFileTree(structure, parentElement = null, path = '') {
    if (!parentElement) {
        const fileTreeElement = document.getElementById('fileTree');
        fileTreeElement.innerHTML = '';
        parentElement = fileTreeElement;
    }

    // 渲染目錄
    if (structure.dirs) {
        for (const dirName in structure.dirs) {
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
            renderFileTree(structure.dirs[dirName], dirContent, dirPath);
        }
    }

    // 渲染檔案
    if (structure.files) {
        structure.files.forEach(file => {
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
                document.getElementById('editor-tab').click();
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

// 開啟檔案
async function openFile(filePath) {
    try {
        // 顯示正在加載
        document.getElementById('codeEditor').innerHTML = '<div class="p-3">Loading...</div>';

        // 獲取檔案內容
        const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load file');
        }

        const data = await response.json();

        // 設置編輯器內容
        editor.setValue(data.content, -1);

        // 根據檔案類型設置編輯器語言
        const extension = filePath.split('.').pop().toLowerCase();
        const langMap = {
            'js': 'javascript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'java': 'java',
            'c': 'c_cpp',
            'cpp': 'c_cpp',
            'cs': 'csharp',
            'php': 'php',
            'ts': 'typescript',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'rb': 'ruby',
            'go': 'golang',
            'rs': 'rust',
            'swift': 'swift'
        };

        editor.session.setMode(`ace/mode/${langMap[extension] || 'text'}`);

        // 更新當前開啟的檔案路徑
        currentOpenFilePath = filePath;
        document.getElementById('currentEditingFile').textContent = filePath;

        // 禁用儲存按鈕（因為剛打開檔案）
        document.getElementById('saveFileBtn').disabled = true;
    } catch (error) {
        showError('無法開啟檔案', error.message);
    }
}

// 儲存檔案變更
async function saveFileChanges() {
    if (!currentOpenFilePath) return;

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

        // 禁用儲存按鈕
        document.getElementById('saveFileBtn').disabled = true;

        // 顯示成功訊息
        const saveBtn = document.getElementById('saveFileBtn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="bi bi-check"></i> 已儲存';

        setTimeout(() => {
            saveBtn.innerHTML = originalText;
        }, 2000);

    } catch (error) {
        showError('無法儲存檔案', error.message);
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
        currentModels = data.models;

        // 更新模型選擇器
        const modelSelector = document.getElementById('modelSelector');
        modelSelector.innerHTML = '';

        currentModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            modelSelector.appendChild(option);
        });

    } catch (error) {
        showError('無法獲取模型列表', error.message);
    }
}

// 處理 Prompt 提交
async function handlePromptSubmit() {
    // 獲取 Prompt 內容
    const promptText = document.getElementById('promptInput').value.trim();
    if (!promptText) {
        showError('缺少資訊', '請輸入 Prompt 內容');
        return;
    }

    // 檢查是否有選擇檔案
    const useSelectedFiles = document.getElementById('onlySelectedFiles').checked;
    if (useSelectedFiles && selectedFiles.size === 0) {
        showError('缺少資訊', '請至少選擇一個檔案');
        return;
    }

    // 顯示載入指示器
    document.getElementById('loadingIndicator').classList.remove('d-none');
    document.getElementById('responseDisplay').classList.add('d-none');

    // 切換到回覆標籤
    document.getElementById('response-tab').click();

    try {
        // 獲取選定的模型
        const modelSelector = document.getElementById('modelSelector');
        const selectedModelId = modelSelector.value;

        // 準備檔案內容
        const files = [];

        if (useSelectedFiles) {
            for (const filePath of selectedFiles) {
                const fileResponse = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
                if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    files.push({
                        path: filePath,
                        content: fileData.content
                    });
                }
            }
        } else {
            // 如果不限制選擇的檔案，則從後端獲取所有檔案（這部分需要後端支援）
            const allFilesResponse = await fetch('/api/files');
            if (allFilesResponse.ok) {
                const allFilesData = await allFilesResponse.json();

                for (const filePath of allFilesData.files) {
                    const fileResponse = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
                    if (fileResponse.ok) {
                        const fileData = await fileResponse.json();
                        files.push({
                            path: filePath,
                            content: fileData.content
                        });
                    }
                }
            }
        }

        // 修改 prompt，添加 git 方式指示
        const finalPrompt = `${promptText}\n\n請以 git 方式呈現需要改動的部分。`;

        // 發送請求到後端
        const response = await fetch('/api/llm/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: finalPrompt,
                files: files,
                model: selectedModelId
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get LLM response');
        }

        const data = await response.json();

        // 隱藏載入指示器
        document.getElementById('loadingIndicator').classList.add('d-none');
        document.getElementById('responseDisplay').classList.remove('d-none');

        // 使用 Showdown 將 Markdown 轉換為 HTML
        const converter = new showdown.Converter({
            extensions: ['highlightjs'],
            ghCodeBlocks: true
        });

        let responseHtml = converter.makeHtml(data.response);

        // 處理程式碼塊高亮顯示
        document.getElementById('responseDisplay').innerHTML = responseHtml;

        // 應用語法高亮
        document.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightBlock(block);
        });

    } catch (error) {
        // 隱藏載入指示器
        document.getElementById('loadingIndicator').classList.add('d-none');
        document.getElementById('responseDisplay').classList.remove('d-none');

        showError('處理請求時發生錯誤', error.message);
        document.getElementById('responseDisplay').innerHTML = `
    <div class="alert alert-danger">
        <strong>錯誤:</strong> ${error.message}
    </div>
`;
    }
}

// 複製回覆內容到剪貼簿
function copyResponseToClipboard() {
    const responseElement = document.getElementById('responseDisplay');

    // 創建一個臨時的 textarea 元素
    const textArea = document.createElement('textarea');
    textArea.value = responseElement.textContent;
    document.body.appendChild(textArea);

    // 選中文字並複製
    textArea.select();
    document.execCommand('copy');

    // 移除臨時元素
    document.body.removeChild(textArea);

    // 更新按鈕顯示
    const copyBtn = document.getElementById('copyResponseBtn');
    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i class="bi bi-clipboard-check"></i> 已複製';

    setTimeout(() => {
        copyBtn.innerHTML = originalText;
    }, 2000);
}

// 顯示錯誤訊息
function showError(title, message) {
    const errorModal = new bootstrap.Modal(document.getElementById('errorModal'));
    document.getElementById('errorModalBody').textContent = message;
    errorModal.show();
}

// 遞歸獲取檔案內容（用於從檔案結構中獲取所有檔案）
async function getFilesContent(structure, basePath = '') {
    let files = [];

    if (structure.files) {
        for (const file of structure.files) {
            const filePath = basePath ? `${basePath}/${file.name}` : file.name;
            const fullPath = `${workspacePath}/${filePath}`;

            // 只處理代碼檔案
            if (file.type === 'code') {
                try {
                    const response = await fetch(`/api/file?path=${encodeURIComponent(fullPath)}`);
                    if (response.ok) {
                        const data = await response.json();
                        files.push({
                            path: filePath,
                            content: data.content
                        });
                    }
                } catch (error) {
                    console.error(`Failed to load file ${filePath}:`, error);
                }
            }
        }
    }

    if (structure.dirs) {
        for (const dirName in structure.dirs) {
            const dirPath = basePath ? `${basePath}/${dirName}` : dirName;
            const dirFiles = await getFilesContent(structure.dirs[dirName], dirPath);
            files = files.concat(dirFiles);
        }
    }

    return files;
}
