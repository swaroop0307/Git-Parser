# GitHub Repository RAG Explainer (Node.js & HTML/CSS/JS)

A complete, production-ready, interview-grade Retrieval-Augmented Generation (RAG) system designed to index, parse, and explain GitHub repositories. This implementation uses a **Node.js/Express** backend and a **Vanilla HTML/CSS/JS** single-page frontend.

---

## Architectural & Interview Highlights

If demonstrating this project to a technical interviewer, highlight these engineering practices:

1. **Vanilla JS UI with High Aesthetics**: Built entirely using clean HTML, Vanilla CSS, and JavaScript. No bulky frameworks are loaded. The styling implements rich dark-theme variables, glassmorphic cards, smooth button transitions, and customized Details/Summary elements for source file citations.
2. **End-to-End SSE Streaming**: Queries stream responses token-by-token using the OpenAI Chat Completions API in Node.js. The client leverages the native browser `fetch` and `ReadableStreamDefaultReader` interfaces to capture and display tokens instantly with a real-time caret-typing effect.
3. **Safe Ingestion (Security & Scale)**:
   - **Shell Injection Protections**: Checks repo URLs against a strict regular expression to block arguments and dangerous shell commands before execution.
   - **Shallow Cloning**: Minimizes network bandwidth by requesting a git clone depth of 1 (`--depth 1`).
   - **Symlink Guard**: PreventsHost file system directory traversal attacks by scanning and ignoring symbolic links during traversal.
   - **Scale Guards**: Aborts indexing if the cumulative repo file count exceeds 1000 or the directory size exceeds 50MB.
4. **SQLite write lock**: ChromaDB SQLite backend does not allow concurrent writes. The Express app locks the `/index` endpoint dynamically using a boolean mutex flag, ensuring that multiple users indexing repos are run sequentially.
5. **RAG Evaluation Suite**: Includes `tests/run_eval.js` which performs automated self-indexing of the project code, calculates Precision@5 retrieval rates, and requests a GPT-4o-mini judge call to score completeness and faithfulness on a 1-5 rubric.

---

## Directory Structure

```text
/
├── backend/
│   ├── security.js       # URL validation and shell sanitization
│   ├── parser.js         # Git cloner & code walking / language-aware chunking
│   ├── indexer.js        # ChromaDB API connection & batch document uploads
│   ├── retriever.js      # Semantic vector search & OpenAI SSE streaming helpers
│   └── server.js         # Express routes, SSE headers, and SQLite write lock
├── frontend/
│   ├── index.html        # Main dashboard structure
│   ├── style.css         # Customized premium dark-theme stylesheet
│   └── app.js            # Fetch SSE stream reader, suggestions, and DOM handlers
├── tests/
│   ├── test_parser.js    # Jest unit tests for the parser and security filters
│   └── run_eval.js       # Automated RAG evaluation suite (Precision@5 + Judge LLM)
├── package.json          # Node scripts and package dependencies
├── .env.example          # Template environment config
└── README.md             # Systems documentation (this file)
```

---

## Local Setup Instructions

### 1. Prerequisites
- **Node.js** v18+
- **Git**
- **ChromaDB** running locally. You can run ChromaDB in Python or via Docker:
  ```bash
  # Python method
  pip install chromadb
  chroma run --path ./db
  ```

### 2. Configure Environment
Clone the project and create a local `.env` configuration:

```bash
copy .env.example .env
```

Open the `.env` file and insert your OpenAI API key:
```env
OPENAI_API_KEY=sk-proj-yourOpenAiApiKeyHere...
CHROMADB_URL=http://localhost:8000
```

### 3. Install Dependencies
Run npm install in the project root:

```bash
npm install
```

---

## Running the Application

### 1. Start the Node.js Server
Start the Express server:

```bash
npm start
```
The server will run on port 8000. You can query the health endpoint to check status: [http://localhost:8000/health](http://localhost:8000/health).

### 2. Launch the Web Interface
Simply open `frontend/index.html` in your web browser. You can do this by dragging the file into any browser tab or using a simple local server extension.

---

## Testing & Evaluation

### 1. Run Parser Unit Tests
Run Jest tests to verify line number calculations and security exclusions:

```bash
npm test
```

### 2. Run the Evaluation Suite
Runs a self-contained RAG validation on this codebase:

```bash
node tests/run_eval.js
```
This indexes the local files, queries them against standard questions, and outputs retrieval metrics along with LLM-as-a-Judge quality scores.
