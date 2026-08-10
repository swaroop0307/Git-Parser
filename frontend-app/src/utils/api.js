const API_BASE = 'http://localhost:5000/api';

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

async function request(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (let browser set it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }

  return data;
}

// --- Auth ---
export async function register(email, password) {
  const data = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function login(email, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export function logout() {
  clearToken();
}

export function isLoggedIn() {
  return !!getToken();
}

// --- Documents ---
export async function uploadDocuments(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('documents', file);
  }
  return request('/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function listDocuments() {
  return request('/documents');
}

export async function deleteDocument(id) {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

// --- RAG Chat ---
export async function askQuestion(question) {
  return request('/chat/query', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

/**
 * Real-time SSE streaming RAG query reader
 */
export async function streamQuestion(question, { onToken, onSources, onError, onDone }) {
  const token = getToken();
  try {
    const response = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `Streaming failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'sources' && onSources) {
              onSources(data.sources);
            } else if (data.type === 'token' && onToken) {
              onToken(data.token);
            } else if (data.type === 'error' && onError) {
              onError(data.error);
            } else if (data.type === 'done' && onDone) {
              onDone();
            }
          } catch (e) {
            console.error('Failed to parse SSE payload:', e);
          }
        }
      }
    }

    if (onDone) onDone();
  } catch (err) {
    if (onError) onError(err.message);
  }
}
