import os
import shutil
from pathlib import Path
import logging
from flask import Flask

# 配置日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log')
    ]
)
logger = logging.getLogger('vibe-coding-tool')

def setup_app():
    """設置應用環境"""
    logger.info("開始設置應用環境...")
    
    # 創建必要的目錄
    static_dir = Path('./static')
    static_dir.mkdir(exist_ok=True)
    
    # 複製前端文件到靜態目錄
    try:
        # 複製 HTML
        with open('./templates/index.html', 'r', encoding='utf-8') as src_file:
            html_content = src_file.read()
        
        with open(static_dir / 'index.html', 'w', encoding='utf-8') as dst_file:
            dst_file.write(html_content)
        
        # 複製 CSS
        with open('./templates/styles.css', 'r', encoding='utf-8') as src_file:
            css_content = src_file.read()
        
        with open(static_dir / 'styles.css', 'w', encoding='utf-8') as dst_file:
            dst_file.write(css_content)
        
        # 複製 JS
        with open('./templates/scripts.js', 'r', encoding='utf-8') as src_file:
            js_content = src_file.read()
        
        with open(static_dir / 'scripts.js', 'w', encoding='utf-8') as dst_file:
            dst_file.write(js_content)
        
        logger.info("靜態文件準備完成")
    except Exception as e:
        logger.error(f"靜態文件準備失敗: {str(e)}")
        raise
    
    # 檢查環境變數
    required_env_vars = ['LLM_API_URL', 'LLM_API_KEY']
    missing_vars = [var for var in required_env_vars if not os.environ.get(var)]
    
    if missing_vars:
        logger.warning(f"缺少環境變數: {', '.join(missing_vars)}")
        logger.warning("將使用默認值，這可能不適用於生產環境")
    
    logger.info("應用環境設置完成")

def create_app():
    """創建並配置 Flask 應用"""
    # 先設置環境
    setup_app()
    
    # 導入主應用模組
    from server import app as application
    
    # 額外的生產環境配置
    if os.environ.get('ENVIRONMENT') == 'production':
        application.config['DEBUG'] = False
        application.config['TESTING'] = False
        # 其他生產環境配置...
    
    return application

# 創建應用
app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    
    logger.info(f"啟動應用，監聽於 {host}:{port}")
    app.run(host=host, port=port)
