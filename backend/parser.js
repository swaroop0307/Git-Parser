const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

// Mapping of file extensions to language names for lookup and metadata
const EXTENSION_TO_LANG = {
  ".py": "python",
  ".js": "js",
  ".jsx": "js",
  ".ts": "ts",
  ".tsx": "ts",
  ".go": "go",
  ".cpp": "cpp",
  ".c": "cpp",
  ".cc": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".java": "java",
  ".html": "html",
  ".css": "css",
  ".md": "markdown",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "bash"
};

// Structural separators mimicking RecursiveCharacterTextSplitter.from_language
const LANGUAGE_SEPARATORS = {
  python: ["\nclass ", "\ndef ", "\n\tdef ", "\n\n", "\n", " ", ""],
  js: ["\nclass ", "\nfunction ", "\nconst ", "\nlet ", "\nvar ", "\n\n", "\n", " ", ""],
  ts: ["\nclass ", "\ninterface ", "\nfunction ", "\nconst ", "\nlet ", "\nvar ", "\n\n", "\n", " ", ""],
  go: ["\nfunc ", "\ntype ", "\n\n", "\n", " ", ""],
  cpp: ["\nclass ", "\nstruct ", "\nvoid ", "\nint ", "\n\n", "\n", " ", ""],
  java: ["\nclass ", "\npublic ", "\nprivate ", "\n\n", "\n", " ", ""],
  html: ["\n<div", "\n<p", "\n\n", "\n", " ", ""],
  css: ["\n.", "\n#", "\n\n", "\n", " ", ""],
  markdown: ["\n# ", "\n## ", "\n### ", "\n\n", "\n", " ", ""],
  text: ["\n\n", "\n", " ", ""]
};

// Directories to ignore
const IGNORED_DIRS = new Set([
  ".git", ".github", ".vscode", ".idea", "node_modules", "bower_components",
  "venv", ".venv", "env", "__pycache__", "build", "dist", "out", "target",
  "testdata", "fixtures", "mocks", "site-packages", "eggs"
]);

// Extension blacklists
const IGNORED_EXTENSIONS = new Set([
  // Images & Media
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".mp4", ".mp3", ".wav",
  // Archives & Binaries
  ".zip", ".tar", ".gz", ".rar", ".7z", ".bin", ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".pyc", ".pyd",
  // Documents
  ".pdf", ".docx", ".xlsx", ".pptx",
  // Fonts
  ".woff", ".woff2", ".ttf", ".eot",
  // Lockfiles
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "cargo.lock", "gemfile.lock", "composer.lock"
]);

/**
 * Calculates start and end lines (1-based) of chunkContent in the original fileContent.
 */
function calculateLineNumbers(fileContent, chunkContent) {
  const idx = fileContent.indexOf(chunkContent);
  if (idx === -1) {
    return { startLine: 1, endLine: fileContent.split("\n").length };
  }
  
  // Count lines before index
  const startLine = fileContent.substring(0, idx).split("\n").length;
  const endLine = startLine + chunkContent.split("\n").length - 1;
  return { startLine, endLine };
}

/**
 * Recursively splits a block of text using separators.
 */
