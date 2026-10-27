/**
 * ProjectPilot AI - Natural Response Generation Engine
 * Generates clear, professional, evidence-driven responses across English,
 * Hindi, Marathi, and Hinglish, adapting tone and structure to task complexity.
 */

export class NaturalResponseEngine {
  /**
   * Formats a structured, evidence-based project investigation report.
   */
  formatInvestigationReport({ project, details, health, blockers = [], tasks = [], language = 'en', script = 'latin' }) {
    const pName = project?.name || 'Project';
    const status = project?.status || 'active';
    const healthStatus = health?.healthStatus || 'Insufficient Data';
    const score = health?.score !== undefined ? `${health.score}/100` : 'N/A';
    const blockerCount = blockers.length;

    // 1. Marathi Response
    if (language === 'mr' || language === 'marathiglish') {
      let text = `### 🔍 **${pName} — तपासणी अहवाल**\n\n`;
      text += `• **सद्यस्थिती:** ${status.toUpperCase()} | **आरोग्य दर्जा (Health):** ${healthStatus} (${score})\n`;
      text += `• **नोंदणीकृत कामे (Tasks):** ${tasks.length} एकूण | **सक्रिय अडथळे (Blockers):** ${blockerCount}\n\n`;

      if (blockerCount > 0) {
        text += `#### ⚠️ **निश्चित आढळलेले दोष (Confirmed Findings):**\n`;
        blockers.forEach((b, idx) => {
          text += `**${idx + 1}. [गंभीर अडथळा / Critical Blocker]** ${b.title || b.id}\n`;
          text += `   • **तपशील / पुरावा:** ${b.blockerReason || b.blocker || 'कारणाचे तपशील उपलब्ध नाहीत'}\n`;
          text += `   • **परिणाम:** जोपर्यंत हा अडथळा दूर होत नाही, तोपर्यंत कार्यप्रवाह पुढे जाऊ शकत नाही.\n`;
        });
        text += `\n`;
      } else if (tasks.length === 0) {
        text += `ℹ️ **माहिती अपुरी आहे (Insufficient Data):** या प्रोजेक्टमध्ये कोणतीही कामे (tasks) नोंदवलेली नाहीत, त्यामुळे सखोल विश्लेषण करता आले नाही.\n\n`;
      } else {
        text += `✅ **सर्व प्रणाली सामान्य:** सध्या कोणताही सक्रिय अडथळा आढळला नाही.\n\n`;
      }

      text += `#### 💡 **पुढील शिफारसी (Recommended Next Actions):**\n`;
      if (blockerCount > 0) {
        text += `1. वरील अडथळा सोडवण्यासाठी तातडीने तपासणी करा किंवा \`resolve blocker\` वापरा.\n`;
        text += `2. प्रोजेक्ट रिकव्हरी प्लॅन तयार करण्यासाठी "Prepare rescue plan for ${pName}" विचारा.\n`;
      } else {
        text += `1. दैनंदिन प्राधान्यक्रम तपासण्यासाठी "Show daily priorities" विचारा.\n`;
      }

      return text;
    }

    // 2. Hindi / Hinglish Response
    if (language === 'hi' || language === 'hinglish') {
      let text = `### 🔍 **${pName} — प्रोजेक्ट जाँच रिपोर्ट**\n\n`;
      text += `• **स्टेटस:** ${status.toUpperCase()} | **हेल्थ स्थिति (Health):** ${healthStatus} (${score})\n`;
      text += `• **कुल टास्क्स (Tasks):** ${tasks.length} | **सक्रिय ब्लॉकर्स (Blockers):** ${blockerCount}\n\n`;

      if (blockerCount > 0) {
        text += `#### ⚠️ **पुष्ट निष्कर्ष (Confirmed Findings):**\n`;
        blockers.forEach((b, idx) => {
          text += `**${idx + 1}. [क्रिटिकल ब्लॉकर / Critical Blocker]** ${b.title || b.id}\n`;
          text += `   • **कारण व साक्ष्य (Evidence):** ${b.blockerReason || b.blocker || 'विवरण अनुपलब्ध'}\n`;
          text += `   • **प्रभाव:** इस समस्या के कारण डिप्लॉयमेंट या कार्यप्रवाह रुका हुआ है।\n`;
        });
        text += `\n`;
      } else if (tasks.length === 0) {
        text += `ℹ️ **अपर्याप्त डेटा (Insufficient Data):** इस प्रोजेक्ट में कोई टास्क्स दर्ज नहीं हैं, अतः हेल्थ का पूर्ण मूल्यांकन संभव नहीं हुआ।\n\n`;
      } else {
        text += `✅ **सिस्टम सुचारू:** प्रोजेक्ट में कोई सक्रिय ब्लॉकर नहीं है।\n\n`;
      }

      text += `#### 💡 **सुझावित अगले कदम (Recommended Next Steps):**\n`;
      if (blockerCount > 0) {
        text += `1. ब्लॉकर हल करने के लिए \`resolve blocker\` का उपयोग करें या संबंधित निर्भरता को ठीक करें।\n`;
        text += `2. ऑटोमैटिक रिकवरी योजना के लिए "Prepare rescue plan for ${pName}" कहें।\n`;
      } else {
        text += `1. अगले टास्क्स देखने के लिए "Show daily priorities" पूछें।\n`;
      }

      return text;
    }

    // 3. Default English Response (Structured, professional, evidence-backed)
    let text = `### 🔍 **Investigation Report: ${pName}**\n\n`;
    text += `• **Project Status:** \`${status.toUpperCase()}\` | **Health Classification:** \`${healthStatus}\` (${score})\n`;
    text += `• **Registered Tasks:** ${tasks.length} total | **Active Blockers:** ${blockerCount}\n\n`;

    if (blockerCount > 0) {
      text += `#### ⚠️ **Confirmed Operational Findings:**\n`;
      blockers.forEach((b, idx) => {
        text += `**${idx + 1}. [CRITICAL BLOCKER] ${b.title || b.id}**\n`;
        text += `   • **Evidence Source:** Persisted Task Record (\`${b.id}\`)\n`;
        text += `   • **Reported Cause:** ${b.blockerReason || b.blocker}\n`;
        text += `   • **Impact:** Directly degrades health to \`${healthStatus}\` and impedes release readiness.\n`;
      });
      text += `\n`;
    } else if (tasks.length === 0) {
      text += `ℹ️ **Insufficient Data:** Project has 0 registered tasks. Health cannot be verified without recorded operational scope.\n\n`;
    } else {
      text += `✅ **No Active Blockers:** All registered tasks are unblocked or completed.\n\n`;
    }

    text += `#### 💡 **Recommended Actions & Verification:**\n`;
    if (blockerCount > 0) {
      text += `1. **Investigate Blocker Root Cause:** Address underlying dependency or migration failure.\n`;
      text += `2. **Administrative Unblocking:** Execute \`resolve blocker\` or prepare an automated recovery plan via \`prepare rescue plan for ${pName}\`.\n`;
    } else {
      text += `1. Review remaining workload using \`show remaining work\`.\n`;
      text += `2. Inspect GitHub repository dependencies if integrated.\n`;
    }

    return text;
  }

