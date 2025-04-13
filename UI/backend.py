import os
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import tempfile
import subprocess
import difflib
import webbrowser
import time
import threading
from werkzeug.serving import run_simple
import logging

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 修改為包含當前目錄的靜態檔案
app = Flask(__name__, static_folder='static')
CORS(app)  # 允許跨域請求

# 設定臨時檔案夾，用於儲存副本及檔案比較
TEMP_DIR = tempfile.mkdtemp(prefix="vibe_coding_")
logger.info(f"使用臨時目錄: {TEMP_DIR}")

# 目前的工作目錄
current_workspace = None

# LLM 模型配置 - 根據公司需求修改
LLM_MODELS = [
    {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo"},
    {"id": "gpt-4", "name": "GPT-4"},
    {"id": "llama-2", "name": "Llama 2"},
    # 添加其他公司內部模型
]

# 添加一個獨立的LLM應用程序API端點
LLM_APP_ENDPOINT = "http://localhost:8001/process"  # 這裡需要替換為實際的LLM應用程序端點

# 支援的檔案類型
SUPPORTED_EXTENSIONS = ['.js', '.py', '.html', '.css', '.java', '.c', '.cpp', '.cs', 
                        '.php', '.ts', '.jsx', '.tsx', '.rb', '.go', '.rs', '.swift',
                        '.json', '.md', '.txt']

# 最後修改的檔案及其內容的緩存
file_cache = {}
last_save_time = {}

# 定期保存檔案的間隔（秒）
AUTO_SAVE_INTERVAL = 5

def get_file_list(directory, extensions=None):
    """獲取指定目錄下的所有檔案清單"""
    file_list = []
    
    for root, _, files in os.walk(directory):
        for file in files:
            if extensions is None or any(file.endswith(ext) for ext in extensions):
                relative_path = os.path.relpath(os.path.join(root, file), directory)
                file_list.append(relative_path)
    
    return file_list

def create_file_backup(file_path):
    """為檔案創建備份"""
    if not os.path.exists(file_path):
        return None
    
    # 創建備份檔案名稱
    backup_filename = os.path.basename(file_path) + ".backup"
    backup_path = os.path.join(TEMP_DIR, backup_filename)
    
    # 複製檔案內容
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as src_file:
            content = src_file.read()
            
        with open(backup_path, 'w', encoding='utf-8') as backup_file:
            backup_file.write(content)
        
        return backup_path
    except Exception as e:
        logger.error(f"創建檔案備份時發生錯誤: {str(e)}")
        return None

def is_path_safe(base_path, requested_path):
    """確保請求的路徑在基礎路徑內，防止路徑遍歷攻擊"""
    # 獲取規範化的絕對路徑
    base_abs = os.path.abspath(base_path)
    req_abs = os.path.abspath(os.path.join(base_path, requested_path))
    
    # 檢查請求的路徑是否以基礎路徑開頭
    return req_abs.startswith(base_abs)

def auto_save_thread():
    """定期保存修改的檔案的後台線程"""
    while True:
        current_time = time.time()
        # 創建file_cache的副本進行迭代，避免在迭代過程中修改字典
        files_to_check = dict(file_cache)
        for file_path, content in files_to_check.items():
            if file_path in last_save_time:
                # 如果自上次保存以來已經過了設定的間隔時間
                if current_time - last_save_time[file_path] >= AUTO_SAVE_INTERVAL:
                    try:
                        # 檢查檔案是否仍然存在
                        if os.path.exists(file_path):
                            with open(file_path, 'w', encoding='utf-8') as f:
                                f.write(content)
                            logger.info(f"自動保存檔案: {file_path}")
                            # 從緩存中移除
                            file_cache.pop(file_path, None)
                            last_save_time.pop(file_path, None)
                    except Exception as e:
                        logger.error(f"自動保存檔案 {file_path} 時發生錯誤: {str(e)}")
        time.sleep(1)  # 每秒檢查一次

# 靜態檔案服務
@app.route('/')
def index():
    return serve_main_page()

@app.route('/<path:path>')
def static_files(path):
    # 先檢查是否在static資料夾中
    static_path = os.path.join(app.static_folder, path)
    if os.path.exists(static_path) and os.path.isfile(static_path):
        return send_from_directory(app.static_folder, path)
    
    # 否則嘗試從當前資料夾提供檔案
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(current_dir, path)) and os.path.isfile(os.path.join(current_dir, path)):
        return send_from_directory(current_dir, path)
        
    # 如果都不是，嘗試返回index.html
    return serve_main_page()

