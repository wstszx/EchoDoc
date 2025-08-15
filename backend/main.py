import os
import uuid
import shutil
import fitz  # PyMuPDF
import pythoncom
import win32com.client
import random
import sys
import asyncio
from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Path Configuration ---
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def convert_docx_to_pdf(docx_path, pdf_path):
    """
    Converts a .docx file to a .pdf file using Word COM object.
    This function is intended to be run in a separate thread.
    """
    word = None
    doc = None
    pythoncom.CoInitialize()
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        doc = word.Documents.Open(docx_path, ReadOnly=True)
        
        wdExportFormatPDF = 17
        doc.ExportAsFixedFormat(
            OutputFileName=pdf_path,
            ExportFormat=wdExportFormatPDF
        )
        return True
    except Exception as e:
        print(f"Error during DOCX to PDF conversion: {e}", file=sys.stderr)
        return False
    finally:
        if doc:
            doc.Close(False)
        if word:
            word.Quit()
        pythoncom.CoUninitialize()

@app.post("/api/upload")
async def upload_and_convert_document(file: UploadFile = File(...)):
    doc_id = str(uuid.uuid4())
    doc_dir = os.path.join(UPLOAD_DIR, doc_id)
    pages_dir = os.path.join(doc_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)

    docx_path = os.path.join(doc_dir, "original.docx")
    pdf_path = os.path.join(doc_dir, "full_document.pdf")

    with open(docx_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    loop = asyncio.get_event_loop()
    success = await loop.run_in_executor(
        None, convert_docx_to_pdf, docx_path, pdf_path
    )

    if not success:
        shutil.rmtree(doc_dir)  # Clean up on failure
        raise HTTPException(status_code=500, detail="Failed to convert document to PDF. Ensure Microsoft Word is installed on the server.")

    if not os.path.exists(pdf_path):
        shutil.rmtree(doc_dir)  # Clean up on failure
        raise HTTPException(status_code=500, detail="PDF file was not created despite conversion process reporting success.")

    try:
        # Split the PDF into single pages
        with fitz.open(pdf_path) as pdf_doc:
            total_pages = len(pdf_doc)
            for i in range(total_pages):
                single_page_pdf = fitz.open()
                single_page_pdf.insert_pdf(pdf_doc, from_page=i, to_page=i)
                page_path = os.path.join(pages_dir, f"{i + 1}.pdf")
                single_page_pdf.save(page_path)
                single_page_pdf.close()
    except Exception as e:
        shutil.rmtree(doc_dir)  # Clean up on failure
        raise HTTPException(status_code=500, detail=f"Failed to read and split the converted PDF file: {e}")
    finally:
        # Clean up the full PDF and original docx to save space
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        if os.path.exists(docx_path):
            os.remove(docx_path)

    num_test_pages = min(total_pages, 50)
    test_pages = sorted(random.sample(range(1, total_pages + 1), num_test_pages))

    return {"doc_id": doc_id, "total_pages": total_pages, "test_pages": test_pages}


@app.get("/api/pages/{doc_id}/{page_number}")
async def get_page_from_pdf(doc_id: str, page_number: int):
    page_path = os.path.join(UPLOAD_DIR, doc_id, "pages", f"{page_number}.pdf")

    if not os.path.exists(page_path):
        raise HTTPException(status_code=404, detail="Page not found. It may not have been generated or the doc_id is incorrect.")

    try:
        with open(page_path, "rb") as f:
            pdf_bytes = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read page file: {e}")

    return Response(content=pdf_bytes, media_type="application/pdf")


@app.get("/")
def read_root():
    return {"message": "Backend is running with on-upload PDF conversion and proper COM handling."}