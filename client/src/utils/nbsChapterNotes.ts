import chapterNotesCatalog from '../data/nbsChapterNotes.json';
import { injectServiceLinks } from './serviceCodes';

export interface NbsChapterNoteSubitem {
    label: string;
    text: string;
}

export interface NbsChapterNoteItem {
    label: string;
    text: string;
    subitems: NbsChapterNoteSubitem[];
}

export interface NbsChapterNotesEntry {
    chapter: string;
    title: string;
    hasOfficialNotes: boolean;
    notes: NbsChapterNoteItem[];
}

const NBS_CHAPTER_NOTES = chapterNotesCatalog as Record<string, NbsChapterNotesEntry>;

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function readCssVariable(variableName: string, fallback: string): string {
    const value = globalThis.getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();

    return value || fallback;
}

export function renderNbsChapterNotesHtml(entry: NbsChapterNotesEntry): string {
    if (!entry.hasOfficialNotes || entry.notes.length === 0) {
        return '<p>Este capítulo não traz notas explicativas oficiais publicadas no PDF base da NBS.</p>';
    }

    const itemsHtml = entry.notes.map((item) => {
        const mainText = injectServiceLinks(escapeHtml(item.text));
        const subitemsHtml = item.subitems.length > 0
            ? `
                <ol class="chapter-note-sublist" type="a">
                    ${item.subitems.map((subitem) => `
                        <li>
                            <p>${injectServiceLinks(escapeHtml(subitem.text))}</p>
                        </li>
                    `).join('')}
                </ol>
            `
            : '';

        return `
            <li>
                <p>${mainText}</p>
                ${subitemsHtml}
            </li>
        `;
    }).join('');

    return `<ol class="chapter-note-list">${itemsHtml}</ol>`;
}

export function getNbsChapterNumber(code: string | null | undefined): string | null {
    if (!code) return null;

    const digits = code.replace(/\D/g, '');
    if (digits.length < 3) return null;

    return digits.slice(1, 3);
}

export function getNbsChapterNotesEntry(code: string | null | undefined): NbsChapterNotesEntry | null {
    const chapter = getNbsChapterNumber(code);
    if (!chapter) return null;

    return NBS_CHAPTER_NOTES[chapter] ?? null;
}

export function getNbsChapterNotesCatalog(): Record<string, NbsChapterNotesEntry> {
    return NBS_CHAPTER_NOTES;
}

export function openNbsChapterNotesTab(entry: NbsChapterNotesEntry): void {
    const chapterWindow = globalThis.open('', '_blank');
    if (!chapterWindow) return;

    const accentPrimary = readCssVariable('--accent-primary', '#a855f7');
    const accentSecondary = readCssVariable('--accent-secondary', '#c084fc');
    const bgPrimary = readCssVariable('--bg-primary', '#0b1020');
    const cardBg = readCssVariable('--dark-card-bg', '#14141e');
    const textPrimary = readCssVariable('--text-primary', '#f8fafc');
    const textSecondary = readCssVariable('--text-secondary', '#cbd5e1');
    const borderColor = readCssVariable('--border-color', 'rgba(148, 163, 184, 0.2)');

    const notesHtml = renderNbsChapterNotesHtml(entry);

    chapterWindow.document.open();
    chapterWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Capítulo ${entry.chapter} - ${escapeHtml(entry.title)}</title>
  <style>
    :root {
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: ${bgPrimary};
      color: ${textPrimary};
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
      color: ${accentSecondary};
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
      color: ${textSecondary};
      font-size: 15px;
    }
    .card {
      background: ${cardBg};
      border: 1px solid ${borderColor};
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
    }
    h2 {
      margin: 0 0 16px;
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: ${accentSecondary};
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
      color: ${textSecondary};
    }
    li::marker {
      color: ${accentSecondary};
      font-weight: 700;
    }
    .chapter-note-sublist {
      margin-top: 10px;
    }
    .service-smart-link {
      color: ${accentPrimary};
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
    }
    .service-smart-link:hover {
      color: ${accentSecondary};
      text-decoration-style: solid;
    }
    .footer {
      margin-top: 20px;
      color: ${textSecondary};
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="eyebrow">NBS • Explicações do capítulo</div>
      <h1>Capítulo ${escapeHtml(entry.chapter)} - ${escapeHtml(entry.title)}</h1>
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
</html>`);
    chapterWindow.document.close();
}