  /**
   * Formats a clear, simple explanation of a technical error/blocker in the requested language.
   */
  formatErrorExplanation({ project, errorOrBlocker, language = 'en' }) {
    const pName = project?.name || 'Project';
    const errorText = errorOrBlocker?.reason || errorOrBlocker?.text || errorOrBlocker || 'Technical issue';

    if (language === 'mr' || language === 'marathiglish') {
      return (
        `### 🛠️ **${pName} — एररचे सोप्या भाषेत स्पष्टीकरण (Simple Marathi)**\n\n` +
        `तुमच्या **${pName}** प्रोजेक्टमध्ये खालील त्रुटी (Error) आढळली आहे:\n\n` +
        `> **एरर संदेश / ब्लॉकर:** \`${errorText}\`\n\n` +
        `**१. ही अडचण का आली? (Root Cause):**\n` +
        `• सिस्टीमच्या नोंदींनुसार, डेटाबेस किंवा बाह्य सेवांशी कनेक्ट होताना अपयशी ठरल्यामुळे हा टास्क 'Blocked' अवस्थेत गेला आहे.\n` +
        `• या त्रुटीमुळे संबंधित कार्यप्रवाह तात्पुरता थांबवला गेला आहे.\n\n` +
        `**२. उपाय काय आहे? (How to Fix):**\n` +
        `• डेटाबेसचे कॉन्फिगरेशन आणि आवश्यक पर्यावरण व्हेरिएबल्स (Environment Variables) तपासा.\n` +
        `• समस्या सुटल्यानंतर हा ब्लॉकर काढण्यासाठी "Resolve blocker" म्हणा किंवा सहाय्यकाला "Same issue fix karo" अशी सूचना द्या.`
      );
    }

    if (language === 'hi' || language === 'hinglish') {
      return (
        `### 🛠️ **${pName} — एरर का सरल स्पष्टीकरण (Simple Hindi)**\n\n` +
        `आपके **${pName}** प्रोजेक्ट में यह मुख्य एरर / ब्लॉकर पाया गया है:\n\n` +
        `> **एरर संदेश:** \`${errorText}\`\n\n` +
        `**१. यह समस्या क्यों आई? (कारण):**\n` +
        `• प्रोजेक्ट के लॉग्स के अनुसार, माइग्रेशन या सेवा कॉन्फ़िगरेशन में विफलता आने के कारण यह टास्क ब्लॉक हुआ है।\n\n` +
        `**२. इसे कैसे ठीक करें? (समाधान):**\n` +
        `• डेटाबेस कनेक्शन और क्रेडेंशियल्स की जाँच करें।\n` +
        `• ब्लॉकर को हल करने के लिए "Resolve blocker" बोलें या "Same issue fix karo" कमांड दें।`
      );
    }

    return (
      `### 🛠️ **Error Root Cause Analysis: ${pName}**\n\n` +
      `**Active Blocker:** \`${errorText}\`\n\n` +
      `**1. Technical Explanation:**\n` +
      `The task is flagged as blocked because a dependency, service connection, or migration precondition failed.\n\n` +
      `**2. Evidence Source:**\n` +
      `Persisted project store task metadata.\n\n` +
      `**3. Resolution Options:**\n` +
      `• Resolve the underlying environmental dependency.\n` +
      `• Execute \`resolve blocker\` to unblock downstream development.`
    );
  }

