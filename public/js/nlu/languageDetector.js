/**
 * ProjectPilot AI - Multilingual Language Detector
 * Detects English, Hindi, Marathi, Hinglish, and Marathi-English code-switching
 * in both Devanagari and Latin (Romanized) scripts, supporting dynamic switching.
 */

// Devanagari Unicode Block
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

// Marathi-specific Devanagari tokens
const MARATHI_DEVANAGARI_WORDS = new Set([
  'आहे', 'आहेत', 'नाही', 'नाहीत', 'माझा', 'माझी', 'माझे', 'आमचा', 'आमची',
  'काय', 'झाला', 'झाली', 'झाले', 'येतोय', 'येते', 'दाखवा', 'सांगा', 'करा',
  'होत', 'होते', 'काम', 'बघा', 'कशामुळे', 'मदत', 'परत', 'सुरू', 'बंद',
  'मध्ये', 'चा', 'ची', 'चे', 'च्या', 'कधी', 'किती'
]);

// Hindi-specific Devanagari tokens
const HINDI_DEVANAGARI_WORDS = new Set([
  'है', 'हैं', 'नहीं', 'मेरा', 'मेरी', 'मेरे', 'हमारा', 'हमारी',
  'क्या', 'हुआ', 'हुई', 'हुए', 'आया', 'आई', 'आए', 'दिखाओ', 'बताओ',
  'करो', 'कीजिये', 'रहा', 'रही', 'रहे', 'चल', 'मदद', 'वापस', 'शुरू',
  'में', 'का', 'की', 'के', 'कब', 'कितना'
]);

// Romanized Marathi tokens
const ROMAN_MARATHI_WORDS = new Set([
  'majha', 'majhi', 'majhe', 'amcha', 'amchi', 'kay', 'karu', 'karayche',
  'aahe', 'aahet', 'kashamule', 'yetoy', 'yeto', 'zala', 'jhala', 'dakhva',
  'sanga', 'karun', 'hot', 'nahi', 'hota', 'hoti', 'madat', 'parat',
  'suru', 'banda', 'madhe', 'kiti', 'kadhi', 'bagha', 'sang'
]);

// Romanized Hindi tokens
const ROMAN_HINDI_WORDS = new Set([
  'mera', 'meri', 'mere', 'humara', 'humari', 'kya', 'kare', 'karna',
  'hai', 'hain', 'kyu', 'kyun', 'aaya', 'hua', 'dikhao', 'batao',
  'chal', 'raha', 'rahi', 'rahe', 'madad', 'wapas', 'shuru', 'karo',
  'kijiye', 'mein', 'kitna', 'kab', 'kaise', 'dekho', 'bhai'
]);

// Explicit language request patterns
const EXPLICIT_LANGUAGE_PATTERNS = [
  { lang: 'mr', regex: /\b(?:in\s+marathi|marathi\s+madhe|speak\s+in\s+marathi|marathi\s+me|(?:explain|tell|sanga).*(?:in\s+)?(?:simple\s+)?marathi)\b/i },
  { lang: 'hi', regex: /\b(?:in\s+hindi|hindi\s+me(?:in)?|speak\s+in\s+hindi|hindi\s+bhasha|(?:explain|tell|batao).*(?:in\s+)?(?:simple\s+)?hindi)\b/i },
  { lang: 'en', regex: /\b(?:in\s+english|speak\s+in\s+english|english\s+me(?:in)?|(?:explain|tell).*(?:in\s+)?english)\b/i },
  { lang: 'hinglish', regex: /\b(?:in\s+hinglish|hinglish\s+me(?:in)?|speak\s+in\s+hinglish)\b/i }
];

