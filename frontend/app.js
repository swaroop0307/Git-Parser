const BACKEND_URL = "http://localhost:8000";

// State Management
let activeRepo = "";

// DOM Selectors
const repoUrlInput = document.getElementById("repo-url-input");
const indexBtn = document.getElementById("index-btn");
const indexStatus = document.getElementById("index-status");
const activeRepoBadge = document.getElementById("active-repo-badge");
const chatHistory = document.getElementById("chat-history");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const quickPromptsPanel = document.getElementById("quick-prompts");

// Ingestion Panel Action
indexBtn.addEventListener("click", async () => {
  const url = repoUrlInput.value.trim();
  if (!url) {
    showIndexStatus("Please enter a valid GitHub URL.", "error");
    return;
  }
  
  // Update UI state to loading
  indexBtn.disabled = true;
  repoUrlInput.disabled = true;
  showIndexStatus("Cloning, checking size limits, parsing, and embedding... This may take up to a minute.", "loading");
  
  try {
    const res = await fetch(`${BACKEND_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_url: url })
    });
    
    const data = await res.json();
    
    if (res.status === 200) {
      activeRepo = data.repo_url;
      showIndexStatus(`Successfully indexed ${data.chunks_indexed} code chunks!`, "success");
      
      // Update badge
      const displayUrl = activeRepo.replace("https://github.com/", "").replace(".git", "");
      activeRepoBadge.textContent = displayUrl;
      activeRepoBadge.className = "badge success";
      
      // Enable chat controls
      chatInput.disabled = false;
      sendBtn.disabled = false;
      chatInput.placeholder = "Ask a question about the repository...";
      
      // Clear previous chats
      clearChatHistory();
    } else {
      showIndexStatus(data.detail || "Ingestion failed.", "error");
      resetIngestionControls();
    }
  } catch (error) {
    showIndexStatus(`Network error: ${error.message}`, "error");
    resetIngestionControls();
  }
});

// Setup click actions on Suggested prompts
document.querySelectorAll(".sug-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const query = btn.getAttribute("data-query");
    if (!activeRepo) {
      alert("Please index a repository first!");
      return;
    }
    chatInput.value = query;
    triggerSendMessage();
  });
});

// Chat Controls Action
sendBtn.addEventListener("click", () => {
  triggerSendMessage();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    triggerSendMessage();
  }
});

function triggerSendMessage() {
  const query = chatInput.value.trim();
  if (!query) return;
  
  chatInput.value = "";
  
  // Hide suggestions if showing
  if (quickPromptsPanel) {
    quickPromptsPanel.style.display = "none";
  }
  
  // 1. Render User message
  appendMessageBubble("user", query);
  
  // 2. Prepare Assistant message bubble placeholders
  const assistantBubble = appendMessageBubble("assistant", "");
  const textContainer = assistantBubble.querySelector(".msg-text");
  const sourcesContainer = assistantBubble.querySelector(".sources-container");
  
  // 3. Initiate SSE Streaming
  startSSEStream(query, textContainer, sourcesContainer);
}

// SSE Streaming Fetch implementation
async function startSSEStream(query, textContainer, sourcesContainer) {
  textContainer.innerHTML = "<em>Thinking...</em>";
  
  try {
    const response = await fetch(`${BACKEND_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_url: activeRepo, question: query })
    });
    
    if (response.status !== 200) {
      const data = await response.json();
      textContainer.innerHTML = `<span style="color:var(--error)">Error: ${data.detail || "RAG retrieval request failed."}</span>`;
      return;
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let rawAnswer = "";
    
    textContainer.innerHTML = ""; // Clear loader
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep last incomplete line in the buffer
      buffer = lines.pop();
      
      for (const line of lines) {
          const cleaned = line.trim();
          if (cleaned.startsWith("data: ")) {
              try {
                  const eventData = JSON.parse(cleaned.substring(6));
                  
                  if (eventData.event === "sources") {
                      renderReferences(eventData.data, sourcesContainer);
                  } else if (eventData.event === "token") {
                      rawAnswer += eventData.data;
                      textContainer.innerHTML = formatMarkdown(rawAnswer) + "▌";
                  } else if (eventData.event === "error") {
                      textContainer.innerHTML = `<span style="color:var(--error)">Error: ${eventData.data}</span>`;
                  } else if (eventData.event === "done") {
                      break;
                  }
              } catch (e) {
                  // Catch JSON parse errors on partial chunks
              }
          }
      }
    }
    
    // Clean typing caret at the end
    textContainer.innerHTML = formatMarkdown(rawAnswer);
    scrollChat();
  } catch (error) {
    textContainer.innerHTML = `<span style="color:var(--error)">Connection error: ${error.message}</span>`;
  }
}

// Custom simple markdown formatter
function formatMarkdown(text) {
  let html = text;
  
  // Escape HTML tags to prevent cross-site scripting (XSS)
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  // Format code blocks ```lang ... ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  
  // Format Headers
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  
  // Format bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Format inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  
  // Format double newline to paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  
  // Single newline to linebreaks
  html = html.replace(/\n/g, "<br>");
  
  return `<p>${html}</p>`;
}

// Helpers
function showIndexStatus(text, type) {
  indexStatus.textContent = text;
  indexStatus.className = `status-box ${type}`;
}

function resetIngestionControls() {
  indexBtn.disabled = false;
  repoUrlInput.disabled = false;
}

function clearChatHistory() {
  // Keep only suggestions on initial state
  chatHistory.innerHTML = "";
}

function appendMessageBubble(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  
  const avatar = role === "user" ? "👨‍💻" : "🧬";
  
  bubble.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="msg-content">
      <div class="msg-text">${content}</div>
      <div class="sources-container"></div>
    </div>
  `;
  
  chatHistory.appendChild(bubble);
  scrollChat();
  return bubble;
}

function renderReferences(sources, container) {
  if (!sources || sources.length === 0) return;
  
  const expander = document.createElement("details");
  expander.className = "sources-expander";
  
  expander.innerHTML = `
    <summary>🔍 Inspected Code References (${sources.length})</summary>
    <div class="sources-list"></div>
  `;
  
  const list = expander.querySelector(".sources-list");
  
  sources.forEach(src => {
    const item = document.createElement("div");
    item.className = "source-item";
    item.innerHTML = `
      <div class="source-title">📄 <b>${src.file_path}</b> (Lines ${src.start_line}-${src.end_line})</div>
      <pre><code>${escapeHTML(src.code_snippet)}</code></pre>
    `;
    list.appendChild(item);
  });
  
  container.appendChild(expander);
  scrollChat();
}

function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scrollChat() {
  chatHistory.scrollTop = chatHistory.scrollHeight;
}