def serve_main_page():
    """提供主頁面"""
    # 優先檢查static資料夾中是否有index.html
    static_index = os.path.join(app.static_folder, 'index.html')
    if os.path.exists(static_index):
        print(f"Found static index: {static_index}") 
        return send_from_directory(app.static_folder, 'index.html')
    
    # 否則提供當前目錄中的vibe-coding.html
    current_dir = os.path.dirname(os.path.abspath(__file__))
    vibe_page = os.path.join(current_dir, 'vibe-coding.html')
    if os.path.exists(vibe_page):
        return send_from_directory(current_dir, 'vibe-coding.html')
    
    # 如果都沒有，返回簡單的HTML訊息
    return "<html><body><h1>Vibe Coding Tool</h1><p>主頁面未找到，請確保static資料夾中有index.html或當前目錄有vibe-coding.html</p></body></html>"

# API 端點
@app.route('/api/workspace', methods=['POST'])
def set_workspace():
    """設定當前工作目錄"""
    data = request.json
    directory = data.get('path')
    
    if not directory or not os.path.isdir(directory):
        return jsonify({'success': False, 'error': '無效的目錄路徑'}), 400
    
    global current_workspace
    current_workspace = directory
    
    return jsonify({'success': True, 'path': directory})

@app.route('/api/files', methods=['GET'])
def get_files():
    """獲取工作目錄中的檔案清單"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    files = get_file_list(current_workspace, SUPPORTED_EXTENSIONS)
    return jsonify({'success': True, 'files': files})

@app.route('/api/file', methods=['GET'])
def get_file_content():
    """獲取檔案內容"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    file_path = request.args.get('path')
    
    if not file_path:
        return jsonify({'success': False, 'error': '未指定檔案路徑'}), 400
    
    # 防止路徑遍歷攻擊
    if not is_path_safe(current_workspace, file_path):
        return jsonify({'success': False, 'error': '無效的檔案路徑'}), 403
    
    full_path = os.path.join(current_workspace, file_path)
    
    if not os.path.isfile(full_path):
        return jsonify({'success': False, 'error': '檔案不存在'}), 404
    
    try:
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # 創建備份 (首次打開檔案時)
        create_file_backup(full_path)
        
        return jsonify({'success': True, 'content': content, 'path': file_path})
    except Exception as e:
        return jsonify({'success': False, 'error': f'讀取檔案時發生錯誤: {str(e)}'}), 500

@app.route('/api/file', methods=['PUT'])
def update_file_content():
    """更新檔案內容"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    data = request.json
    file_path = data.get('path')
    content = data.get('content')
    
    if not file_path or content is None:
        return jsonify({'success': False, 'error': '缺少必要參數'}), 400
    
    # 防止路徑遍歷攻擊
    if not is_path_safe(current_workspace, file_path):
        return jsonify({'success': False, 'error': '無效的檔案路徑'}), 403
    
    full_path = os.path.join(current_workspace, file_path)
    
    # 檢查檔案是否存在
    if not os.path.isfile(full_path):
        return jsonify({'success': False, 'error': '檔案不存在'}), 404
    
    try:
        # 更新緩存而不是直接寫入檔案
        file_cache[full_path] = content
        last_save_time[full_path] = time.time()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': f'更新檔案時發生錯誤: {str(e)}'}), 500

@app.route('/api/file/save', methods=['POST'])
def force_save_file():
    """強制保存檔案"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    data = request.json
    file_path = data.get('path')
    
    if not file_path:
        return jsonify({'success': False, 'error': '缺少檔案路徑'}), 400
    
    # 防止路徑遍歷攻擊
    if not is_path_safe(current_workspace, file_path):
        return jsonify({'success': False, 'error': '無效的檔案路徑'}), 403
    
    full_path = os.path.join(current_workspace, file_path)
    
    if full_path not in file_cache:
        return jsonify({'success': False, 'error': '沒有待保存的變更'}), 400
    
    try:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(file_cache[full_path])
        
        # 從緩存中移除
        file_cache.pop(full_path, None)
        last_save_time.pop(file_path, None)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': f'保存檔案時發生錯誤: {str(e)}'}), 500