function splitText(text, separators, maxChunkSize = 1500, overlap = 200) {
  const chunks = [];
  
  function split(textToSplit, separatorIdx) {
    if (textToSplit.length <= maxChunkSize) {
      chunks.push(textToSplit);
      return;
    }
    
    if (separatorIdx >= separators.length) {
      // Fallback: chunk size force splitting
      let start = 0;
      while (start < textToSplit.length) {
        chunks.push(textToSplit.substring(start, start + maxChunkSize));
        start += maxChunkSize - overlap;
        if (start >= textToSplit.length || maxChunkSize <= overlap) break;
      }
      return;
    }
    
    const separator = separators[separatorIdx];
    const parts = textToSplit.split(separator);
    
    let currentChunk = "";
    for (let part of parts) {
      const neededSpace = currentChunk.length + part.length + (currentChunk ? separator.length : 0);
      if (neededSpace > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
          const overlapStart = Math.max(0, currentChunk.length - overlap);
          currentChunk = currentChunk.substring(overlapStart) + (currentChunk ? separator : "") + part;
        } else {
          // If single part is larger than maxChunkSize, split it using next separator
          split(part, separatorIdx + 1);
        }
      } else {
        currentChunk = currentChunk + (currentChunk ? separator : "") + part;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
  }
  
  split(text, 0);
  return chunks;
}

/**
 * Clones a public Git repository. Shallow clones for performance.
 */
async function cloneRepository(repoUrl, destDir) {
  try {
    const git = simpleGit();
    await git.clone(repoUrl, destDir, ["--depth", "1"]);
  } catch (error) {
    throw new Error(
      `Git clone failed. Ensure repository is public and URL is correct. Details: ${error.message}`
    );
  }
}

/**
 * Traverses directories recursively, applying guardrails and collecting files.
 */
function walkRepository(dir, clonePath, filesList = [], metrics = { fileCount: 0, totalSize: 0 }) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (IGNORED_DIRS.has(item) || item.startsWith(".")) continue;
    
    const fullPath = path.join(dir, item);
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch (e) {
      continue; // Unreadable file
    }
    
    // Security Guard: Skip symlinks to prevent Host directory traversals
    if (stat.isSymbolicLink()) {
      continue;
    }
    
    if (stat.isDirectory()) {
      walkRepository(fullPath, clonePath, filesList, metrics);
    } else {
      const ext = path.extname(item).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext) || IGNORED_EXTENSIONS.has(item.toLowerCase())) {
        continue;
      }
      
      const fileSize = stat.size;
      const maxSingleSize = parseInt(process.env.MAX_SINGLE_FILE_SIZE_BYTES || 5242880);
      if (fileSize > maxSingleSize) {
        continue; // Skip single files exceeding max limit
      }
      
      metrics.totalSize += fileSize;
      const maxRepoSize = parseInt(process.env.MAX_REPO_SIZE_MB || 50) * 1024 * 1024;
      if (metrics.totalSize > maxRepoSize) {
        throw new Error(
          `Repository total size exceeds the allowed limit of ${process.env.MAX_REPO_SIZE_MB || 50}MB.`
        );
      }
      
      metrics.fileCount += 1;
      const maxFileCount = parseInt(process.env.MAX_FILE_COUNT || 1000);
      if (metrics.fileCount > maxFileCount) {
        throw new Error(
          `Repository file count exceeds the allowed limit of ${process.env.MAX_FILE_COUNT || 1000} files.`
        );
      }
      
      filesList.push({
        fullPath,
        relPath: path.relative(clonePath, fullPath).replace(/\\/g, "/"),
        filename: item,
        ext
      });
    }
  }
  return filesList;
}

/**
 * Main parse logic: walks, filters, reads files, chunks them, and returns document objects.
 */
function parseRepository(cloneDir, repoUrl) {
  const files = walkRepository(cloneDir, cloneDir);
  const documents = [];
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file.fullPath, { encoding: "utf-8" });
      const languageName = EXTENSION_TO_LANG[file.ext] || "text";
      const separators = LANGUAGE_SEPARATORS[languageName] || LANGUAGE_SEPARATORS.text;
      
      const chunks = splitText(content, separators, 1500, 200);
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        
        const { startLine, endLine } = calculateLineNumbers(content, chunk);
        documents.push({
          page_content: chunk,
          metadata: {
            repo_url: repoUrl,
            file_path: file.relPath,
            filename: file.filename,
            language: languageName,
            start_line: startLine,
            end_line: endLine
          }
        });
      }
    } catch (e) {
      // Safe logging, skip single file read errors
      console.warn(`Warning: failed to parse file ${file.relPath}: ${e.message}`);
    }
  }
  
  return documents;
}

module.exports = {
  calculateLineNumbers,
  splitText,
  cloneRepository,
  parseRepository
};
