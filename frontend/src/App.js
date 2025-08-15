import React, { useState, useEffect, useReducer, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './App.css';

const API_BASE_URL = 'http://127.0.0.1:8000';

pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.js`;

// --- State Management ---
function pagesReducer(state, action) {
    switch (action.type) {
        case 'INIT_PAGES':
            return action.payload.map(p => ({ pageNumber: p, content: null, status: 'pending' }));
        case 'PAGES_LOADING':
            return state.map(p =>
                action.payload.includes(p.pageNumber) ? { ...p, status: 'loading' } : p
            );
        case 'PAGE_LOADED':
            return state.map(p =>
                p.pageNumber === action.payload.pageNumber ? { ...p, content: action.payload.content, status: 'ready' } : p
            );
        case 'PAGES_LOADED':
            return state.map(p => {
                const loadedPage = action.payload.find(lp => lp.pageNumber === p.pageNumber);
                return loadedPage ? { ...p, content: loadedPage.content, status: 'ready' } : p;
            });
        case 'PAGE_ERROR':
            return state.map(p =>
                p.pageNumber === action.payload.pageNumber ? { ...p, status: 'error', error: action.payload.error } : p
            );
        case 'PAGES_ERROR':
             return state.map(p =>
                action.payload.pageNumbers.includes(p.pageNumber) ? { ...p, status: 'error', error: action.payload.error } : p
            );
        case 'UNLOAD_PAGE':
            const pageToUnload = state.find(p => p.pageNumber === action.payload);
            if (pageToUnload && pageToUnload.content) {
                URL.revokeObjectURL(pageToUnload.content);
            }
            return state.map(p =>
                p.pageNumber === action.payload ? { ...p, content: null, status: 'pending' } : p
            );
        case 'RESET':
            state.forEach(page => {
                if (page.content) {
                    URL.revokeObjectURL(page.content);
                }
            });
            return [];
        default:
            return state;
    }
}

// --- Data Fetching Logic (decoupled from component) ---
// --- Data Fetching Logic: Parallel fetching ---
async function fetchPagesConcurrently(dispatch, docId, pagesToLoad) {
    if (!pagesToLoad || pagesToLoad.length === 0) return;

    const pageNumbersToLoad = pagesToLoad.map(p => p.pageNumber);
    dispatch({ type: 'PAGES_LOADING', payload: pageNumbersToLoad });

    const fetchPromises = pagesToLoad.map(async (page) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/pages/${docId}/${page.pageNumber}`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || `HTTP error! status: ${response.status}`);
            }
            const blob = await response.blob();
            const fileUrl = URL.createObjectURL(blob);
            return { pageNumber: page.pageNumber, content: fileUrl, status: 'success' };
        } catch (error) {
            return { pageNumber: page.pageNumber, error: error.message, status: 'error' };
        }
    });

    const results = await Promise.all(fetchPromises);

    const successfulPages = results.filter(r => r.status === 'success');
    if (successfulPages.length > 0) {
        dispatch({ type: 'PAGES_LOADED', payload: successfulPages });
    }

    const failedPages = results.filter(r => r.status === 'error');
    if (failedPages.length > 0) {
        const errorPayload = {
            pageNumbers: failedPages.map(p => p.pageNumber),
            error: failedPages.map(p => `Page ${p.pageNumber}: ${p.error}`).join(', ')
        };
        dispatch({ type: 'PAGES_ERROR', payload: errorPayload });
    }
}


function PdfPage({ pageData }) {
    const { pageNumber, content, status, error } = pageData;

    return (
        <div id={`page-container-${pageNumber}`} data-page-number={pageNumber} className="page-container">
            <h4>Page {pageNumber}</h4>
            <div className="page-display">
                {status === 'loading' && <div className="loader">Loading page...</div>}
                {status === 'ready' && content && (
                    <Document file={content} error={<div className="error-message">Failed to load PDF file.</div>}>
                        <Page pageNumber={1} />
                    </Document>
                )}
                {status === 'error' && <div className="error-message">Failed to load: {error}</div>}
                {status === 'pending' && <div className="loader" style={{ height: '1000px' }}></div>}
            </div>
        </div>
    );
}

