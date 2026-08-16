import { useLayoutEffect, useRef } from 'react'
import katex from 'katex'

interface MathFormulaProps {
  latex: string
  /** Readable fallback shown when KaTeX cannot render the template. */
  plainText: string
  displayMode?: boolean
  className?: string
}

/**
 * Centralised KaTeX renderer.
 *
 * Formulas come only from internal templates; user input is never passed as
 * TeX.  Rendering uses the DOM API (`katex.render`) instead of
 * `dangerouslySetInnerHTML`.  KaTeX's `htmlAndMathml` output already provides
 * MathML and aria-hidden behaviour, so the outer container does not add a
 * duplicate role or accessible name unless the render falls back to plain
 * text.
 */
export default function MathFormula({
  latex,
  plainText,
  displayMode = false,
  className,
}: MathFormulaProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (element == null) return

    try {
      element.removeAttribute('data-katex-fallback')
      element.removeAttribute('role')
      element.removeAttribute('aria-label')
      katex.render(latex, element, {
        displayMode,
        output: 'htmlAndMathml',
        throwOnError: true,
        strict: 'error',
        trust: false,
        maxSize: 20,
        maxExpand: 100,
      })
    } catch {
      // `katex.render` throws `katex.ParseError` for invalid input; fall back
      // to readable text.  A single formula must never take down the page.
      element.textContent = plainText
      element.setAttribute('data-katex-fallback', 'true')
      element.setAttribute('role', 'math')
      element.setAttribute('aria-label', plainText)
    }
  }, [latex, plainText, displayMode])

  return <div ref={containerRef} className={className} />
}
