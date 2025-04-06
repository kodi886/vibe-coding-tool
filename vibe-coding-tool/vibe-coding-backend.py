import os
import json
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import requests
from pathlib import Path

app = Flask(__name__, static_folder='static')

# 配置
class Config:
    LLM_API_URL = os.environ.get('LLM_API_URL', 'http://internal-api.company.com/llm')
    LLM_API_KEY = os.environ.get('LLM_API_KEY', 'your-api-key')
    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
    ALLOWED_EXTENSIONS = {'txt', 'py', 'js', 'html', 'css', 'json', 'md', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'rs', 'php', 'ts', 'jsx', 'tsx'}

app.config.from_object(Config)

# 全局變數
WORKSPACE_PATH = None

# 工具函數
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def is_path_in_workspace(path):
    if not WORKSPACE_PATH:
        return False
    
    # 轉換為絕對路徑
    abs_path = os.path.abspath(path)
    abs_workspace = os.path.abspath(WORKSPACE_PATH)
    
    # 檢查是否在工作空間內
    return abs_path.startswith(abs_workspace)

def validate_path(path):
    # 確保路徑是安全的
    if '..' in path or path.startswith('/'):
        return False
    
    # 確保路徑存在且在工作空間內
    full_path = os.path.join(WORKSPACE_PATH, path) if WORKSPACE_PATH else path
    if not os.path.exists(full_path) or not is_path_in_workspace(full_path):
        return False
    
    return True

# 路由：主頁
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# 路由：設置工作空間
@app.route('/api/workspace', methods=['POST'])
def set_workspace():
    global WORKSPACE_PATH
    
    data = request.json
    if not data or 'path' not in data:
        return jsonify({'error': 'Missing path parameter'}), 400
    
    path = data['path']
    if not os.path.isdir(path):
        return jsonify({'error': 'Invalid directory path'}), 400
    
    WORKSPACE_PATH = path
    
    # 獲取所有檔案
    files = []
    try:
        for root, _, filenames in os.walk(path):
            for filename in filenames:
                if allowed_file(filename):
                    rel_path = os.path.relpath(os.path.join(root, filename), path)
                    files.append(rel_path)
    except Exception as e:
        return jsonify({'error': f'Failed to scan directory: {str(e)}'}), 500
    
    return jsonify({'success': True, 'files': files})

# 路由：獲取檔案列表
@app.route('/api/files', methods=['GET'])
def get_files():
    if not WORKSPACE_PATH:
        return jsonify({'error': 'Workspace not set'}), 400
    
    files = []
    try:
        for root, _, filenames in os.walk(WORKSPACE_PATH):
            for filename in filenames:
                if allowed_file(filename):
                    rel_path = os.path.relpath(os.path.join(root, filename), WORKSPACE_PATH)
                    files.append(rel_path)
    except Exception as e:
        return jsonify({'error': f'Failed to scan directory: {str(e)}'}), 500
    
    return jsonify({'files': files})

# 路由：獲取檔案內容
@app.route('/api/file', methods=['GET'])
def get_file():
    if not WORKSPACE_PATH:
        return jsonify({'error': 'Workspace not set'}), 400
    
    path = request.args.get('path')
    if not path:
        return jsonify({'error': 'Missing path parameter'}), 400
    
    if not validate_path(path):
        return jsonify({'error': 'Invalid or unsafe path'}), 400
    
    full_path = os.path.join(WORKSPACE_PATH, path)
    
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return jsonify({'error': f'Failed to read file: {str(e)}'}), 500
    
    return jsonify({'content': content})

# 路由：更新檔案內容
@app.route('/api/file', methods=['PUT'])
def update_file():
    if not WORKSPACE_PATH:
        return jsonify({'error': 'Workspace not set'}), 400
    
    data = request.json
    if not data or 'path' not in data or 'content' not in data:
        return jsonify({'error': 'Missing path or content parameters'}), 400
    
    path = data['path']
    content = data['content']
    
    if not validate_path(path):
        return jsonify({'error': 'Invalid or unsafe path'}), 400
    
    full_path = os.path.join(WORKSPACE_PATH, path)
    
    try:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
    except Exception as e:
        return jsonify({'error': f'Failed to write file: {str(e)}'}), 500
    
    return jsonify({'success': True})

# 路由：獲取可用模型
@app.route('/api/llm/models', methods=['GET'])
def get_models():
    try:
        response = requests.get(
            f"{app.config['LLM_API_URL']}/models",
            headers={'Authorization': f"Bearer {app.config['LLM_API_KEY']}"}
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch models from LLM API'}), 500
        
        return jsonify({'models': response.json()['models']})
    except Exception as e:
        return jsonify({'error': f'Error fetching models: {str(e)}'}), 500

# 路由：發送查詢到 LLM
@app.route('/api/llm/query', methods=['POST'])
def query_llm():
    if not request.json:
        return jsonify({'error': 'Missing JSON data'}), 400
    
    prompt = request.json.get('prompt', '')
    files = request.json.get('files', [])
    model_id = request.json.get('model', '')
    
    if not prompt:
        return jsonify({'error': 'Missing prompt'}), 400
    
    # 準備發送到 LLM API 的數據
    payload = {
        'model': model_id,
        'prompt': prompt,
        'files': files,
        'temperature': 0.7,
        'max_tokens': 4000
    }
    
    try:
        response = requests.post(
            f"{app.config['LLM_API_URL']}/generate",
            headers={
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {app.config['LLM_API_KEY']}"
            },
            json=payload
        )
        
        if response.status_code != 200:
            return jsonify({'error': f'LLM API error: {response.text}'}), 500
        
        llm_response = response.json()
        
        return jsonify({'response': llm_response.get('text', '')})
    except Exception as e:
        return jsonify({'error': f'Error communicating with LLM API: {str(e)}'}), 500

# 啟動應用
if __name__ == '__main__':
    # 確保靜態文件夾存在
    os.makedirs(app.static_folder, exist_ok=True)
    
    # 開發模式下啟用熱重載和調試
    app.run(debug=True, host='0.0.0.0', port=5000)
