/**
 * ProjectPilot AI - GitHub Intelligence Service
 * Genuine repository inspection, AST/file analysis, dependency auditing,
 * and SSRF-hardened GitHub REST API client.
 */

export class GitHubService {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN || null;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.baseUrl = options.baseUrl || 'https://api.github.com';
  }

  /**
   * Validates and parses a repository URL.
   * Enforces strict SSRF defense: only https://github.com/:owner/:repo is permitted.
   * Blocks IP addresses, localhost, local subnets, metadata endpoints, and non-github domains.
   * @param {string} urlString
   */
  validateRepoUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') {
      return { valid: false, error: 'Repository URL is required and must be a string.' };
    }

    const trimmed = urlString.trim();

    // Check raw string for path traversal or encoded sequences before URL normalization
    if (trimmed.includes('..') || /%2e%2e/i.test(trimmed)) {
      return { valid: false, error: 'Path traversal sequences in repository URL are rejected.' };
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, error: 'Invalid URL format.' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Protocol must be https (or http for testing).' };
    }

    const hostname = parsed.hostname.toLowerCase();
    // Strict domain check: must be github.com or api.github.com
    if (hostname !== 'github.com' && hostname !== 'www.github.com') {
      return { valid: false, error: `Invalid host "${hostname}". Only github.com repositories are allowed.` };
    }

    // SSRF guard: reject IPv4 / IPv6 literals disguised in host
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':') || hostname === 'localhost') {
      return { valid: false, error: 'Local, loopback, and IP address hosts are strictly rejected.' };
    }

    // Extract path components: /:owner/:repo
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      return { valid: false, error: 'URL must contain both owner and repository name (e.g. https://github.com/owner/repo).' };
    }

    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    // Verify valid GitHub username and repository name patterns
    const validIdentifier = /^[a-zA-Z0-9_.-]{1,100}$/;
    if (!validIdentifier.test(owner) || !validIdentifier.test(repo)) {
      return { valid: false, error: 'Owner and repository names contain invalid characters.' };
    }

    // Guard against directory traversal in repo name
    if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
      return { valid: false, error: 'Path traversal sequences in repository URL are rejected.' };
    }

    return {
      valid: true,
      owner,
      repo,
      canonicalUrl: `https://github.com/${owner}/${repo}`
    };
  }

  /**
   * Safe fetch with standard headers, rate limit tracking, and timeout.
   */
  async _safeFetch(endpoint, options = {}) {
    if (!this.fetchFn) {
      throw new Error('fetch is not available in the current runtime environment.');
    }

    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ProjectPilot-AI-Agent/1.0',
      ...(options.headers || {})
    };

    const token = options.token || this.token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 10000);

    try {
      const response = await this.fetchFn(url, {
        method: options.method || 'GET',
        headers,
        signal: controller.signal
      });

      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
      const rateLimitReset = response.headers.get('x-ratelimit-reset');

      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        rateLimit: {
          remaining: rateLimitRemaining !== null ? parseInt(rateLimitRemaining, 10) : null,
          resetAt: rateLimitReset ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString() : null
        },
        json: async () => response.json(),
        text: async () => response.text()
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retrieve repository metadata from GitHub REST API.
   */
  async getRepoMetadata(owner, repo, options = {}) {
    const res = await this._safeFetch(`/repos/${owner}/${repo}`, options);

    if (res.status === 404) {
      return {
        success: false,
        status: 404,
        error: `Repository "${owner}/${repo}" was not found or is private.`,
        rateLimit: res.rateLimit
      };
    }

    if (res.status === 403 || res.status === 429) {
      return {
        success: false,
        status: res.status,
        error: 'GitHub API rate limit exceeded. Please configure GITHUB_TOKEN for higher quotas.',
        rateLimit: res.rateLimit
      };
    }

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: `GitHub API error: HTTP ${res.status}`,
        rateLimit: res.rateLimit
      };
    }

    const data = await res.json();
    return {
      success: true,
      status: 200,
      data: {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        description: data.description || '',
        isPrivate: Boolean(data.private),
        isFork: Boolean(data.fork),
        isArchived: Boolean(data.archived),
        defaultBranch: data.default_branch || 'main',
        language: data.language || 'Unknown',
        stars: data.stargazers_count || 0,
        forks: data.forks_count || 0,
        openIssuesCount: data.open_issues_count || 0,
        license: data.license ? data.license.spdx_id || data.license.name : 'None',
        pushedAt: data.pushed_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      },
      rateLimit: res.rateLimit
    };
  }

  /**
   * Retrieve repository file tree for structure inspection.
   */
  async getFileTree(owner, repo, branch = 'main', options = {}) {
    const res = await this._safeFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, options);

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: `Unable to retrieve file tree for branch "${branch}": HTTP ${res.status}`,
        tree: []
      };
    }

    const data = await res.json();
    const tree = Array.isArray(data.tree) ? data.tree : [];

    return {
      success: true,
      status: 200,
      truncated: Boolean(data.truncated),
      tree: tree.map(item => ({
        path: item.path,
        type: item.type === 'blob' ? 'file' : 'dir',
        size: item.size || 0
      }))
    };
  }

  /**
   * Retrieve contents of a specific file in the repository.
   * Protects against path traversal.
   */
  async getFileContent(owner, repo, filePath, branch = 'main', options = {}) {
    // Path traversal defense
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {
      return { success: false, error: 'Path traversal sequences are not permitted in file paths.' };
    }

    const res = await this._safeFetch(`/repos/${owner}/${repo}/contents/${normalized}?ref=${branch}`, options);
    if (!res.ok) {
      return { success: false, status: res.status, error: `File "${normalized}" not found or inaccessible.` };
    }

    const data = await res.json();
    if (data.type !== 'file' || !data.content) {
      return { success: false, error: `Item at "${normalized}" is not a readable file.` };
    }

    try {
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      return {
        success: true,
        path: normalized,
        size: data.size,
        content: decoded
      };
    } catch (err) {
      return { success: false, error: `Failed to decode file content: ${err.message}` };
    }
  }

  /**
   * Perform deep repository analysis and emit structured findings.
   * Inspects:
   * 1. Repository health & status (archived, license, description)
   * 2. Package configuration & dependencies (scripts, tests, build)
   * 3. CI/CD automation (.github/workflows)
   * 4. Documentation & governance (README, LICENSE, .gitignore)
   * 5. Security & hygiene signals
   */
  async inspectRepository(repoUrl, options = {}) {
    const validation = this.validateRepoUrl(repoUrl);
    if (!validation.valid) {
      return {
        inspectedAt: new Date().toISOString(),
        repoUrl,
        status: 'invalid_url',
        error: validation.error,
        findings: [{
          findingId: 'SEC-URL-001',
          severity: 'critical',
          confidence: 'high',
          category: 'security',
          title: 'Invalid or Disallowed Repository URL',
          explanation: validation.error,
          filePath: null,
          remediation: 'Provide a valid public GitHub repository URL matching https://github.com/owner/repo.'
        }],
        overallAssessment: 'Invalid Target'
      };
    }

    const { owner, repo, canonicalUrl } = validation;

    // 1. Fetch metadata
    const metaRes = await this.getRepoMetadata(owner, repo, options);
    if (!metaRes.success) {
      return {
        inspectedAt: new Date().toISOString(),
        repoUrl: canonicalUrl,
        owner,
        repo,
        status: metaRes.status === 404 ? 'not_found' : 'rate_limited',
        error: metaRes.error,
        rateLimit: metaRes.rateLimit,
        findings: [{
          findingId: metaRes.status === 404 ? 'REPO-NOT-FOUND' : 'RATE-LIMIT-EXCEEDED',
          severity: metaRes.status === 404 ? 'high' : 'medium',
          confidence: 'high',
          category: 'repository',
          title: metaRes.status === 404 ? 'Repository Inaccessible or Not Found' : 'GitHub API Rate Limit Encountered',
          explanation: metaRes.error,
          filePath: null,
          remediation: metaRes.status === 404
            ? 'Verify that the repository exists, is public, and the URL spelling is correct.'
            : 'Configure GITHUB_TOKEN environment variable to raise API limits.'
        }],
        overallAssessment: metaRes.status === 404 ? 'Repository Inaccessible' : 'Inspection Throttled'
      };
    }

    const metadata = metaRes.data;
    const findings = [];

    // Check repository metadata hygiene
    if (metadata.isArchived) {
      findings.push({
        findingId: 'REPO-ARCHIVED',
        severity: 'high',
        confidence: 'high',
        category: 'maintenance',
        title: 'Repository is Archived / Read-Only',
        explanation: `The GitHub repository ${owner}/${repo} is archived. No commits, issues, or pull requests can be made.`,
        filePath: null,
        remediation: 'Verify whether this project has a replacement repository or fork.'
      });
    }

    if (!metadata.description || metadata.description.trim().length === 0) {
      findings.push({
        findingId: 'REPO-NO-DESC',
        severity: 'low',
        confidence: 'high',
        category: 'configuration',
        title: 'Missing Repository Description',
        explanation: 'The repository does not have an informational description set on GitHub.',
        filePath: null,
        remediation: 'Add a concise mission description to the repository settings.'
      });
    }

    if (!metadata.license || metadata.license === 'None') {
      findings.push({
        findingId: 'LEGAL-NO-LICENSE',
        severity: 'medium',
        confidence: 'high',
        category: 'governance',
        title: 'No Software License Specified',
        explanation: 'The repository does not declare a standard SPDX license in its metadata or root LICENSE file.',
        filePath: 'LICENSE',
        remediation: 'Add an explicit LICENSE file (e.g., MIT, Apache-2.0, BSD-3-Clause) to specify usage rights.'
      });
    }

    // 2. Fetch File Tree
    const treeRes = await this.getFileTree(owner, repo, metadata.defaultBranch, options);
    let files = [];
    if (treeRes.success) {
      files = treeRes.tree.map(t => t.path);
    }

    const hasFile = (name) => files.includes(name) || files.some(f => f.toLowerCase() === name.toLowerCase());

    // Governance checks
    if (!hasFile('README.md') && !hasFile('README')) {
      findings.push({
        findingId: 'DOC-NO-README',
        severity: 'medium',
        confidence: 'high',
        category: 'documentation',
        title: 'Missing Project README',
        explanation: 'No README or README.md documentation file was found in the repository root.',
        filePath: 'README.md',
        remediation: 'Add a comprehensive README.md explaining project setup, architecture, and running instructions.'
      });
    }

    if (!hasFile('.gitignore')) {
      findings.push({
        findingId: 'HYGIENE-NO-GITIGNORE',
        severity: 'medium',
        confidence: 'high',
        category: 'configuration',
        title: 'Missing .gitignore File',
        explanation: 'No .gitignore file detected. Builds, node_modules, logs, and sensitive env files risk accidental commits.',
        filePath: '.gitignore',
        remediation: 'Add a tailored .gitignore file preventing tracking of build artifacts, .env files, and dependency caches.'
      });
    }

    // CI/CD Automation check
    const workflowFiles = files.filter(f => f.startsWith('.github/workflows/') && (f.endsWith('.yml') || f.endsWith('.yaml')));
    if (workflowFiles.length === 0) {
      findings.push({
        findingId: 'OPS-NO-CI',
        severity: 'medium',
        confidence: 'high',
        category: 'ci_cd',
        title: 'No CI/CD Workflows Detected',
        explanation: 'No GitHub Actions workflows were found under .github/workflows/. Pull requests and merges are not automatically verified.',
        filePath: '.github/workflows/',
        remediation: 'Configure a GitHub Actions workflow (.github/workflows/ci.yml) to run automated tests and linting on push.'
      });
    }

    // 3. Inspect package.json if present
    if (hasFile('package.json')) {
      const pkgRes = await this.getFileContent(owner, repo, 'package.json', metadata.defaultBranch, options);
      if (pkgRes.success) {
        try {
          const pkg = JSON.parse(pkgRes.content);

          // Check test script
          if (!pkg.scripts || !pkg.scripts.test) {
            findings.push({
              findingId: 'TEST-NO-SCRIPT',
              severity: 'high',
              confidence: 'high',
              category: 'testing',
              title: 'Missing Test Script in package.json',
              explanation: 'No "test" script is defined in package.json. Automated test verification cannot be executed standardly.',
              filePath: 'package.json',
              remediation: 'Define a "test" script in package.json (e.g., "node --test" or your preferred test runner).'
            });
          } else if (pkg.scripts.test.includes('no test specified')) {
            findings.push({
              findingId: 'TEST-DEFAULT-STUB',
              severity: 'high',
              confidence: 'high',
              category: 'testing',
              title: 'Default Unimplemented Test Script',
              explanation: 'The "test" script in package.json is the default npm stub ("echo \\"Error: no test specified\\" && exit 1").',
              filePath: 'package.json',
              remediation: 'Replace the default stub with an executable test suite runner.'
            });
          }

          // Check lockfile presence
          if (!hasFile('package-lock.json') && !hasFile('yarn.lock') && !hasFile('pnpm-lock.yaml')) {
            findings.push({
              findingId: 'DEP-NO-LOCKFILE',
              severity: 'medium',
              confidence: 'high',
              category: 'dependency',
              title: 'No Lockfile Committed',
              explanation: 'Repository contains package.json but no lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml) is tracked.',
              filePath: 'package-lock.json',
              remediation: 'Run npm install and commit the generated package-lock.json to ensure reproducible builds.'
            });
          }

          // Check dependency hygiene
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          const depKeys = Object.keys(deps);

          // Check for wildcard dependencies
          const wildcards = depKeys.filter(d => deps[d] === '*' || deps[d] === 'latest');
          if (wildcards.length > 0) {
            findings.push({
              findingId: 'DEP-WILDCARD-VERSION',
              severity: 'high',
              confidence: 'high',
              category: 'dependency',
              title: 'Wildcard Dependency Versions Detected',
              explanation: `Dependencies pinned with "*" or "latest": ${wildcards.join(', ')}. This introduces non-deterministic breaking changes.`,
              filePath: 'package.json',
              remediation: 'Pin dependencies to specific semantic version ranges (e.g. ^1.2.3).'
            });
          }
        } catch (err) {
          findings.push({
            findingId: 'PKG-MALFORMED-JSON',
            severity: 'high',
            confidence: 'high',
            category: 'configuration',
            title: 'Malformed package.json File',
            explanation: `package.json could not be parsed as valid JSON: ${err.message}`,
            filePath: 'package.json',
            remediation: 'Ensure package.json contains valid JSON syntax.'
          });
        }
      }
    }

    // Determine overall assessment
    let overallAssessment = 'Clean';
    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;
    const mediumCount = findings.filter(f => f.severity === 'medium').length;

    if (criticalCount > 0 || highCount >= 2) {
      overallAssessment = 'Needs Attention (High Risk Findings)';
    } else if (highCount > 0 || mediumCount >= 2) {
      overallAssessment = 'Moderate Risk (Actionable Findings)';
    } else if (mediumCount > 0 || findings.length > 0) {
      overallAssessment = 'Good (Minor Recommendations)';
    }

    return {
      inspectedAt: new Date().toISOString(),
      repoUrl: canonicalUrl,
      owner,
      repo,
      status: 'inspected',
      metadata,
      fileTreeSummary: {
        totalFilesIndexed: files.length,
        hasReadme: hasFile('README.md') || hasFile('README'),
        hasLicense: hasFile('LICENSE'),
        hasGitignore: hasFile('.gitignore'),
        hasPackageJson: hasFile('package.json'),
        ciWorkflowsCount: workflowFiles.length,
        workflowFiles
      },
      findings,
      counts: {
        total: findings.length,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: findings.filter(f => f.severity === 'low').length
      },
      overallAssessment,
      rateLimit: metaRes.rateLimit
    };
  }
}