  /**
   * Formats a polite, contextual greeting in the detected language.
   */
  formatGreeting(language = 'en') {
    if (language === 'mr' || language === 'marathiglish') {
      return (
        `नमस्कार! मी तुमचा **ProjectPilot AI** ऑपरेशन्स असिस्टंट आहे.\n` +
        `मी तुमच्या प्रोजेक्ट्सचे आरोग्य (health), प्रलंबित कामे (tasks), आणि अडथळे (blockers) तपासण्यात मदत करू शकतो.\n\n` +
        `तुम्ही मला विचारू शकता:\n` +
        `• *"आज काय करू?"* (Daily priorities)\n` +
        `• *"माझा प्रोजेक्ट तपासा"* (Project status)\n` +
        `• *"काही अडथळे आहेत का?"* (Blockers)`
      );
    }

    if (language === 'hi' || language === 'hinglish') {
      return (
        `नमस्ते! मैं आपका **ProjectPilot AI** ऑपरेशंस असिस्टेंट हूँ।\n` +
        `मैं आपके सॉफ़्टवेयर प्रोजेक्ट्स की स्थिति, स्वास्थ्य, पेंडिंग टास्क्स और ब्लॉकर्स का विश्लेषण कर सकता हूँ।\n\n` +
        `आप मुझसे पूछ सकते हैं:\n` +
        `• *"आज क्या करना है?"* (Daily priorities)\n` +
        `• *"मेरा ऐप स्लो चल रहा है, चेक करो"* (Performance & health)\n` +
        `• *"प्रोजेक्ट का स्टेटस बताओ"* (Project status)`
      );
    }

    return (
      `Hello! I am your **ProjectPilot AI** operations assistant.\n` +
      `I can help you monitor project health, manage tasks and blockers, inspect repositories, and prepare autonomous recovery plans.\n\n` +
      `Try asking:\n` +
      `• *"What should I work on today?"*\n` +
      `• *"Investigate DevPulse Analytics"*\n` +
      `• *"Show remaining work"*`
    );
  }

  /**
   * Formats an honest, helpful clarification question when user intent lacks critical target information.
   */
  formatClarificationPrompt({ reason, options = [], language = 'en' }) {
    let text = ``;
    if (language === 'mr' || language === 'marathiglish') {
      text += `🤔 **स्पष्टीकरण आवश्यक आहे:**\n${reason}\n\n`;
      if (options.length > 0) {
        text += `कृपया खालीलपैकी एक पर्याय निवडा:\n`;
        options.forEach((opt, idx) => {
          text += `• **${idx + 1}.** ${opt.label || opt}\n`;
        });
      }
    } else if (language === 'hi' || language === 'hinglish') {
      text += `🤔 **कृपया स्पष्ट करें:**\n${reason}\n\n`;
      if (options.length > 0) {
        text += `कृपया नीचे दिए गए विकल्पों में से चुनें:\n`;
        options.forEach((opt, idx) => {
          text += `• **${idx + 1}.** ${opt.label || opt}\n`;
        });
      }
    } else {
      text += `🤔 **Clarification Needed:**\n${reason}\n\n`;
      if (options.length > 0) {
        text += `Please choose from the following options:\n`;
        options.forEach((opt, idx) => {
          text += `• **${idx + 1}.** ${opt.label || opt}\n`;
        });
      }
    }
    return text;
  }
}
