export interface NbsChapterNotesPreviewTheme {
    accentPrimary: string;
    accentSecondary: string;
    backgroundPrimary: string;
    cardBackground: string;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
}

export interface NbsChapterNotesDocumentEntry {
    chapter: string;
    title: string;
}

const DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME: NbsChapterNotesPreviewTheme = {
    accentPrimary: '#a855f7',
    accentSecondary: '#c084fc',
    backgroundPrimary: '#0b1020',
    cardBackground: '#14141e',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    borderColor: 'rgba(148, 163, 184, 0.2)',
};

export function escapeNbsChapterNotesHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function readDocumentCssVariableValue(
    documentNode: Document | null | undefined,
    variableName: string,
    fallback: string,
): string {
    if (!documentNode || typeof globalThis.getComputedStyle !== 'function') {
        return fallback;
    }

    try {
        const value = globalThis.getComputedStyle(documentNode.documentElement)
            .getPropertyValue(variableName)
            .trim();

        return value || fallback;
    } catch {
        return fallback;
    }
}

export function resolveNbsChapterNotesPreviewTheme(
    documentNode: Document | null | undefined = globalThis.document,
): NbsChapterNotesPreviewTheme {
    return {
        accentPrimary: readDocumentCssVariableValue(
            documentNode,
            '--accent-primary',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.accentPrimary,
        ),
        accentSecondary: readDocumentCssVariableValue(
            documentNode,
            '--accent-secondary',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.accentSecondary,
        ),
        backgroundPrimary: readDocumentCssVariableValue(
            documentNode,
            '--bg-primary',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.backgroundPrimary,
        ),
        cardBackground: readDocumentCssVariableValue(
            documentNode,
            '--dark-card-bg',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.cardBackground,
        ),
        textPrimary: readDocumentCssVariableValue(
            documentNode,
            '--text-primary',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.textPrimary,
        ),
        textSecondary: readDocumentCssVariableValue(
            documentNode,
            '--text-secondary',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.textSecondary,
        ),
        borderColor: readDocumentCssVariableValue(
            documentNode,
            '--border-color',
            DEFAULT_NBS_CHAPTER_NOTES_PREVIEW_THEME.borderColor,
        ),
    };
}

export function buildNbsChapterNotesDocumentHtml(
    entry: NbsChapterNotesDocumentEntry,
    notesHtml: string,
    theme: NbsChapterNotesPreviewTheme,
): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Capítulo ${entry.chapter} - ${escapeNbsChapterNotesHtml(entry.title)}</title>
  <style>
    :root {
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: ${theme.backgroundPrimary};
      color: ${theme.textPrimary};
      font: 16px/1.75 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 40px 24px 64px;
    }
    .hero {
      display: grid;
      gap: 12px;
      margin-bottom: 24px;
    }
    .eyebrow {
      color: ${theme.accentSecondary};
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1.15;
    }
    .subtitle {
      margin: 0;
      color: ${theme.textSecondary};
      font-size: 15px;
    }
    .card {
      background: ${theme.cardBackground};
      border: 1px solid ${theme.borderColor};
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
    }
    h2 {
      margin: 0 0 16px;
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: ${theme.accentSecondary};
    }
    .chapter-note-list,
    .chapter-note-sublist {
      display: grid;
      gap: 14px;
      margin: 0;
      padding-left: 24px;
    }
    p {
      margin: 0;
      color: ${theme.textSecondary};
    }
    li::marker {
      color: ${theme.accentSecondary};
      font-weight: 700;
    }
    .chapter-note-sublist {
      margin-top: 10px;
    }
    .service-smart-link {
      color: ${theme.accentPrimary};
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
    }
    .service-smart-link:hover {
      color: ${theme.accentSecondary};
      text-decoration-style: solid;
    }
    .footer {
      margin-top: 20px;
      color: ${theme.textSecondary};
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="eyebrow">NBS • Explicações do capítulo</div>
      <h1>Capítulo ${escapeNbsChapterNotesHtml(entry.chapter)} - ${escapeNbsChapterNotesHtml(entry.title)}</h1>
      <p class="subtitle">Notas oficiais extraídas do Anexo I da Portaria Conjunta RFB/SCS nº 1.429, de 12 de setembro de 2018.</p>
    </header>
    <section class="card">
      <h2>Notas</h2>
      ${notesHtml}
    </section>
    <p class="footer">Os códigos destacados podem ser abertos na aba principal da aplicação.</p>
  </main>
  <script>
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var serviceLink = target.closest('.service-smart-link');
      if (!serviceLink) return;
      event.preventDefault();
      var code = serviceLink.getAttribute('data-service-code');
      if (!code) return;
      if (window.opener && window.opener.nesh && typeof window.opener.nesh.smartLinkSearch === 'function') {
        window.opener.nesh.smartLinkSearch(code);
        if (typeof window.opener.focus === 'function') {
          window.opener.focus();
        }
      }
    });
  </script>
</body>
</html>`;
}