function App() {
    const [file, setFile] = useState(null);
    const [docInfo, setDocInfo] = useState(null);
    const [pages, dispatch] = useReducer(pagesReducer, []);
    const [globalStatus, setGlobalStatus] = useState('idle');
    const [error, setError] = useState('');
    const [visiblePages, setVisiblePages] = useState(new Set());
    const scrollableContainerRef = useRef(null);

    // Effect to setup the IntersectionObserver
    useEffect(() => {
        const container = scrollableContainerRef.current;
        if (!container || globalStatus !== 'ready') return;

        const options = {
            root: container,
            rootMargin: '500px 0px', // Preload pages that are 500px away from the viewport
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            setVisiblePages(prevVisible => {
                const newVisible = new Set(prevVisible);
                entries.forEach(entry => {
                    const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
                    if (entry.isIntersecting) {
                        newVisible.add(pageNum);
                    } else {
                        newVisible.delete(pageNum);
                    }
                });
                return newVisible;
            });
        }, options);

        const pageElements = container.querySelectorAll('.page-container');
        pageElements.forEach(el => observer.observe(el));

        return () => {
            observer.disconnect();
        };
    }, [globalStatus]); // Re-init observer when a new doc is loaded

    // Effect to load/unload pages based on visibility
    useEffect(() => {
        if (!docInfo || visiblePages.size === 0) return;

        const sortedVisible = Array.from(visiblePages).sort((a, b) => a - b);
        const minVisible = sortedVisible[0];
        const maxVisible = sortedVisible[sortedVisible.length - 1];

        const PAGE_RANGE = 10; // Number of pages to load before/after visible area
        const UNLOAD_THRESHOLD = 20; // Unload pages that are this far away

        const startToLoad = Math.max(1, minVisible - PAGE_RANGE);
        const endToLoad = Math.min(docInfo.total_pages, maxVisible + PAGE_RANGE);

        // Load pages in the desired range
        const pagesToLoad = pages.filter(p =>
            p.pageNumber >= startToLoad && p.pageNumber <= endToLoad && p.status === 'pending'
        );
        if (pagesToLoad.length > 0) {
            fetchPagesConcurrently(dispatch, docInfo.doc_id, pagesToLoad);
        }

        // Unload pages far outside the desired range
        pages.forEach(page => {
            if (
                page.status === 'ready' &&
                (page.pageNumber < minVisible - UNLOAD_THRESHOLD || page.pageNumber > maxVisible + UNLOAD_THRESHOLD)
            ) {
                dispatch({ type: 'UNLOAD_PAGE', payload: page.pageNumber });
            }
        });

    }, [visiblePages, docInfo, pages, dispatch]);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setDocInfo(null);
        dispatch({ type: 'RESET' });
        setGlobalStatus('idle');
        setError('');
    };

    const handleUpload = async () => {
        if (!file) {
            alert('Please select a .docx file.');
            return;
        }
        setGlobalStatus('uploading');
        setError('');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Upload failed. Please check the server.');
            }
            const data = await response.json();
            setDocInfo(data);
            const allPageNumbers = Array.from({ length: data.total_pages }, (_, i) => i + 1);
            dispatch({ type: 'INIT_PAGES', payload: allPageNumbers });
            setGlobalStatus('ready');
        } catch (err) {
            setGlobalStatus('error');
            setError(err.message);
        }
    };

    const goToPage = (pageNumber) => {
        const element = document.getElementById(`page-container-${pageNumber}`);
        if (element) {
            const page = pages.find(p => p.pageNumber === pageNumber);
            if (page && page.status === 'pending') {
                // Eagerly load the page if it's not loaded, even if not in the current visible range
                fetchPagesConcurrently(dispatch, docInfo.doc_id, [page]);
            }
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <div className="App">
            <header className="App-header">
                <h1>EchoDoc Viewer</h1>
            </header>
            <main>
                <div className="upload-section">
                    <input type="file" accept=".docx" onChange={handleFileChange} />
                    <button onClick={handleUpload} disabled={globalStatus === 'uploading'}>
                        {globalStatus === 'uploading' ? 'Uploading...' : 'Upload Document'}
                    </button>
                </div>

                {error && <div className="error-message">Error: {error}</div>}

                {docInfo && (
                    <div className="viewer-section">
                        <div className="sidebar">
                            <h2>Document Info</h2>
                            <p><strong>ID:</strong> {docInfo.doc_id}</p>
                            <p><strong>Pages:</strong> {docInfo.total_pages}</p>
                            <hr />
                            <h2>Test Pages</h2>
                            <p>Total to load: {docInfo.test_pages.length}</p>
                            <ul className="highlights-list">
                                {docInfo.test_pages.map((p) => (
                                    <li key={p} onClick={() => goToPage(p)}>
                                        Page {p}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="page-viewer-scrollable" ref={scrollableContainerRef}>
                            {pages.map((page) => (
                                <PdfPage
                                    key={page.pageNumber}
                                    pageData={page}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;