import { useState, useRef } from 'react';
import { uploadDocuments } from '../utils/api';
import './UploadForm.css';

export default function UploadForm({ onUploadComplete }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const droppedFiles = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
    if (droppedFiles.length > 0) setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileChange = (e) => {
    const selected = [...e.target.files];
    setFiles(prev => [...prev, ...selected]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setStatus(null);
    try {
      const result = await uploadDocuments(files);
      setStatus({ type: 'success', message: result.message });
      setFiles([]);
      if (onUploadComplete) onUploadComplete(result.documents);
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-form">
      <div
        className={`drop-zone ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileChange}
          hidden
        />
        <div className="drop-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
          </svg>
        </div>
        <p className="drop-text">Drag & drop PDFs here or <span>browse</span></p>
        <p className="drop-hint">Supports multiple files, max 25 MB each</p>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, i) => (
            <div key={i} className="file-item">
              <span className="file-icon">📄</span>
              <span className="file-name">{file.name}</span>
              <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="file-remove" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>✕</button>
            </div>
          ))}
          <button className="upload-btn" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <><span className="spinner"></span> Processing...</>
            ) : (
              `Upload ${files.length} file${files.length > 1 ? 's' : ''}`
            )}
          </button>
        </div>
      )}

      {status && (
        <div className={`upload-status ${status.type}`}>
          {status.message}
        </div>
      )}
    </div>
  );
}
