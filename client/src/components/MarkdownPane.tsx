import { marked } from 'marked'
import { useEffect, useRef } from 'react'
import { replaceElementWithSanitizedHtml } from '../utils/contentSecurity'

interface MarkdownPaneProps {
  markdown: string | null | undefined
  className?: string
  wrapSections?: boolean
}

function isFiscalResultHtml(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('<')) return false

  return /\b(?:nesh-|tipi-|section-notas|section-consideracoes|section-definicoes)/.test(
    trimmed
  )
}

export function MarkdownPane({
  markdown,
  className,
  wrapSections = true,
}: MarkdownPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    if (!markdown) {
      containerRef.current.replaceChildren()
      return
    }

    try {
      const rawHtml = isFiscalResultHtml(markdown)
        ? markdown
        : (marked.parse(markdown) as string)
      replaceElementWithSanitizedHtml(containerRef.current, rawHtml)

      if (wrapSections) {
        const container = containerRef.current
        const headings = Array.from(
          container.querySelectorAll('h3.nesh-section')
        )

        headings.forEach((heading) => {
          if (heading.parentElement?.classList.contains('nesh-section-card'))
            return

          const section = document.createElement('section')
          section.className = 'nesh-section-card'

          const dataNcm = heading.getAttribute('data-ncm')
          if (dataNcm) {
            section.setAttribute('data-ncm', dataNcm)
          }

          const body = document.createElement('div')
          body.className = 'nesh-section-body'

          const parent = heading.parentNode
          if (!parent) return

          parent.insertBefore(section, heading)
          section.appendChild(heading)

          let next = section.nextSibling
          while (
            next &&
            !(next instanceof HTMLElement && next.matches('h3.nesh-section'))
          ) {
            const current = next
            next = next.nextSibling
            body.appendChild(current)
          }

          section.appendChild(body)
        })
      }
    } catch (e) {
      console.error('Markdown parse error:', e)
      containerRef.current.textContent = 'Erro ao renderizar conteúdo.'
    }
  }, [markdown, wrapSections])

  return <div ref={containerRef} className={className} />
}