export class LanguageDetector {
  /**
   * Detects language, script, and code-switching in a user input.
   * @param {string} text
   * @param {string} [contextLanguage='en']
   * @returns {{
   *   language: 'en'|'hi'|'mr'|'hinglish'|'marathiglish',
   *   script: 'latin'|'devanagari'|'mixed',
   *   confidence: number,
   *   explicitSwitch: boolean,
   *   isSwitchCommand: boolean,
   *   requestedLanguage: string|null
   * }}
   */
  detect(text, contextLanguage = 'en') {
    if (!text || typeof text !== 'string') {
      return {
        language: contextLanguage || 'en',
        script: 'latin',
        confidence: 1.0,
        explicitSwitch: false,
        isSwitchCommand: false,
        requestedLanguage: null
      };
    }

    const trimmed = text.trim();

    // 1. Check for explicit language switch commands
    for (const { lang, regex } of EXPLICIT_LANGUAGE_PATTERNS) {
      if (regex.test(trimmed)) {
        return {
          language: lang,
          script: lang === 'en' ? 'latin' : 'latin', // user typed in latin
          confidence: 0.99,
          explicitSwitch: true,
          isSwitchCommand: true,
          requestedLanguage: lang
        };
      }
    }

    // 2. Script detection
    const hasDevanagari = DEVANAGARI_REGEX.test(trimmed);
    const hasLatin = /[a-zA-Z]/.test(trimmed);
    const script = hasDevanagari && hasLatin ? 'mixed' : (hasDevanagari ? 'devanagari' : 'latin');

    // Tokenize into lowercase words
    const words = trimmed
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212\-_/\\:;,."'`()[\]{}?!]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return {
        language: contextLanguage || 'en',
        script,
        confidence: 0.5,
        explicitSwitch: false,
        requestedLanguage: null
      };
    }

    // 3. Devanagari Script Analysis
    if (hasDevanagari) {
      let mrDevScore = 0;
      let hiDevScore = 0;

      for (const w of words) {
        if (w.includes('ळ') || MARATHI_DEVANAGARI_WORDS.has(w)) mrDevScore += 2;
        if (HINDI_DEVANAGARI_WORDS.has(w)) hiDevScore += 2;
      }

      if (mrDevScore > hiDevScore) {
        return { language: 'mr', script, confidence: 0.9, explicitSwitch: false, requestedLanguage: null };
      }
      if (hiDevScore > mrDevScore) {
        return { language: 'hi', script, confidence: 0.9, explicitSwitch: false, requestedLanguage: null };
      }
      // If equal, check context language, else default to Hindi for Devanagari
      return {
        language: contextLanguage === 'mr' ? 'mr' : 'hi',
        script,
        confidence: 0.75,
        explicitSwitch: false,
        requestedLanguage: null
      };
    }

    // 4. Latin / Romanized Script Analysis
    let mrScore = 0;
    let hiScore = 0;
    let enScore = 0;

    for (const w of words) {
      let matched = false;
      if (ROMAN_MARATHI_WORDS.has(w)) {
        mrScore += 2;
        matched = true;
      }
      if (ROMAN_HINDI_WORDS.has(w)) {
        hiScore += 2;
        matched = true;
      }
      if (!matched && w.length >= 3) {
        enScore += 1;
      }
    }

    // Determine code-switching or pure language
    if (mrScore > 0 && enScore > 0 && mrScore >= hiScore) {
      return { language: 'marathiglish', script: 'latin', confidence: 0.85, explicitSwitch: false, requestedLanguage: null };
    }
    if (hiScore > 0 && enScore > 0 && hiScore > mrScore) {
      return { language: 'hinglish', script: 'latin', confidence: 0.85, explicitSwitch: false, requestedLanguage: null };
    }
    if (mrScore > 0 && mrScore >= hiScore) {
      return { language: 'mr', script: 'latin', confidence: 0.85, explicitSwitch: false, requestedLanguage: null };
    }
    if (hiScore > 0) {
      return { language: 'hi', script: 'latin', confidence: 0.85, explicitSwitch: false, requestedLanguage: null };
    }

    // Pure English default
    return {
      language: 'en',
      script: 'latin',
      confidence: 0.95,
      explicitSwitch: false,
      requestedLanguage: null
    };
  }
}
