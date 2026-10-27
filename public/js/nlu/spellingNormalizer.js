/**
 * ProjectPilot AI - Spelling & Text Normalization Layer
 * Corrects common typos, informal abbreviations, and grammatical slips
 * while strictly safeguarding technical identifiers, URLs, IDs, and code terms.
 */

// Common developer contractions and informal abbreviations
export const ABBREVIATIONS = {
  'wht': 'what',
  'wat': 'what',
  'y': 'why',
  'ur': 'your',
  'u': 'you',
  'r': 'are',
  'pls': 'please',
  'plz': 'please',
  'abt': 'about',
  'bcoz': 'because',
  'bcuz': 'because',
  'bcz': 'because',
  'msg': 'message',
  'err': 'error',
  'eror': 'error',
  'erorr': 'error',
  'erors': 'errors',
  'perf': 'performance',
  'auth': 'authentication',
  'chk': 'check',
  'chck': 'check',
  'proj': 'project',
  'prj': 'project',
  'projct': 'project',
  'progect': 'project',
  'proejct': 'project',
  'pendng': 'pending',
  'pnding': 'pending',
  'pening': 'pending',
  'runing': 'running',
  'runnin': 'running',
  'tast': 'task',
  'tak': 'task',
  'tsak': 'task',
  'staus': 'status',
  'stat': 'status',
  'stuts': 'status',
  'hlth': 'health',
  'helth': 'health',
  'diff': 'difference',
  'impl': 'implementation',
  'doc': 'documentation',
  'docs': 'documentation',
  'rec': 'recommendation',
  'recs': 'recommendations',
  'maintanence': 'maintenance',
  'maintainance': 'maintenance',
  'maint': 'maintenance',
  'resque': 'rescue',
  'recue': 'rescue',
  'complet': 'complete',
  'cmplete': 'complete',
  'investgat': 'investigate',
  'investgate': 'investigate',
  'invesitgate': 'investigate',
  'insepct': 'inspect',
  'inspec': 'inspect',
  're-open': 'reopen',
  'un-block': 'unblock',
  'repo': 'repository'
};

// Known technical tokens and protected patterns
const TECHNICAL_PATTERN = /\b(?:https?:\/\/[^\s]+|proj-[a-zA-Z0-9_\-]+|task-[a-zA-Z0-9_\-]+|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|[A-Z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*|\b[0-9]{3}\b|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|OOM|PostgreSQL|GraphQL|OAuth|TypeScript|JavaScript|Node\.js|Python|Docker|Vercel|Upstash|Redis|REST|HTTP|JWT|JSON|API|SHA|CAS|CORS|CI\/CD)\b/g;

/**
 * Computes Damerau-Levenshtein distance between two strings.
 * Accounts for insertions, deletions, substitutions, and transpositions.
 */
export function damerauLevenshtein(a, b) {
  if (!a || !b) return (a || '').length + (b || '').length;
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const len1 = s1.length;
  const len2 = s2.length;

  const matrix = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deletion
        matrix[i][j - 1] + 1,       // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Shelters technical identifiers by replacing them with tokens before normalization,
 * then restoring them after normalization.
 */
export class SpellingNormalizer {
  constructor(customAbbreviations = {}) {
    this.abbreviations = { ...ABBREVIATIONS, ...customAbbreviations };
    this.vocabulary = new Set([
      'investigate', 'inspect', 'audit', 'examine', 'check', 'show', 'status',
      'health', 'task', 'tasks', 'project', 'projects', 'blocker', 'blockers',
      'priority', 'priorities', 'recommendation', 'recommendations', 'maintenance',
      'rescue', 'recovery', 'complete', 'finish', 'reopen', 'create', 'add',
      'resolve', 'clear', 'unblock', 'remaining', 'pending', 'outstanding',
      'details', 'running', 'error', 'performance', 'slow', 'working', 'properly',
      'explain', 'simple', 'today', 'daily', 'history', 'activity', 'trail'
    ]);
  }

  /**
   * Normalizes input text while strictly preserving technical identifiers.
   * @param {string} text
   * @returns {{
   *   original: string,
   *   normalized: string,
   *   preservedTokens: Array<{ token: string, placeholder: string }>
   * }}
   */
  normalize(text) {
    if (!text || typeof text !== 'string') {
      return { original: '', normalized: '', preservedTokens: [] };
    }

    const preservedTokens = [];
    let placeholderCounter = 0;

    // Step 1: Protect URLs and technical tokens
    let sheltered = text.replace(TECHNICAL_PATTERN, (match) => {
      // Don't shelter generic plain single words that happen to look like acronyms if they are dictionary words
      if (match.length > 2) {
        const placeholder = `__TECH_TOKEN_${placeholderCounter++}__`;
        preservedTokens.push({ token: match, placeholder });
        return placeholder;
      }
      return match;
    });

    // Step 2: Remove leading conversational polite prefixes
    sheltered = sheltered
      .replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+|kindly\s+|hey\s+|hi\s+|hello\s+)/i, '')
      .replace(/[?!,;]+$/, '')
      .trim();

    // Step 3: Tokenize words
    const tokens = sheltered.split(/(\s+|[^\w\s_])/);
    const correctedTokens = tokens.map((segment) => {
      // If segment is whitespace, punctuation, or a technical token placeholder, preserve it
      if (!segment || /^\s+$/.test(segment) || /^[^\w\s_]$/.test(segment) || segment.startsWith('__TECH_TOKEN_')) {
        return segment;
      }

      const lower = segment.toLowerCase();

      // Check explicit abbreviation / typo table
      if (this.abbreviations[lower]) {
        const replacement = this.abbreviations[lower];
        // Match casing if original was uppercase or capitalized
        if (segment === segment.toUpperCase() && segment.length > 1) {
          return replacement.toUpperCase();
        }
        if (segment[0] === segment[0].toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      }

      // Check vocabulary using Damerau-Levenshtein distance for words of length >= 4
      if (lower.length >= 4 && !this.vocabulary.has(lower)) {
        let bestCandidate = null;
        let minDistance = 2; // Maximum 1 edit for short words, 2 for longer words

        const maxAllowed = lower.length <= 5 ? 1 : 2;

        for (const vocabWord of this.vocabulary) {
          if (Math.abs(vocabWord.length - lower.length) > maxAllowed) continue;
          const dist = damerauLevenshtein(lower, vocabWord);
          if (dist <= maxAllowed && dist < minDistance) {
            minDistance = dist;
            bestCandidate = vocabWord;
          }
        }

        if (bestCandidate) {
          if (segment[0] === segment[0].toUpperCase()) {
            return bestCandidate.charAt(0).toUpperCase() + bestCandidate.slice(1);
          }
          return bestCandidate;
        }
      }

      return segment;
    });

    let normalized = correctedTokens.join('');

    // Step 4: Restore preserved technical tokens
    for (const { token, placeholder } of preservedTokens) {
      normalized = normalized.replace(placeholder, token);
    }

    return {
      original: text,
      normalized: normalized.trim(),
      preservedTokens
    };
  }
}
