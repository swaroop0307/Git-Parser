import './CitationModal.css';

export default function CitationModal({ source, onClose }) {
  if (!source) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">📄</span>
            <div>
              <h3>{source.source}</h3>
              <p className="modal-subtitle">Page {source.page} {source.score ? `· ${(source.score * 100).toFixed(1)}% match` : ''}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <label className="modal-label">Extracted Document Chunk</label>
          <div className="modal-snippet-box">
            <pre>{source.fullText || source.snippet || source.text}</pre>
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn-primary" onClick={onClose}>Close Preview</button>
        </div>
      </div>
    </div>
  );
}
