import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubService } from '../src/services/githubService.js';

describe('GitHub Intelligence Service & Security Audit', () => {
  describe('1. SSRF & URL Validation', () => {
    const service = new GitHubService();

    test('accepts valid GitHub repository URLs', () => {
      const validUrls = [
        'https://github.com/facebook/react',
        'https://github.com/kunal-patil-2155/ProjectPilot-AI',
        'https://github.com/nodejs/node.git',
        'http://github.com/expressjs/express'
      ];

      for (const url of validUrls) {
        const res = service.validateRepoUrl(url);
        assert.equal(res.valid, true, `Should accept ${url}`);
        assert.ok(res.owner);
        assert.ok(res.repo);
        assert.ok(res.canonicalUrl.startsWith('https://github.com/'));
      }
    });

    test('rejects non-GitHub domains (SSRF prevention)', () => {
      const invalidUrls = [
        'https://gitlab.com/user/repo',
        'https://bitbucket.org/user/repo',
        'https://attacker-controlled.site/foo/bar',
        'https://evil.com/github.com/repo'
      ];

      for (const url of invalidUrls) {
        const res = service.validateRepoUrl(url);
        assert.equal(res.valid, false, `Should reject ${url}`);
        assert.ok(res.error.includes('Only github.com'));
      }
    });

    test('rejects localhost, IP addresses, and private subnets', () => {
      const maliciousUrls = [
        'https://127.0.0.1/owner/repo',
        'https://localhost/owner/repo',
        'https://169.254.169.254/latest/meta-data',
        'https://10.0.0.1/admin/repo'
      ];

      for (const url of maliciousUrls) {
        const res = service.validateRepoUrl(url);
        assert.equal(res.valid, false, `Should reject IP/localhost: ${url}`);
      }
    });

    test('rejects path traversal sequences in repo URL', () => {
      const traversalUrls = [
        'https://github.com/../../etc/passwd',
        'https://github.com/owner/..',
        'https://github.com/./.'
      ];

      for (const url of traversalUrls) {
        const res = service.validateRepoUrl(url);
        assert.equal(res.valid, false, `Should reject traversal: ${url}`);
      }
    });

    test('rejects malformed URLs and non-string inputs', () => {
      assert.equal(service.validateRepoUrl('').valid, false);
      assert.equal(service.validateRepoUrl(null).valid, false);
      assert.equal(service.validateRepoUrl(123).valid, false);
      assert.equal(service.validateRepoUrl('not a url').valid, false);
    });
  });

  describe('2. Rate Limiting and Inaccessible Repositories', () => {
    test('truthfully handles 404 repository not found without throwing', async () => {
      const mockFetch = async () => ({
        status: 404,
        ok: false,
        headers: new Headers({ 'x-ratelimit-remaining': '60' }),
        json: async () => ({ message: 'Not Found' }),
        text: async () => 'Not Found'
      });

      const service = new GitHubService({ fetchFn: mockFetch });
      const report = await service.inspectRepository('https://github.com/nonexistent-org/missing-repo');

      assert.equal(report.status, 'not_found');
      assert.ok(report.findings.some(f => f.findingId === 'REPO-NOT-FOUND'));
      assert.equal(report.overallAssessment, 'Repository Inaccessible');
    });

    test('truthfully handles 403 / 429 rate limit exceeded', async () => {
      const mockFetch = async () => ({
        status: 403,
        ok: false,
        headers: new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1700000000'
        }),
        json: async () => ({ message: 'API rate limit exceeded' }),
        text: async () => 'Rate limit exceeded'
      });

      const service = new GitHubService({ fetchFn: mockFetch });
      const report = await service.inspectRepository('https://github.com/facebook/react');

      assert.equal(report.status, 'rate_limited');
      assert.ok(report.findings.some(f => f.findingId === 'RATE-LIMIT-EXCEEDED'));
      assert.equal(report.rateLimit.remaining, 0);
    });
  });

  describe('3. Deep Repository Inspection and Structured Findings', () => {
    test('detects missing README, .gitignore, CI/CD, and package.json test issues', async () => {
      // Mock repository data with deficiencies
      const mockFetch = async (url) => {
        if (url.includes('/git/trees/')) {
          // Tree with only package.json (missing README, .gitignore, LICENSE, .github/workflows)
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '55' }),
            json: async () => ({
              tree: [{ path: 'package.json', type: 'blob', size: 120 }]
            })
          };
        }

        if (url.includes('/contents/package.json')) {
          const pkgContent = JSON.stringify({
            name: 'sample-project',
            version: '1.0.0',
            scripts: {
              test: 'echo "Error: no test specified" && exit 1'
            },
            dependencies: {
              express: '*'
            }
          });
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '54' }),
            json: async () => ({
              type: 'file',
              content: Buffer.from(pkgContent).toString('base64'),
              size: pkgContent.length
            })
          };
        }

        // Repository metadata
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'x-ratelimit-remaining': '56' }),
          json: async () => ({
            id: 12345,
            name: 'sample-project',
            full_name: 'test-org/sample-project',
            description: '',
            private: false,
            fork: false,
            archived: false,
            default_branch: 'main',
            license: null,
            stargazers_count: 5,
            open_issues_count: 2
          })
        };
      };

      const service = new GitHubService({ fetchFn: mockFetch });
      const report = await service.inspectRepository('https://github.com/test-org/sample-project');

      assert.equal(report.status, 'inspected');
      assert.ok(report.findings.length >= 6);

      // Verify specific finding IDs
      const findingIds = report.findings.map(f => f.findingId);
      assert.ok(findingIds.includes('REPO-NO-DESC'), 'Should flag missing description');
      assert.ok(findingIds.includes('LEGAL-NO-LICENSE'), 'Should flag missing license');
      assert.ok(findingIds.includes('DOC-NO-README'), 'Should flag missing README');
      assert.ok(findingIds.includes('HYGIENE-NO-GITIGNORE'), 'Should flag missing .gitignore');
      assert.ok(findingIds.includes('OPS-NO-CI'), 'Should flag missing CI/CD workflows');
      assert.ok(findingIds.includes('TEST-DEFAULT-STUB'), 'Should flag default test stub in package.json');
      assert.ok(findingIds.includes('DEP-WILDCARD-VERSION'), 'Should flag wildcard express dependency');
      assert.ok(findingIds.includes('DEP-NO-LOCKFILE'), 'Should flag missing lockfile');

      // Verify finding structure
      const sample = report.findings[0];
      assert.ok(sample.findingId);
      assert.ok(sample.severity);
      assert.ok(sample.confidence);
      assert.ok(sample.category);
      assert.ok(sample.title);
      assert.ok(sample.explanation);
      assert.ok(sample.remediation);
    });

    test('produces clean assessment on well-configured repository', async () => {
      const mockFetch = async (url) => {
        if (url.includes('/git/trees/')) {
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '55' }),
            json: async () => ({
              tree: [
                { path: 'package.json', type: 'blob', size: 120 },
                { path: 'package-lock.json', type: 'blob', size: 5000 },
                { path: 'README.md', type: 'blob', size: 1000 },
                { path: 'LICENSE', type: 'blob', size: 1000 },
                { path: '.gitignore', type: 'blob', size: 200 },
                { path: '.github/workflows/ci.yml', type: 'blob', size: 400 }
              ]
            })
          };
        }

        if (url.includes('/contents/package.json')) {
          const pkgContent = JSON.stringify({
            name: 'clean-project',
            version: '1.0.0',
            scripts: {
              test: 'node --test'
            },
            dependencies: {
              express: '^4.19.2'
            }
          });
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '54' }),
            json: async () => ({
              type: 'file',
              content: Buffer.from(pkgContent).toString('base64'),
              size: pkgContent.length
            })
          };
        }

        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'x-ratelimit-remaining': '56' }),
          json: async () => ({
            id: 99999,
            name: 'clean-project',
            full_name: 'test-org/clean-project',
            description: 'A model clean project for testing',
            private: false,
            fork: false,
            archived: false,
            default_branch: 'main',
            license: { spdx_id: 'MIT' },
            stargazers_count: 50,
            open_issues_count: 0
          })
        };
      };

      const service = new GitHubService({ fetchFn: mockFetch });
      const report = await service.inspectRepository('https://github.com/test-org/clean-project');

      assert.equal(report.status, 'inspected');
      assert.equal(report.findings.length, 0);
      assert.equal(report.overallAssessment, 'Clean');
    });
  });
});
