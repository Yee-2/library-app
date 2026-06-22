// src/composables/usePdfReader.ts
import { ref } from 'vue'
import { getProgress, upsertProgress } from '@/lib/books'
import { loadPdfJs } from '@/composables/reader/lazyImport'

/**
 * PDF 渲染 composable。
 * 暴露 pdf state / render / prev / next / jumpToChapter / cleanup。
 */
export function usePdfReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  onProgressChange: (pct: number, currentPage: number, totalPages: number) => void
  onChapters: (ch: Array<{ id: string; label: string; cfi?: string; index: number }>) => void
}) {
  const total = ref(0)
  const currentPage = ref(1)
  const pdfDoc = ref<any>(null)

  let progressTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSaveProgress(page: number) {
    if (progressTimer) clearTimeout(progressTimer)
    const bookId = opts.getBookId()
    if (!bookId) return
    progressTimer = setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi: null,
        page,
        percentage: total.value > 0 ? (page / total.value) * 100 : 0,
      }).catch(() => {})
    }, 1500)
  }

  async function renderPage(pdf: any, page: number) {
    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''
    const p = await pdf.getPage(page)
    const viewport = p.getViewport({ scale: 1.2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.className = 'mx-auto block max-w-full shadow'
    const ctx = canvas.getContext('2d')!
    await p.render({ canvasContext: ctx, viewport }).promise
    el.appendChild(canvas)
  }

  function triggerPageAnim(direction: 'next' | 'prev') {
    const el = opts.getReaderRef()
    if (!el) return
    el.classList.remove('page-turn-next', 'page-turn-prev')
    void el.offsetWidth
    el.classList.add(direction === 'next' ? 'page-turn-next' : 'page-turn-prev')
  }

  async function render() {
    const pdfjs = await loadPdfJs()
    const loadingTask = pdfjs.getDocument(opts.getFileUrl())
    const pdf = await loadingTask.promise
    pdfDoc.value = pdf

    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''

    total.value = pdf.numPages
    const bookId = opts.getBookId()
    const prog = bookId ? await getProgress(bookId) : null
    const startPage = Math.max(1, prog?.page || 1)
    currentPage.value = startPage

    const pdfChapters: Array<{ id: string; label: string; index: number }> = []
    for (let i = 1; i <= total.value; i++) {
      pdfChapters.push({ id: `pdf-p-${i}`, label: `第 ${i} 页`, index: i - 1 })
    }
    opts.onChapters(pdfChapters)

    await renderPage(pdf, startPage)
    opts.onProgressChange((startPage / total.value) * 100, startPage, total.value)
    scheduleSaveProgress(startPage)
  }

  function prev() {
    const pdf = pdfDoc.value
    if (!pdf || currentPage.value <= 1) return
    const np = currentPage.value - 1
    currentPage.value = np
    renderPage(pdf, np)
    triggerPageAnim('prev')
    opts.onProgressChange((np / total.value) * 100, np, total.value)
    scheduleSaveProgress(np)
  }
  function next() {
    const pdf = pdfDoc.value
    if (!pdf || currentPage.value >= total.value) return
    const np = currentPage.value + 1
    currentPage.value = np
    renderPage(pdf, np)
    triggerPageAnim('next')
    opts.onProgressChange((np / total.value) * 100, np, total.value)
    scheduleSaveProgress(np)
  }
  function jumpToChapter(index: number) {
    const pdf = pdfDoc.value
    if (!pdf) return
    const page = index + 1
    currentPage.value = page
    renderPage(pdf, page)
    opts.onProgressChange((page / pdf.numPages) * 100, page, pdf.numPages)
    scheduleSaveProgress(page)
  }

  return {
    total, currentPage, pdfDoc,
    render, prev, next, jumpToChapter,
  }
}
