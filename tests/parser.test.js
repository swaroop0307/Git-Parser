const fs = require("fs");
const path = require("path");
const os = require("os");
const { calculateLineNumbers, splitText, parseRepository } = require("../backend/parser");

describe("Parser & Splitting Unit Tests", () => {
  
  test("calculateLineNumbers correctly identifies line range in file content", () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5";
    
    // Test typical case
    const chunk = "line 2\nline 3";
    const { startLine, endLine } = calculateLineNumbers(content, chunk);
    expect(startLine).toBe(2);
    expect(endLine).toBe(3);
    
    // Test single-line chunk
    const singleChunk = "line 4";
    const res = calculateLineNumbers(content, singleChunk);
    expect(res.startLine).toBe(4);
    expect(res.endLine).toBe(4);
    
    // Test fallback for missing chunk
    const missingChunk = "non-existent text";
    const fallback = calculateLineNumbers(content, missingChunk);
    expect(fallback.startLine).toBe(1);
    expect(fallback.endLine).toBe(5);
  });

  test("splitText splits content recursively using language separators", () => {
    const code = "class MathUtils:\n    def add(x, y):\n        return x + y";
    const separators = ["class ", "def ", "\n", " "];
    
    const chunks = splitText(code, separators, 30, 5);
    
    expect(chunks.length).toBeGreaterThan(1);
    // Make sure all parts are present
    const combined = chunks.join("");
    expect(combined).toContain("MathUtils");
    expect(combined).toContain("add");
  });

  test("parseRepository walks directories and filters binaries, lockfiles, and symlinks", () => {
    // Set up unique temp folder to simulate repository
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jest-test-repo-"));
    
    try {
      // 1. Create valid source file
      fs.writeFileSync(path.join(tempDir, "app.js"), "function init() { console.log('hello'); }");
      
      // 2. Create ignored file types
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "icon.png"), "binary content data");
      
      // 3. Parse simulated directory
      const documents = parseRepository(tempDir, "https://github.com/mock/repo.git");
      
      // 4. Assertions
      const filePaths = documents.map(d => d.metadata.file_path);
      expect(filePaths).toContain("app.js");
      expect(filePaths).not.toContain("package-lock.json");
      expect(filePaths).not.toContain("icon.png");
      
      // Verify metadata schema
      const doc = documents.find(d => d.metadata.file_path === "app.js");
      expect(doc).toBeDefined();
      expect(doc.metadata.repo_url).toBe("https://github.com/mock/repo.git");
      expect(doc.metadata.filename).toBe("app.js");
      expect(doc.metadata.language).toBe("js");
      expect(doc.metadata.start_line).toBe(1);
    } finally {
      // Clean workspace
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
