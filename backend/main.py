import os
import uuid
import shutil
import base64
import fitz  # PyMuPDF
import random
import pythoncom
import win32com.client
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sys

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 全局缓存，用于存储打开的 Word 实例
# 格式: { "doc_id": {"app": word_app, "doc": doc_object} }
OPEN_DOCUMENTS = {}

def get_word_page_count(file_path):
    """
    使用 win32com 来获取 Word 文档的页数。
    这是一个独立的、一次性的操作，用于上传时获取总页数。
    """
    word = None
    doc = None
    try:
        pythoncom.CoInitialize()
        abs_path = os.path.abspath(file_path)
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        doc = word.Documents.Open(abs_path, ReadOnly=True)
        page_count = doc.ComputeStatistics(2)
        return page_count
    except Exception as e:
        print(f"使用 win32com 获取页数时发生错误: {e}", file=sys.stderr)
        return 0
    finally:
        if doc:
            doc.Close(False)
        if word:
            word.Quit()
        pythoncom.CoUninitialize()

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    doc_id = str(uuid.uuid4())
    docx_path = os.path.join(UPLOAD_DIR, f"{doc_id}.docx")

    with open(docx_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    total_pages = get_word_page_count(docx_path)
    print(f"检测到文档 '{file.filename}' 的总页数为: {total_pages}")
    if total_pages == 0:
        raise HTTPException(status_code=500, detail="无法计算文档页数。请确保服务器上已安装 Microsoft Word。")

    num_test_pages = min(total_pages, 50)
    test_pages = sorted(random.sample(range(1, total_pages + 1), num_test_pages))

    return {"doc_id": doc_id, "total_pages": total_pages, "test_pages": test_pages}


@app.get("/api/pages/{doc_id}/{page_number}")
async def get_page(doc_id: str, page_number: int):
    docx_path = os.path.join(UPLOAD_DIR, f"{doc_id}.docx")
    temp_pdf_path = os.path.join(UPLOAD_DIR, f"{doc_id}_page_{page_number}.pdf")

    if not os.path.exists(docx_path):
        raise HTTPException(status_code=404, detail="文档未找到")

    doc = None
    try:
        # 检查文档是否已在缓存中打开
        if doc_id not in OPEN_DOCUMENTS:
            print(f"缓存未命中: 为 {doc_id} 打开新的 Word 实例。")
            pythoncom.CoInitialize()
            word_app = win32com.client.Dispatch("Word.Application")
            word_app.Visible = False
            doc_obj = word_app.Documents.Open(os.path.abspath(docx_path), ReadOnly=True)
            OPEN_DOCUMENTS[doc_id] = {"app": word_app, "doc": doc_obj}
        else:
            print(f"缓存命中: 为 {doc_id} 复用已有的 Word 实例。")
        
        doc = OPEN_DOCUMENTS[doc_id]["doc"]
        
        # 使用已打开的文档对象导出页面
        wdExportFormatPDF = 17
        wdExportFromTo = 3
        doc.ExportAsFixedFormat(
            OutputFileName=os.path.abspath(temp_pdf_path),
            ExportFormat=wdExportFormatPDF,
            Range=wdExportFromTo,
            From=page_number,
            To=page_number
        )
    except Exception as e:
        print(f"处理页面 {page_number} 时发生 COM 错误: {e}", file=sys.stderr)
        # 如果发生错误，尝试清理缓存的实例
        close_document_instance(doc_id)
        raise HTTPException(status_code=500, detail=f"与 Word 应用交互时发生错误: {e}")

    # --- PDF 到 PNG 的转换 ---
    if not os.path.exists(temp_pdf_path):
        raise HTTPException(status_code=500, detail="创建临时 PDF 文件失败。")

    try:
        pdf_doc = fitz.open(temp_pdf_path)
        page = pdf_doc.load_page(0)
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        pdf_doc.close()

        return {"status": "ready", "page_content": f"data:image/png;base64,{img_base64}"}
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)


@app.post("/api/close/{doc_id}")
async def close_document(doc_id: str):
    """关闭并清理指定的 Word 文档实例。"""
    close_document_instance(doc_id)
    return {"status": "closed", "doc_id": doc_id}

def close_document_instance(doc_id: str):
    if doc_id in OPEN_DOCUMENTS:
        print(f"正在关闭文档实例: {doc_id}")
        instance = OPEN_DOCUMENTS.pop(doc_id)
        doc = instance["doc"]
        app = instance["app"]
        try:
            doc.Close(False)
            app.Quit()
            # CoUninitialize 需要在创建 COM 对象的同一线程中调用
            # 在这个简单的缓存模型中，我们依赖 FastAPI 的线程管理
        except Exception as e:
            print(f"关闭 Word 实例 {doc_id} 时发生错误: {e}", file=sys.stderr)

@app.get("/")
def read_root():
    return {"message": "Backend is running with cached on-demand page conversion."}