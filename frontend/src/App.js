import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = 'http://127.0.0.1:8000';

function App() {
    const [file, setFile] = useState(null);
    const [docInfo, setDocInfo] = useState(null);
    const [pages, setPages] = useState([]); // [{ pageNumber, content, status: 'loading'|'ready'|'error' }]
    const [globalStatus, setGlobalStatus] = useState('idle'); // idle, uploading, loading, ready, error
    const [error, setError] = useState('');

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        // 当选择新文件时，清理所有旧状态
        setDocInfo(null);
        setPages([]);
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
        } catch (err) {
            setGlobalStatus('error');
            setError(err.message);
        }
    };

    // Effect to fetch pages when docInfo is available
    useEffect(() => {
        if (!docInfo) return;

        const fetchPageContent = async (docId, pageNumber) => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/pages/${docId}/${pageNumber}`);
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || `Failed to render page ${pageNumber}.`);
                }
                return { pageNumber, content: data.page_content, status: 'ready' };
            } catch (err) {
                return { pageNumber, content: null, status: 'error', error: err.message };
            }
        };

        setGlobalStatus('loading');
        // 初始化页面状态为 loading
        const initialPages = docInfo.test_pages.map(p => ({ pageNumber: p, content: null, status: 'loading' }));
        setPages(initialPages);

        const fetchPromises = docInfo.test_pages.map(p => fetchPageContent(docInfo.doc_id, p));

        Promise.allSettled(fetchPromises).then(results => {
            setGlobalStatus('ready');
            setPages(currentPages => {
                const newPages = [...currentPages];
                results.forEach(result => {
                    if (result.status === 'fulfilled') {
                        const { pageNumber, content, status, error } = result.value;
                        const pageIndex = newPages.findIndex(p => p.pageNumber === pageNumber);
                        if (pageIndex !== -1) {
                            newPages[pageIndex] = { ...newPages[pageIndex], content, status, error };
                        }
                    } else {
                        // Handle promise rejection if necessary, though fetchPageContent catches errors
                        console.error("A fetch promise was rejected:", result.reason);
                    }
                });
                return newPages;
            });
        });

    }, [docInfo]);

    // Effect for cleanup
    useEffect(() => {
        const docToClose = docInfo;
        return () => {
            if (docToClose) {
                console.log(`Requesting to close document: ${docToClose.doc_id}`);
                fetch(`${API_BASE_URL}/api/close/${docToClose.doc_id}`, {
                    method: 'POST',
                    keepalive: true
                });
            }
        };
    }, [docInfo]);

    const goToPage = (pageNumber) => {
        const element = document.getElementById(`page-container-${pageNumber}`);
        if (element) {
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
                    <button onClick={handleUpload} disabled={globalStatus === 'uploading' || globalStatus === 'loading'}>
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
                            {globalStatus === 'loading' && <p>Loading...</p>}
                            <ul className="highlights-list">
                                {docInfo.test_pages.map((p) => (
                                    <li key={p} onClick={() => goToPage(p)}>
                                        Page {p}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="page-viewer-scrollable">
                            {pages.map(({ pageNumber, content, status, error: pageError }) => (
                                <div key={pageNumber} id={`page-container-${pageNumber}`} className="page-container">
                                    <h4>Page {pageNumber}</h4>
                                    <div className="page-display">
                                        {status === 'loading' && <div className="loader">Loading page...</div>}
                                        {status === 'ready' && content && <img src={content} alt={`Page ${pageNumber}`} />}
                                        {status === 'error' && <div className="error-message">Failed to load: {pageError}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
