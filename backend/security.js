const GITHUB_URL_REGEX = /^https:\/\/github\.com\/([a-zA-Z0-9-_.]+)\/([a-zA-Z0-9-_.]+)(?:\.git)?\/?$/;

/**
 * Validates a GitHub repository URL against a strict regex to prevent command injection
 * and verify that it matches a public HTTPS GitHub repository pattern.
 * @param {string} url - The URL to validate.
 * @returns {string} The normalized HTTPS cloning URL.
 * @throws {Error} If the URL is invalid.
 */
function validateGithubUrl(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Repository URL must be a non-empty string.");
  }
  
  const cleanUrl = url.trim();
  
  // Strict check for shell escape characters to deny injection attempts
  const illegalChars = [";", "&&", "||", "`", "$", "|", ">", "<", "\n"];
  if (illegalChars.some(char => cleanUrl.includes(char))) {
    throw new Error("Invalid URL contains illegal command shell characters.");
  }
  
  const match = cleanUrl.match(GITHUB_URL_REGEX);
  if (!match) {
    throw new Error(
      "Invalid GitHub URL. Must be a public HTTPS URL, e.g., 'https://github.com/owner/repo' or 'https://github.com/owner/repo.git'"
    );
  }
  
  const owner = match[1];
  let repo = match[2];
  
  // Normalize by stripping .git from repository group if present
  if (repo.endsWith(".git")) {
    repo = repo.slice(0, -4);
  }
  
  return `https://github.com/${owner}/${repo}.git`;
}

module.exports = {
  validateGithubUrl
};
// ES Modules export fallback is not needed as we use standard CommonJS in Node.js
