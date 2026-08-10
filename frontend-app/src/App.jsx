import { useState } from 'react';
import AuthPage from './components/AuthPage';
import ChatBox from './components/ChatBox';
import UploadForm from './components/UploadForm';
import DocumentList from './components/DocumentList';
import { isLoggedIn, logout } from './utils/api';
import './App.css';

function App() {
  const [user, setUser] = useState(isLoggedIn() ? { email: 'user' } : null);
  const [refreshDocs, setRefreshDocs] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleAuth = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  const handleUploadComplete = () => {
    setRefreshDocs(prev => prev + 1);
  };

  if (!user) {
    return <AuthPage onAuth={handleAuth} />;
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="12" fill="url(#grad2)" />
              <path d="M12 14h16M12 20h12M12 26h8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="grad2" x1="0" y1="0" x2="40" y2="40">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <span>Smart Doc Q&A</span>
          </div>
        </div>

        <div className="sidebar-section">
          <UploadForm onUploadComplete={handleUploadComplete} />
        </div>

        <div className="sidebar-divider"></div>

        <div className="sidebar-section sidebar-docs">
          <DocumentList refreshTrigger={refreshDocs} />
        </div>

        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-avatar">👤</span>
            <span className="user-email">{user.email}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Toggle Button */}
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(p => !p)}>
        {sidebarOpen ? '◀' : '▶'}
      </button>

      {/* Main Chat Area */}
      <main className="main-content">
        <ChatBox />
      </main>
    </div>
  );
}

export default App;
