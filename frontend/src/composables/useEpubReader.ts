// src/composables/useEpubReader.ts
import { ref, nextTick } from 'vue'
import { getProgress, upsertProgress, addNote } from '@/lib/books'
import { loadEpubJs } from '@/composables/reader/lazyImport'

/**
 * EPUB 渲染 composable。
 * 暴露 epub state / render / prev / next / gotoChapter / cleanup。
 */
export function useEpubReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  getFontSize: () => number
  onProgressChange: (pct: number, currentPage: number, totalPages: number) => void
  onChapters: (ch: Array<{ id: string; label: string; cfi?: string; index?: number }>) => void
}) {
  const epubRendition = ref<any>(null)
  const epubBook = ref<any>(null)
  const epubCurrentContents = ref<any>(null)
  const epubTotalPages = ref(0)
  const epubCurrentPage = ref(0)

  let epubBlobUrl: string | null = null
  let keyHandler: ((e: KeyboardEvent) => void) | null = null

  function scheduleSaveProgress(cfi: string) {
    const bookId = opts.getBookId()
    if (!bookId) return
    setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi,
        page: epubCurrentPage.value,
        percentage: 0,
      }).catch(() => {})
    }, 1500)
  }

  function detachKeyHandler() {
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler)
      keyHandler = null
    }
  }

  async function render() {
    const ePub = await loadEpubJs()
    if (epubRendition.value) {
      try { epubRendition.value.destroy() } catch {}
      epubRendition.value = null
      epubBook.value = null
      epubCurrentContents.value = null
    }
    if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''

    let bookInput: ArrayBuffer | string
    try {
      const res = await fetch(opts.getFileUrl())
      if (!res.ok) throw new Error('fetch epub failed: ' + res.status)
      bookInput = await res.arrayBuffer()
    } catch (e) {
      if (import.meta.env.DEV) console.error('epub download failed, falling back to URL', e)
      bookInput = opts.getFileUrl()
    }

    const book: any = ePub(bookInput)
    epubBook.value = book

    const rendition: any = book.renderTo(el, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      snap: true,
      allowScriptedContent: true,
    })
    epubRendition.value = rendition
    rendition.themes.fontSize(`${opts.getFontSize()}px`)

    book.on?.('openFailed', (e: any) => {
      if (import.meta.env.DEV) console.error('book openFailed', e)
    })

    // 键盘
    detachKeyHandler()
    keyHandler = (e: KeyboardEvent) => {
      if (!epubRendition.value) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition.value.prev(); e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition.value.next(); e.preventDefault() }
    }
    window.addEventListener('keydown', keyHandler, { passive: false })

    rendition.hooks.content.register((contents: any) => {
      epubCurrentContents.value = contents
      try {
        const docEl = contents.window.document.documentElement
        docEl.addEventListener('click', (e: MouseEvent) => {
          const w = contents.window.innerWidth
          const x = e.clientX
          if (x < w / 3) epubRendition.value?.prev()
          else epubRendition.value?.next()
        })
        let touchStartX = 0
        docEl.addEventListener('touchstart', (e: TouchEvent) => {
          touchStartX = e.changedTouches[0]?.clientX ?? 0
        }, { passive: true })
        docEl.addEventListener('touchend', (e: TouchEvent) => {
          const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX
          if (Math.abs(dx) > 40) {
            if (dx < 0) epubRendition.value?.next()
            else epubRendition.value?.prev()
          }
        }, { passive: true })
        docEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition.value?.prev(); e.preventDefault() }
          if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition.value?.next(); e.preventDefault() }
        })
      } catch (err) {
        if (import.meta.env.DEV) console.warn('iframe hook registration failed', err)
      }
    })

    try {
      await Promise.race([
        book.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('book.ready timeout 15s')), 15000)),
      ])
    } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }

    const bookId = opts.getBookId()
    const saved = bookId ? await getProgress(bookId) : null
    try {
      await rendition.display(saved?.cfi || undefined)
    } catch (e) {
      if (import.meta.env.DEV) console.error('display error', e)
    }

    book.locations.generate(1024).then(() => {
      epubTotalPages.value = book.locations.length()
    }).catch((e: any) => {
      if (import.meta.env.DEV) console.warn('locations.generate failed', e)
    })

    await nextTick()
    try { rendition.resize() } catch {}
    setTimeout(() => { try { rendition.resize() } catch {} }, 200)
    setTimeout(() => { try { rendition.resize() } catch {} }, 800)

    try {
      const toc = book.navigation?.toc || []
      const chapters = (toc || []).map((item: any) => ({
        id: item.id || item.href || '',
        label: item.label || '(无标题)',
        cfi: item.href || undefined,
      }))
      opts.onChapters(chapters)
    } catch (e) {
      if (import.meta.env.DEV) console.error('toc failed', e)
    }

    rendition.on('relocated', (loc: any) => {
      const pct = book.locations?.percentageFromCfi?.(loc.start.cfi)
      const pctNum = typeof pct === 'number' ? pct : 0
      const total = epubTotalPages.value
      const cur = total > 0 ? Math.max(1, Math.round(pctNum * total)) : 0
      opts.onProgressChange(Math.round(pctNum * 100), cur, total)
      scheduleSaveProgress(loc.start.cfi)
    })

    rendition.on('selected', (cfiRange: string, contents: any) => {
      if (confirm('是否将选中文本保存为笔记？')) {
        const sel = contents.window.getSelection()
        const bid = opts.getBookId()
        if (bid) {
          addNote({
            book_id: bid,
            cfi: cfiRange,
            page: null,
            content: sel?.toString() || '',
            comment: null,
            color: '#fbbf24',
          })
        }
      }
    })
  }

  function prev() {
    try { epubRendition.value?.prev() } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }
  }
  function next() {
    try { epubRendition.value?.next() } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }
  }
  function gotoChapter(ch: { cfi?: string; id?: string }) {
    if (ch.cfi && epubRendition.value) {
      epubRendition.value.display(ch.cfi)
    } else {
      try { epubRendition.value?.display() } catch {}
      if (ch.id && epubBook.value) {
        const spineItem = epubBook.value.spine?.get?.(ch.id)
        if (spineItem) spineItem.load?.(epubRendition.value?.getView?.())
      }
    }
  }
  function jumpToPage(page: number) {
    if (epubTotalPages.value === 0 || !epubBook.value?.locations) return
    const target = Math.max(1, Math.min(page, epubTotalPages.value))
    const cfi = epubBook.value.locations.cfiFromLocation(target - 1)
    if (cfi) epubRendition.value?.display(cfi)
  }

  function applyFontSize() {
    try { epubRendition.value?.themes.fontSize(`${opts.getFontSize()}px`) } catch {}
  }

  function destroy() {
    detachKeyHandler()
    try { epubRendition.value?.destroy() } catch {}
    if (epubBook.value) try { epubBook.value.destroy() } catch {}
    if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  }

  return {
    epubRendition, epubBook, epubCurrentContents,
    epubTotalPages, epubCurrentPage,
    render, prev, next, gotoChapter, jumpToPage, applyFontSize, destroy,
  }
}