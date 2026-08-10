import { useState, useRef, useEffect } from 'react';
import { streamQuestion } from '../utils/api';
import CitationModal from './CitationModal';
import './ChatBox.css';

export default function ChatBox() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeCitation, setActiveCitation] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg = { role: 'user', content: question };
    const initialAssistantMsg = { role: 'assistant', content: '', sources: [] };

    setMessages(prev => [...prev, userMsg, initialAssistantMsg]);
    const assistantIndex = messages.length + 1; // index of assistant msg

    setInput('');
    setLoading(true);

    let streamText = '';

    await streamQuestion(question, {
      onSources: (sources) => {
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIndex]) {
            updated[assistantIndex] = { ...updated[assistantIndex], sources };
          }
          return updated;
        });
      },
      onToken: (token) => {
        streamText += token;
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIndex]) {
            updated[assistantIndex] = { ...updated[assistantIndex], content: streamText };
          }
          return updated;
        });
      },
      onError: (errMessage) => {
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIndex]) {
            updated[assistantIndex] = {
              ...updated[assistantIndex],
              content: updated[assistantIndex].content || `Error: ${errMessage}`
            };
          }
          return updated;
        });
      },
      onDone: () => {
        setLoading(false);
        inputRef.current?.focus();
      }
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-box">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Ask a question about your documents</h3>
            <p>Upload PDFs first, then ask anything. Answers stream in real-time with source citations.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-body">
              <div className="message-content">
                {msg.content || (msg.role === 'assistant' && loading && i === messages.length - 1 ? (
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                ) : null)}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="message-sources">
                  <button
                    className="sources-toggle"
                    onClick={(e) => {
                      const panel = e.currentTarget.nextElementSibling;
                      panel.classList.toggle('expanded');
                    }}
                  >
                    📎 {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} cited
                  </button>
                  <div className="sources-panel">
                    {msg.sources.map((src, j) => (
                      <div
                        key={j}
                        className="source-card clickable"
                        onClick={() => setActiveCitation(src)}
                        title="Click to view full chunk preview"
                      >
                        <div className="source-header">
                          <span className="source-file">📄 {src.source}</span>
                          <span className="source-page">Page {src.page}</span>
                          {src.score && <span className="source-score">{(src.score * 100).toFixed(1)}%</span>}
                        </div>
                        <p className="source-snippet">{src.snippet || src.text}</p>
                        <span className="source-preview-hint">View full chunk →</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask a question about your documents..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" strokeLinecap="round" strokeLinejoin="round" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {activeCitation && (
        <CitationModal
          source={activeCitation}
          onClose={() => setActiveCitation(null)}
        />
      )}
    </div>
  );
}
