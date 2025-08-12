from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import shutil
import random
import base64
import threading
import time
from docx2pdf import convert
import fitz  # PyMuPDF

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

# --- Background Conversion ---
def convert_in_background(docx_path, pdf_path):
    """Converts DOCX to PDF in a separate thread."""
    try:
        print(f"Starting background conversion: {docx_path} -> {pdf_path}")
        convert(docx_path, pdf_path)
        print(f"Finished background conversion: {docx_path}")
    except Exception as e:
        # If conversion fails, we can create a placeholder or log the error
        print(f"Error during DOCX to PDF conversion: {e}")
        # To prevent endless waiting, we could write an error file
        error_file = pdf_path + ".error"
        with open(error_file, "w") as f:
            f.write(str(e))

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Accepts a .docx file, saves it, and starts a background conversion to PDF.
    Returns immediately with an estimated page count.
    """
    doc_id = str(uuid.uuid4())
    docx_path = os.path.join(UPLOAD_DIR, f"{doc_id}.docx")
    pdf_path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")

    with open(docx_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Start the conversion in a background thread so the API can respond immediately
    conversion_thread = threading.Thread(target=convert_in_background, args=(docx_path, pdf_path))
    conversion_thread.start()

    # --- Page Count Estimation ---
    # For a fast initial response, we estimate the page count.
    # A real app might use a more sophisticated estimation or update the count later.
    # For this demo, a random number suffices.
    estimated_pages = random.randint(50, 150)
    highlights = [
        {"page": random.randint(1, estimated_pages), "text": f"Highlight on page {i}"}
        for i in range(1, 15)
    ]
    highlights.sort(key=lambda x: x['page'])

    return {"doc_id": doc_id, "total_pages": estimated_pages, "highlights": highlights}


@app.get("/api/pages/{doc_id}/{page_number}")
async def get_page(doc_id: str, page_number: int):
    """
    Renders a specific page from a PDF document into a Base64 PNG image.
    Handles cases where the PDF is still being converted.
    """
    pdf_path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")
    error_file = pdf_path + ".error"

    # Check if conversion failed
    if os.path.exists(error_file):
        with open(error_file, "r") as f:
            error_message = f.read()
        raise HTTPException(status_code=500, detail=f"Document conversion failed: {error_message}")

    # Wait for the PDF to be created, with a timeout
    timeout = 30  # seconds
    start_time = time.time()
    while not os.path.exists(pdf_path):
        if time.time() - start_time > timeout:
            return {"status": "converting", "page_content": None}
        time.sleep(0.5)

    try:
        doc = fitz.open(pdf_path)
        # PyMuPDF uses 0-based indexing
        page_index = page_number - 1
        if not (0 <= page_index < doc.page_count):
            doc.close()
            raise HTTPException(status_code=404, detail="Page not found")

        page = doc.load_page(page_index)
        pix = page.get_pixmap(dpi=150)  # Render page to an image
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')

        doc.close()
        return {
            "status": "ready",
            "page_content": f"data:image/png;base64,{img_base64}"
        }
    except Exception as e:
        print(f"Error rendering page {page_number} for {doc_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to render page: {e}")

@app.get("/")
def read_root():
    return {"message": "Backend is running with stable docx2pdf + PyMuPDF rendering."}
    return {"message": "Backend is running with stable docx2pdf + PyMuPDF rendering."}