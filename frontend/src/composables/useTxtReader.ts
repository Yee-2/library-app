// src/composables/useTxtReader.ts
import { ref } from 'vue'
import { getProgress, upsertProgress } from '@/lib/books'
import { detectTxtChapters } from '@/lib/reader/chapterRegex'
import { calcTxtPageSize } from '@/lib/reader/pageSize'
import { escapeHtml } from '@/lib/reader/escapeHtml'

/**
 * TXT 渲染 composable。
 * 暴露 txtContent / page state / pageSize / render / apply / prev / next / jumpToChapter / jumpToPage。
 */
export function useTxtReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  onProgressChange: (pct: number) => void
  onChapters?: (ch: Array<{ id: string; label: string; cfi?: string; index: number }>) => void
}) {
  const txtContent = ref('')
  const txtPage = ref(0)
  const txtTotalPages = ref(1)
  const txtSlideDir = ref<'next' | 'prev' | ''>('')
  const chapters = ref<Array<{ id: string; label: string; cfi?: string; index: number }>>([])

  let progressTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSaveProgress() {
    if (progressTimer) clearTimeout(progressTimer)
    const bookId = opts.getBookId()
    if (!bookId) return
    progressTimer = setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi: null,
        page: txtPage.value + 1,
        percentage: ((txtPage.value + 1) / txtTotalPages.value) * 100,
      }).catch(() => {})
    }, 1500)
  }

  function applyPage() {
    const el = opts.getReaderRef()
    if (!el) return
    const pageSize = calcTxtPageSize(el)
    const start = txtPage.value * pageSize
    let slice = txtContent.value.slice(start, start + pageSize)
    const nextBreak = slice.indexOf('\n\n', Math.max(0, slice.length - 300))
    if (nextBreak > 0 && txtPage.value < txtTotalPages.value - 1) {
      slice = slice.slice(0, nextBreak)
    }
    el.innerHTML = slice
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
      .join('')
    if (txtSlideDir.value) {
      el.classList.remove('page-turn-next', 'page-turn-prev')
      void el.offsetWidth
      el.classList.add(txtSlideDir.value === 'next' ? 'page-turn-next' : 'page-turn-prev')
    }
    txtTotalPages.value = Math.max(1, Math.ceil(txtContent.value.length / pageSize))
    const pct = ((txtPage.value + 1) / txtTotalPages.value) * 100
    opts.onProgressChange(pct)
    scheduleSaveProgress()
  }

  async function render() {
    const res = await fetch(opts.getFileUrl())
    if (!res.ok) throw new Error('下载失败：HTTP ' + res.status)
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    txtContent.value = text
    const pageSize = calcTxtPageSize(opts.getReaderRef())
    txtTotalPages.value = Math.max(1, Math.ceil(text.length / pageSize))
    chapters.value = detectTxtChapters(text)
    opts.onChapters?.(chapters.value)

    const bookId = opts.getBookId()
    const prog = bookId ? await getProgress(bookId) : null
    if (prog?.page) {
      txtPage.value = Math.min(prog.page, txtTotalPages.value - 1)
    } else {
      txtPage.value = 0
    }
    applyPage()
  }

  function prev() {
    if (txtPage.value > 0) {
      txtSlideDir.value = 'prev'
      txtPage.value--
      applyPage()
      txtSlideDir.value = ''
    }
  }
  function next() {
    if (txtPage.value < txtTotalPages.value - 1) {
      txtSlideDir.value = 'next'
      txtPage.value++
      applyPage()
      txtSlideDir.value = ''
    }
  }
  function jumpToChapter(index: number) {
    const ch = chapters.value.find(c => c.index === index)
    if (!ch) return
    const pageSize = calcTxtPageSize(opts.getReaderRef())
    txtPage.value = Math.max(0, Math.floor((ch.index ?? 0) / pageSize))
    applyPage()
  }
  function jumpToPage(page: number) {
    txtPage.value = Math.max(0, Math.min(page - 1, txtTotalPages.value - 1))
    applyPage()
  }

  return {
    txtContent, txtPage, txtTotalPages, txtSlideDir, chapters,
    render, applyPage, prev, next, jumpToChapter, jumpToPage,
  }
}
