import { useState, useEffect } from 'react';
import { listDocuments, deleteDocument } from '../utils/api';
import './DocumentList.css';

export default function DocumentList({ refreshTrigger }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const data = await listDocuments();
      setDocs(data.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [refreshTrigger]);

  const handleDelete = async (id) => {
    try {
      await deleteDocument(id);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  return (
    <div className="doc-list">
      <h3 className="doc-list-title">Your Documents</h3>
      {loading && <p className="doc-loading">Loading...</p>}
      {!loading && docs.length === 0 && (
        <p className="doc-empty">No documents uploaded yet.</p>
      )}
      {docs.map(doc => (
        <div key={doc.id} className="doc-card">
          <div className="doc-info">
            <span className="doc-icon">📄</span>
            <div>
              <p className="doc-name">{doc.filename}</p>
              <p className="doc-meta">{doc.totalPages} pages · {doc.chunksIndexed} chunks</p>
            </div>
          </div>
          <button className="doc-delete" onClick={() => handleDelete(doc.id)} title="Delete">
            🗑️
          </button>
        </div>
      ))}
    </div>
  );
}
