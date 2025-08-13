import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE_URL = 'http://127.0.0.1:8000';

function App() {
    const [file, setFile] = useState(null);
    const [docInfo, setDocInfo] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState('');
    const [status, setStatus] = useState('idle'); // idle, uploading, converting, ready, error
    const [error, setError] = useState('');

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleUpload = async () => {
        if (!file) {
            alert('Please select a .docx file.');
            return;
        }
        setStatus('uploading');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                throw new Error('Upload failed. Please check the server.');
            }
            const data = await response.json();
            setDocInfo(data);
            setCurrentPage(1);
            setStatus('converting');
        } catch (err) {
            setStatus('error');
            setError(err.message);
        }
    };

    const fetchPage = useCallback(async () => {
        if (!docInfo) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/pages/${docInfo.doc_id}/${currentPage}`);
            const data = await response.json();

            if (response.status === 500) {
                throw new Error(data.detail || 'Failed to render page.');
            }

            if (data.status === 'converting') {
                setStatus('converting');
                // The effect below will handle polling
            } else if (data.status === 'ready') {
                setPageContent(data.page_content);
                setStatus('ready');
            }
        } catch (err) {
            setStatus('error');
            setError(err.message);
        }
    }, [docInfo, currentPage]);

    useEffect(() => {
        if (status === 'converting') {
            const timer = setTimeout(() => {
                fetchPage();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [status, fetchPage]);
    
    useEffect(() => {
        if (docInfo) {
            fetchPage();
        }
    }, [docInfo, currentPage, fetchPage]);


    const goToPage = (page) => {
        if (page > 0 && page <= docInfo.total_pages) {
            setCurrentPage(page);
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
                    <button onClick={handleUpload} disabled={status === 'uploading' || status === 'converting'}>
                        {status === 'uploading' ? 'Uploading...' : 'Upload Document'}
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
                            <h2>Highlights</h2>
                            <ul className="highlights-list">
                                {docInfo.highlights.map((h) => (
                                    <li key={`${h.page}-${h.text}`} onClick={() => goToPage(h.page)}>
                                        Page {h.page}: {h.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="page-viewer">
                            <div className="page-controls">
                                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
                                    Previous
                                </button>
                                <span>Page {currentPage} of {docInfo.total_pages}</span>
                                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= docInfo.total_pages}>
                                    Next
                                </button>
                            </div>
                            <div className="page-display">
                                {status === 'converting' && <div className="loader">Converting document... please wait.</div>}
                                {status === 'ready' && <img src={pageContent} alt={`Page ${currentPage}`} />}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