@app.route('/api/llm/models', methods=['GET'])
def get_llm_models():
    """獲取可用的 LLM 模型"""
    return jsonify({'success': True, 'models': LLM_MODELS})

@app.route('/api/llm/query', methods=['POST'])
def llm_query():
    """向 LLM 提交查詢"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    data = request.json
    prompt = data.get('prompt')
    files = data.get('files', [])
    model_id = data.get('model')
    
    if not prompt:
        return jsonify({'success': False, 'error': '缺少提示詞'}), 400
    
    if not model_id:
        return jsonify({'success': False, 'error': '缺少模型 ID'}), 400
    
    try:
        # 這裡包裝請求發送給LLM API，您需要替換為實際的API端點和認證方式
        # 這是一個示例實現
        llm_request = {
            'model': model_id,
            'messages': [
                {'role': 'system', 'content': '你是一個幫助分析和改進代碼的助手。請以git風格提出修改建議。'},
                {'role': 'user', 'content': format_llm_request(prompt, files)}
            ],
            'temperature': 0.7
        }
        
        # 這是LLM API的調用，需要根據公司內部的API進行修改
        # response = requests.post('https://your-llm-api-endpoint/completions', json=llm_request)
        # llm_response = response.json()['choices'][0]['message']['content']
        
        # 由於這是示例，我們模擬一個響應
        llm_response = "這是模擬的LLM響應。在實際使用時，這裡會包含LLM返回的代碼修改建議，使用git風格的差異格式。"
        
        # 將LLM響應發送給LLM應用程序進行處理
        processed_result = process_with_llm_app(llm_response, files)
        
        return jsonify({
            'success': True, 
            'response': llm_response,
            'changes': processed_result
        })
    except Exception as e:
        logger.error(f"LLM查詢時發生錯誤: {str(e)}")
        return jsonify({'success': False, 'error': f'LLM查詢時發生錯誤: {str(e)}'}), 500

@app.route('/api/diff', methods=['GET'])
def get_file_diff():
    """獲取檔案變更差異"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    file_path = request.args.get('path')
    
    if not file_path:
        return jsonify({'success': False, 'error': '未指定檔案路徑'}), 400
    
    # 防止路徑遍歷攻擊
    if not is_path_safe(current_workspace, file_path):
        return jsonify({'success': False, 'error': '無效的檔案路徑'}), 403
    
    full_path = os.path.join(current_workspace, file_path)
    backup_filename = os.path.basename(full_path) + ".backup"
    backup_path = os.path.join(TEMP_DIR, backup_filename)
    
    if not os.path.isfile(full_path) or not os.path.isfile(backup_path):
        return jsonify({'success': False, 'error': '無法比較檔案，原始備份不存在'}), 404
    
    try:
        # 讀取原始檔案
        with open(backup_path, 'r', encoding='utf-8', errors='ignore') as f:
            original_content = f.readlines()
        
        # 讀取當前檔案
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            current_content = f.readlines()
        
        # 產生差異
        diff = difflib.unified_diff(
            original_content, 
            current_content,
            fromfile=f'a/{file_path}',
            tofile=f'b/{file_path}',
            lineterm=''
        )
        
        diff_text = '\n'.join(diff)
        
        return jsonify({
            'success': True, 
            'diff': diff_text,
            'original': ''.join(original_content),
            'current': ''.join(current_content)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'產生差異時發生錯誤: {str(e)}'}), 500

@app.route('/api/llm/apply-changes', methods=['POST'])
def apply_git_changes():
    """應用Git風格變更到檔案"""
    if not current_workspace:
        return jsonify({'success': False, 'error': '未選擇工作目錄'}), 400
    
    data = request.json
    changes = data.get('changes')
    
    if not changes:
        return jsonify({'success': False, 'error': '未提供變更內容'}), 400
    
    try:
        # 創建臨時檔案來存儲變更
        patch_file = os.path.join(TEMP_DIR, 'changes.patch')
        with open(patch_file, 'w', encoding='utf-8') as f:
            f.write(changes)
        
        # 使用git apply來應用變更
        result = subprocess.run(
            ['git', 'apply', '--reject', '--whitespace=fix', patch_file],
            cwd=current_workspace,
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            logger.error(f"應用變更失敗: {result.stderr}")
            return jsonify({
                'success': False, 
                'error': f'應用變更失敗: {result.stderr}'
            }), 500
        
        # 獲取受影響的檔案清單
        affected_files = []
        for line in result.stdout.split('\n'):
            if line.startswith('patching file '):
                file_path = line.replace('patching file ', '').strip()
                affected_files.append(file_path)
        
        return jsonify({
            'success': True,
            'message': '變更已成功應用',
            'affected_files': affected_files
        })
    except Exception as e:
        logger.error(f"應用變更時發生錯誤: {str(e)}")
        return jsonify({'success': False, 'error': f'應用變更時發生錯誤: {str(e)}'}), 500

def format_llm_request(prompt, files):
    """格式化發送給LLM的請求"""
    request_text = f"{prompt}\n\n"
    request_text += "以下是相關代碼文件：\n\n"
    
    for file in files:
        request_text += f"文件: {file['path']}\n"
        request_text += "```\n"
        request_text += file['content']
        request_text += "\n```\n\n"
    
    request_text += "請分析這些代碼，並以git差異的格式提出改進建議。"
    return request_text

def process_with_llm_app(llm_response, files):
    """將LLM回應發送給LLM應用程序進行處理"""
    try:
        # 构建要发送给LLM应用的数据
        app_request = {
            'llm_response': llm_response,
            'files': files
        }
        
        # 这里是调用LLM应用的代码，需要根据实际情况修改
        # response = requests.post(LLM_APP_ENDPOINT, json=app_request)
        # if response.status_code == 200:
        #     return response.json()
        # else:
        #     logger.error(f"LLM應用處理失敗: {response.text}")
        #     return {'error': 'LLM應用處理失敗'}
        
        # 由於這是示例，模擬一個回應
        return {
            'changes': '模擬的git變更內容',
            'affected_files': [file['path'] for file in files]
        }
    except Exception as e:
        logger.error(f"調用LLM應用時發生錯誤: {str(e)}")
        return {'error': f'調用LLM應用時發生錯誤: {str(e)}'}

if __name__ == '__main__':
    # 定義伺服器地址和端口
    host = 'localhost'
    port = 5487
    url = f"http://{host}:{port}/" # Flask 預設會從根目錄提供 vibe-coding.html

    # 啟動自動保存線程
    auto_save_thread = threading.Thread(target=auto_save_thread, daemon=True)
    auto_save_thread.start()

    # 定義一個函數來開啟瀏覽器
    def open_browser():
        """稍微延遲後開啟瀏覽器，確保伺服器已啟動"""
        time.sleep(1) # 等待 1 秒，讓伺服器有時間啟動
        print(f"嘗試在瀏覽器開啟: {url}")
        webbrowser.open_new_tab(url)

    # 建立一個線程來執行開啟瀏覽器的函數
    # 將 daemon 設為 True，這樣主程序退出時該線程也會退出
    browser_thread = threading.Thread(target=open_browser, daemon=True)
    browser_thread.start()

    # 啟動Flask伺服器
    print(f"Vibe Coding Tool 伺服器啟動於 {url}")
    # 注意：這裡的 use_reloader=True 可能會導致腳本運行兩次
    # 如果瀏覽器開了兩次，可以考慮在開發完成後將其設為 False 或移除
    run_simple(host, port, app, use_reloader=True, use_debugger=True)