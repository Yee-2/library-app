<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBook, getMyBookFileUrl, fetchOnlineBookFile, checkIsGutenbergBook, checkIsWikisourceBook, fetchWikisourceBookFile, upsertProgress, getProgress, listBookmarks, addBookmark, deleteBookmark, listNotes, addNote, deleteNote, reportReadingHeartbeat } from '@/lib/books'
import { toast } from '@/lib/toast'
import { useReaderStore } from '@/stores/reader'
import { ttsSynthesize, splitSentences, extractPdfText } from '@/lib/tts'
import { useAchievementsStore } from '@/stores/achievements'
import { FONT_OPTIONS, THEME_OPTIONS, TTS_VOICES } from '@/types'
import { ListTree, Bookmark as BookmarkIcon, NotebookPen, Volume2, Settings, Pause, Play, Square, RefreshCw, X, ArrowLeft } from 'lucide-vue-next'
import type { Book, Bookmark, Note } from '@/types'
import { loadEpubJs, loadPdfJs } from '@/composables/reader/lazyImport'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const ach = useAchievementsStore()
const bookId = computed(() => route.params.id as string)

const book = ref<Book | null>(null)
const fileUrl = ref<string>('')
const loading = ref(true)
const error = ref('')
const isOnlineBook = ref(false)  // 是否古登堡在线书
const onlineBlobUrl = ref<string | null>(null)  // 卸载时要 revoke

// 状态面板
const showSettings = ref(false)
const showBookmarks = ref(false)
const showNotes = ref(false)
const showTTSPanel = ref(false)

// 快速跳转页码
const pageInputVisible = ref(false)
const pageInputValue = ref(1)
const pageInputRef = ref<HTMLInputElement | null>(null)

// 笔记 / 书签
const bookmarks = ref<Bookmark[]>([])
const notes = ref<Note[]>([])
const newNoteText = ref('')

// TTS
const ttsPlaying = ref(false)
const ttsPaused = ref(false)
const ttsVoice = ref('male-qn-jingying')
const ttsSpeed = ref(1.0)
const currentAudio = ref<HTMLAudioElement | null>(null)
const ttsQueue = ref<string[]>([])
const ttsIndex = ref(0)

// 阅读进度保存防抖
let progressTimer: any
let heartbeatTimer: any           // 独立心跳定时器（与翻页解耦）
let onResize: (() => void) | null = null

// 心跳：估算本次阅读时长（秒），并上报
function reportHeartbeat() {
  if (!bookId.value) return
  const now = Date.now()
  const last = ach.lastHeartbeat || now
  const seconds = Math.max(0, Math.min(600, Math.round((now - last) / 1000)))
  if (seconds > 0) {
    const wordsRead = Math.max(1, Math.round(progressPct.value * 5 / Math.max(1, seconds)))
    ach.heartbeat(bookId.value, wordsRead).catch((e: any) => {
      if (import.meta.env.DEV) console.warn('heartbeat failed', e)
    })
  }
  ach.lastHeartbeat = now
}

function startHeartbeatLoop() {
  // 每 30 秒上报一次，不论用户是否翻页
  heartbeatTimer = setInterval(reportHeartbeat, 30_000)
}

function stopHeartbeatLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  // 退出时立即上报剩余时长
  reportHeartbeat()
}

onMounted(async () => {
  try {
    onResize = () => { try { epubRendition?.resize() } catch {} }
    window.addEventListener('resize', onResize)

    // 启动独立心跳（必须在加载书籍前启动，确保切书时也记录）
    startHeartbeatLoop()

    await ach.init()
    ach.checkAll()
    ach.lastHeartbeat = Date.now()  // init 完成后才设置基准时间，避免首次上报巨大数值
    const loaded = await getBook(bookId.value)
    book.value = loaded
    const me = await currentUserId()
    if (me && loaded.user_id !== me && !loaded.is_public) {
      error.value = '无权访问此书（此书属于其他用户）'
      return
    }

    // 检测是否古登堡在线书
    const gbInfo = await checkIsGutenbergBook(bookId.value)
    if (gbInfo?.isGutenberg) {
      isOnlineBook.value = true
      // 用 gutenberg-fetch 拿 blob URL（已包含 epub/txt 完整文件）
      const online = await fetchOnlineBookFile(bookId.value)
      onlineBlobUrl.value = online.blobUrl
      fileUrl.value = online.blobUrl
      // 古登堡书的 file_format 可能是 'epub' 默认值,确保渲染器选对分支
      if (loaded.file_format !== online.format) {
        loaded.file_format = online.format
        book.value = { ...loaded, file_format: online.format }
      }
    } else {
      // 检测是否维基文库在线书
      const wsInfo = await checkIsWikisourceBook(bookId.value)
      if (wsInfo?.isWikisource) {
        isOnlineBook.value = true
        const data = await fetchWikisourceBookFile(bookId.value)
        // 维基文库返回纯文本，创建 txt blob
        const blob = new Blob([data.content], { type: 'text/plain; charset=utf-8' })
        onlineBlobUrl.value = URL.createObjectURL(blob)
        fileUrl.value = onlineBlobUrl.value
        loaded.file_format = 'txt'
        book.value = { ...loaded, file_format: 'txt' }
      } else {
        fileUrl.value = await getMyBookFileUrl(loaded)
      }
    }

    await loadSideData()
    // 关键：先翻 loading=false 让 <div ref="readerRef"> 挂上 DOM，再 renderReader
    loading.value = false
    await renderReader()
  } catch (e: any) {
    if (import.meta.env.DEV) console.error('onMounted caught:', e)
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  // 释放古登堡书的 blob URL
  if (onlineBlobUrl.value) {
    URL.revokeObjectURL(onlineBlobUrl.value)
    onlineBlobUrl.value = null
  }
})

async function currentUserId() {
  const { data } = await (await import('@/lib/supabase')).supabase.auth.getUser()
  return data.user?.id
}

async function loadSideData() {
  const [b, n] = await Promise.all([listBookmarks(bookId.value), listNotes(bookId.value)])
  bookmarks.value = b
  notes.value = n
}

// =============== 阅读器核心 ===============
const readerRef = ref<HTMLElement | null>(null)
const txtContent = ref('')
const txtPage = ref(0)
const txtTotalPages = ref(1)
const progressPct = ref(0)
const txtSlideDir = ref<'next' | 'prev' | ''>('')  // 翻页动画方向
const epubCurrentPage = ref(0)
const epubTotalPages = ref(0)

// 根据视口高度动态计算每页字符数
function calcTxtPageSize(): number {
  const vh = readerRef.value?.clientHeight || window.innerHeight - 120
  // 18px 字号 × 1.8 行高 ≈ 32px/行，20px padding × 2 = 40px
  const lineHeight = 32  // approx
  const padding = 48
  const linesPerPage = Math.floor((vh - padding) / lineHeight)
  // 中文每行约 18-20 个字符（max-width 720px, 18px font）
  const charsPerLine = 18
  return Math.max(300, linesPerPage * charsPerLine)
}

// 目录：epub 从 navigation.toc 拿，txt 从正则识别章节标题
const chapters = ref<Array<{ id: string; label: string; cfi?: string; index?: number }>>([])
const showToc = ref(false)

async function renderReader() {
  // 等 readerRef 真正挂到 DOM 上 —— onMounted 翻 loading=false 后，v-else 分支的
  // <div ref="readerRef"> 是下一帧才插入的；nextTick + 一次 RAF 足够
  for (let i = 0; i < 5; i++) {
    await nextTick()
    if (readerRef.value) break
    await new Promise(r => requestAnimationFrame(r))
  }
  if (!readerRef.value) {
    if (import.meta.env.DEV) console.error('readerRef still null, abort render')
    error.value = '阅读器容器未就绪'
    return
  }
  // 应用阅读偏好
  reader.applyTo(readerRef.value)

  const format = book.value!.file_format
  try {
    if (format === 'txt') {
      await renderTxt()
    } else if (format === 'epub') {
      await renderEpub()
    } else if (format === 'pdf') {
      await renderPdf()
    } else {
      error.value = '暂不支持的格式: ' + format
    }
  } catch (e: any) {
    if (import.meta.env.DEV) console.error('renderReader caught:', e)
    error.value = e?.message ?? String(e)
  }
}

async function renderTxt() {
  const res = await fetch(fileUrl.value)
  if (!res.ok) {
    error.value = '下载失败：HTTP ' + res.status
    return
  }
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  txtContent.value = text
  const pageSize = calcTxtPageSize()
  txtTotalPages.value = Math.max(1, Math.ceil(text.length / pageSize))

  // 自动识别章节标题
  const chRe = /^(?:\s*)(第[\d一-龥一二三四五六七八九十百千零两]+[章节回卷篇集部]|序章|序言|前言|楔子|尾声|番外|后记|Chapter\s+\d+|CHAPTER\s+\d+|CHAPTER\s+[IVX]+)/i
  const rawLines = text.split(/\r?\n/)
  const found: Array<{ id: string; label: string; index: number }> = []
  let charPos = 0
  for (let i = 0; i < rawLines.length; i++) {
    if (chRe.test(rawLines[i])) {
      found.push({ id: 'txt-ch-' + found.length, label: rawLines[i].trim().slice(0, 60), index: charPos })
    }
    charPos += rawLines[i].length + 1
  }
  chapters.value = found

  const prog = await getProgress(bookId.value)
  if (prog?.page) {
    txtPage.value = Math.min(prog.page, txtTotalPages.value - 1)
  } else {
    txtPage.value = 0
  }
  applyTxtPage()
}

function applyTxtPage() {
  if (!readerRef.value) return
  const pageSize = calcTxtPageSize()
  const start = txtPage.value * pageSize
  let slice = txtContent.value.slice(start, start + pageSize)
  // 向下找下一个空行结尾，避免切到半行
  const nextBreak = slice.indexOf('\n\n', Math.max(0, slice.length - 300))
  if (nextBreak > 0 && txtPage.value < txtTotalPages.value - 1) {
    slice = slice.slice(0, nextBreak)
  }
  readerRef.value.innerHTML = slice
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')
  // 触发翻页动画
  if (txtSlideDir.value) {
    readerRef.value.classList.remove('page-turn-next', 'page-turn-prev')
    // 强制 reflow 让动画重新触发
    void readerRef.value.offsetWidth
    readerRef.value.classList.add(txtSlideDir.value === 'next' ? 'page-turn-next' : 'page-turn-prev')
  }
  // 重新计算总页数（因为 pageSize 可能变化）
  txtTotalPages.value = Math.max(1, Math.ceil(txtContent.value.length / pageSize))
  progressPct.value = ((txtPage.value + 1) / txtTotalPages.value) * 100
  scheduleSaveProgress()
}

// 跳转到 txt 章节（按字符位置换算到对应 page）
let jumpToChapter = (index: number) => {
  const ch = chapters.value.find(c => c.index === index)
  if (!ch) return
  txtPage.value = Math.max(0, Math.floor((ch.index ?? 0) / calcTxtPageSize()))
  applyTxtPage()
  showToc.value = false
}

// 跳转到 epub 章节（通过 cfi）
function gotoEpubChapter(ch: { cfi?: string; id?: string }) {
  if (ch.cfi && epubRendition) {
    epubRendition.display(ch.cfi)
  } else {
    try { epubRendition?.display() } catch {}
    // 如果 cfi 不是合法的 epubjs cfi，尝试按 id 跳转
    if (ch.id && epubBook) {
      const spineItem = epubBook.spine?.get?.(ch.id)
      if (spineItem) spineItem.load?.(epubRendition?.getView?.())
    }
  }
  showToc.value = false
}

function txtPrev() { if (txtPage.value > 0) { txtSlideDir.value = 'prev'; txtPage.value--; applyTxtPage(); txtSlideDir.value = '' } }
function txtNext() { if (txtPage.value < txtTotalPages.value - 1) { txtSlideDir.value = 'next'; txtPage.value++; applyTxtPage(); txtSlideDir.value = '' } }
function epubPrev() { try { epubRendition?.prev() } catch (e) { if (import.meta.env.DEV) console.error(e) } }
function epubNext() { try { epubRendition?.next() } catch (e) { if (import.meta.env.DEV) console.error(e) } }
function prevPage() {
  if (!book.value) return
  if (book.value.file_format === 'epub') epubPrev()
  else if (book.value.file_format === 'pdf') pdfPrev()
  else txtPrev()
}
function nextPage() {
  if (!book.value) return
  if (book.value.file_format === 'epub') epubNext()
  else if (book.value.file_format === 'pdf') pdfNext()
  else txtNext()
}

function jumpToInputPage() {
  const page = +(pageInputValue.value || 1)
  if (book.value?.file_format === 'epub') {
    if (epubTotalPages.value === 0 || !epubBook?.locations) return
    const targetPage = Math.max(1, Math.min(page, epubTotalPages.value))
    const cfi = epubBook.locations.cfiFromLocation(targetPage - 1)
    if (cfi) epubRendition?.display(cfi)
  } else {
    txtPage.value = Math.max(0, Math.min(page - 1, txtTotalPages.value - 1))
    applyTxtPage()
  }
  pageInputVisible.value = false
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

let epubBook: any = null
let epubRendition: any = null
let epubCurrentContents: any = null   // 当前 EPUB 页面的 contents（供 TTS 等使用）
let epubBlobUrl: string | null = null
let epubKeyHandler: ((e: KeyboardEvent) => void) | null = null
let touchStartHandler: ((e: TouchEvent) => void) | null = null
let touchEndHandler: ((e: TouchEvent) => void) | null = null
let isSwiping = false  // 滑动防抖：300ms 内只接受一次

function detachSwipeListeners() {
  if (touchStartHandler && readerRef.value) {
    readerRef.value.removeEventListener('touchstart', touchStartHandler)
  }
  if (touchEndHandler && readerRef.value) {
    readerRef.value.removeEventListener('touchend', touchEndHandler)
  }
  touchStartHandler = null
  touchEndHandler = null
}
async function renderEpub() {
  // 动态导入 epubjs
  const ePub = await loadEpubJs()
  if (epubRendition) {
    try { epubRendition.destroy() } catch {}
    epubRendition = null
    epubBook = null
    epubCurrentContents = null
  }
  if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  if (!readerRef.value) return
  readerRef.value.innerHTML = ''

  // 直接把 epub 作为 ArrayBuffer 喂给 epubjs，避开：
  //   1) signedUrl 经过 CDN 后 Content-Type 错乱
  //   2) blob: URL 走 epubjs 内部的 XHR 失败（0.3.93 已知问题：Cannot load book at blob:...）
  let bookInput: ArrayBuffer | string
  try {
    const res = await fetch(fileUrl.value)
    if (!res.ok) throw new Error('fetch epub failed: ' + res.status)
    bookInput = await res.arrayBuffer()
  } catch (e) {
    if (import.meta.env.DEV) console.error('epub download failed, falling back to URL', e)
    bookInput = fileUrl.value
  }

  // epubjs: ePub(urlOrData) 接受 string 或 ArrayBuffer
  const epubJsBook: any = ePub(bookInput)
  epubBook = epubJsBook

  // 关键配置：flow: 'paginated' 左右翻页（不要 manager: 'continuous'，会导致高度为 0）
  // allowScriptedContent 允许 epub 内的 JS（否则 iframe sandbox 阻止脚本执行）
  const rendition: any = epubJsBook.renderTo(readerRef.value, {
    width: '100%',
    height: '100%',
    spread: 'none',
    flow: 'paginated',
    snap: true,
    allowScriptedContent: true,
  })
  epubRendition = rendition

  // 字号
  rendition.themes.fontSize(`${reader.fontSize}px`)

  epubJsBook.on?.('openFailed', (e: any) => { if (import.meta.env.DEV) console.error('book openFailed', e) })

  // 翻页：键盘左右（外部 window 监听，用于非 epub 格式也生效）
  if (epubKeyHandler) window.removeEventListener('keydown', epubKeyHandler)
  epubKeyHandler = (e: KeyboardEvent) => {
    if (!epubRendition) return
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition.prev(); e.preventDefault() }
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition.next(); e.preventDefault() }
  }
  window.addEventListener('keydown', epubKeyHandler, { passive: false })

  // EPUB iframe 内部点击和触摸翻页（通过 epubjs hooks 注册到 iframe 内部）
  rendition.hooks.content.register((contents: any) => {
    epubCurrentContents = contents   // 保存当前页面引用，供 TTS 等功能使用
    try {
      const docEl = contents.window.document.documentElement

      // 点击翻页：左侧 1/3 上一页，右侧 2/3 下一页
      docEl.addEventListener('click', (e: MouseEvent) => {
        const w = contents.window.innerWidth
        const x = e.clientX
        if (x < w / 3) {
          epubRendition?.prev()
        } else {
          epubRendition?.next()
        }
      })

      // 触摸滑动翻页
      let iframeTouchStartX = 0
      docEl.addEventListener('touchstart', (e: TouchEvent) => {
        iframeTouchStartX = e.changedTouches[0]?.clientX ?? 0
      }, { passive: true })
      docEl.addEventListener('touchend', (e: TouchEvent) => {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - iframeTouchStartX
        if (Math.abs(dx) > 40) {
          if (dx < 0) epubRendition?.next()
          else epubRendition?.prev()
        }
      }, { passive: true })

      // iframe 内部键盘翻页
      docEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition?.prev(); e.preventDefault() }
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition?.next(); e.preventDefault() }
      })
    } catch (err) {
      if (import.meta.env.DEV) console.warn('iframe hook registration failed', err)
    }
  })

  try {
    await Promise.race([
      epubJsBook.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('book.ready timeout 15s')), 15000)),
    ])
  } catch (e) {
    if (import.meta.env.DEV) console.error(e)
  }

  const saved = await getProgress(bookId.value)
  try {
    await rendition.display(saved?.cfi || undefined)
  } catch (e) {
    if (import.meta.env.DEV) console.error('display error', e)
  }

  // 异步生成 location（必须在 display() 之后，否则会破坏 layout 导致 view 高度变 0）
  epubJsBook.locations.generate(1024).then(() => {
    epubTotalPages.value = epubJsBook.locations.length()
    // 重新计算当前页码
    if (epubTotalPages.value > 0) {
      epubCurrentPage.value = Math.max(1, Math.round(progressPct.value / 100 * epubTotalPages.value))
    }
  }).catch((e: any) => {
    if (import.meta.env.DEV) console.warn('locations.generate failed', e)
  })

  await nextTick()
  try { rendition.resize() } catch {}
  setTimeout(() => { try { rendition.resize() } catch {} }, 200)
  setTimeout(() => { try { rendition.resize() } catch {} }, 800)

  // 目录：从 epub 取 navigation.toc
  try {
    const toc = epubJsBook.navigation?.toc || []
    chapters.value = (toc || []).map((item: any) => ({
      id: item.id || item.href || '',
      label: item.label || '(无标题)',
      cfi: item.href || undefined,
    }))
  } catch (e) {
    if (import.meta.env.DEV) console.error('toc failed', e)
  }
  rendition.on('relocated', (loc: any) => {
    // paginated 模式用 percentageFromCfi 计算进度
    const pct = epubJsBook.locations?.percentageFromCfi?.(loc.start.cfi)
    progressPct.value = Math.round((typeof pct === 'number' ? pct : 0) * 100)
    // 计算当前页码
    if (epubTotalPages.value > 0) {
      epubCurrentPage.value = Math.max(1, Math.round(progressPct.value / 100 * epubTotalPages.value))
    }
    scheduleSaveProgress(loc.start.cfi)
  })
  rendition.on('selected', (cfiRange: string, contents: any) => {
    if (confirm('是否将选中文本保存为笔记？')) {
      const sel = contents.window.getSelection()
      addNote({
        book_id: bookId.value,
        cfi: cfiRange,
        page: null,
        content: sel?.toString() || '',
        comment: null,
        color: '#fbbf24',
      }).then((n) => notes.value.unshift(n))
    }
  })
}

async function renderPdf() {
  const pdfjs = await loadPdfJs()

  const loadingTask = pdfjs.getDocument(fileUrl.value)
  const pdf = await loadingTask.promise
  if (!readerRef.value) return
  readerRef.value.innerHTML = ''

  const total = pdf.numPages
  const prog = await getProgress(bookId.value)
  const startPage = Math.max(1, prog?.page || 1)
  txtTotalPages.value = total
  txtPage.value = startPage - 1

  // PDF 目录 = 页码 1..n（简单列表）
  const pdfChapters: Array<{ id: string; label: string; index: number }> = []
  for (let i = 1; i <= total; i++) {
    pdfChapters.push({ id: `pdf-p-${i}`, label: `第 ${i} 页`, index: i - 1 })
  }
  chapters.value = pdfChapters

  // 覆盖跳转函数：pdf 跳到具体页
  const origJump = jumpToChapter
  jumpToChapter = (index: number) => {
    if (book.value?.file_format === 'pdf') {
      const pdf = (readerRef.value as any)?.__pdf
      if (!pdf) return
      const page = index + 1
      ;(readerRef.value as any).__currentPage = page
      txtPage.value = page - 1
      renderPdfPage(pdf, page)
      progressPct.value = (page / pdf.numPages) * 100
      scheduleSaveProgress(undefined, page)
      showToc.value = false
      return
    }
    origJump(index)
  }

  await renderPdfPage(pdf, startPage)
  progressPct.value = (startPage / total) * 100

  ;(readerRef.value as any).__pdf = pdf
  ;(readerRef.value as any).__currentPage = startPage

  scheduleSaveProgress(undefined, startPage)
}

async function renderPdfPage(pdf: any, page: number) {
  if (!readerRef.value) return
  readerRef.value.innerHTML = ''
  const p = await pdf.getPage(page)
  const viewport = p.getViewport({ scale: 1.2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.className = 'mx-auto block max-w-full shadow'
  const ctx = canvas.getContext('2d')!
  await p.render({ canvasContext: ctx, viewport }).promise
  readerRef.value.appendChild(canvas)
}

function pdfPrev() {
  const pdf = (readerRef.value as any)?.__pdf
  const cur = (readerRef.value as any)?.__currentPage
  if (pdf && cur > 1) {
    const np = cur - 1
    ;(readerRef.value as any).__currentPage = np
    txtPage.value = np - 1
    renderPdfPage(pdf, np)
    // 翻页动画
    if (readerRef.value) {
      readerRef.value.classList.remove('page-turn-next', 'page-turn-prev')
      void readerRef.value.offsetWidth
      readerRef.value.classList.add('page-turn-prev')
    }
    progressPct.value = (np / pdf.numPages) * 100
    scheduleSaveProgress(undefined, np)
  }
}
function pdfNext() {
  const pdf = (readerRef.value as any)?.__pdf
  const cur = (readerRef.value as any)?.__currentPage
  if (pdf && cur < pdf.numPages) {
    const np = cur + 1
    ;(readerRef.value as any).__currentPage = np
    txtPage.value = np - 1
    renderPdfPage(pdf, np)
    // 翻页动画
    if (readerRef.value) {
      readerRef.value.classList.remove('page-turn-next', 'page-turn-prev')
      void readerRef.value.offsetWidth
      readerRef.value.classList.add('page-turn-next')
    }
    progressPct.value = (np / pdf.numPages) * 100
    scheduleSaveProgress(undefined, np)
  }
}

function scheduleSaveProgress(cfi?: string, page?: number) {
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    upsertProgress({
      book_id: bookId.value,
      cfi: cfi || null,
      page: page ?? (txtPage.value + 1),
      percentage: progressPct.value,
    }).catch(() => {})
    // 心跳改由独立定时器驱动（每 30s 一次），不再依赖翻页
  }, 1500)
}

onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize)
  if (epubKeyHandler) window.removeEventListener('keydown', epubKeyHandler)
  detachSwipeListeners()
  if (epubRendition) { try { epubRendition.destroy() } catch {} }
  if (epubBook) { try { epubBook.destroy() } catch {} }
  if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  // 退出时立即上报剩余阅读时长（stopHeartbeatLoop 内部会调用 reportHeartbeat）
  stopHeartbeatLoop()
  stopTTS()
})

// =============== 偏好应用 ===============
// 修复：原来这里调用 renderEpub() 会导致死循环（rendition.on('rendered') 持续触发）
// 改为只更新 epubjs 主题/样式，不重新渲染整个书
watch([() => reader.fontId, () => reader.fontSize, () => reader.lineHeight, () => reader.themeId, () => reader.maxWidth], () => {
  if (readerRef.value) reader.applyTo(readerRef.value)
  if (epubRendition && book.value?.file_format === 'epub') {
    // 字号（epubjs 唯一稳定的 API）
    try { epubRendition.themes.fontSize(`${reader.fontSize}px`) } catch {}
  }
})

// =============== TTS ==============
// 注意：TTS 流程对本地书和古登堡在线书完全一致 ——
// 不管 fileUrl 是 Supabase signed URL 还是 gutenberg-fetch 返回的 blob URL，
// renderTxt() 和 renderEpub() 都会把内容加载到前端内存（txtContent / epubBook），
// TTS 直接从内存取文本。所以在线书无需特殊的 TTS 分支。
async function startTTS() {
  let text = ''
  if (book.value?.file_format === 'txt') {
    const pageSize = calcTxtPageSize()
    const start = txtPage.value * pageSize
    text = txtContent.value.slice(start, start + pageSize)
  } else if (book.value?.file_format === 'epub' && epubRendition) {
    // 优先从 rendition 当前 view 获取 contents（避免 epubCurrentContents 因 view 重建而 stale）
    try {
      let contents: any = null
      // 方式 1：从 rendition.manager 当前 view 取
      const currentView = epubRendition.manager?.current?.()
      if (currentView?.contents) {
        contents = currentView.contents
      }
      // 方式 2：fallback 到 content hook 缓存
      if (!contents) contents = epubCurrentContents
      // 方式 3：从 readerRef 内的 iframe 取
      if (!contents && readerRef.value) {
        const iframe = readerRef.value.querySelector('iframe')
        if (iframe?.contentWindow?.document?.body) {
          text = (iframe.contentWindow.document.body.textContent || '').slice(0, 5000)
        }
      }
      if (!text && contents) {
        text = (contents.window.document.body.textContent || '').slice(0, 5000)
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('epub text extraction failed', e)
    }
    if (!text) text = '当前章节无法提取文本'
  } else if (book.value?.file_format === 'pdf') {
    const pdf = (readerRef.value as any)?.__pdf
    const cur = (readerRef.value as any)?.__currentPage || 1
    if (!pdf) { toast.error('PDF 未就绪'); return }
    showTTSPanel.value = true
    try {
      text = await extractPdfText(fileUrl.value, cur, cur + 2)   // 读当前 + 后 2 页
    } catch (e: any) {
      toast.error('PDF 文本提取失败：' + e.message)
      return
    }
  }
  if (!text) {
    toast.error('没有可朗读的文本')
    return
  }
  showTTSPanel.value = true
  ttsQueue.value = splitSentences(text, 280)
  ttsIndex.value = 0
  ttsPlaying.value = true
  ttsPaused.value = false
  await playNextTTS()
}

async function playNextTTS() {
  if (!ttsPlaying.value) return
  if (ttsIndex.value >= ttsQueue.value.length) {
    await autoPageAndContinue()
    return
  }
  if (ttsPaused.value) return
  const sentence = ttsQueue.value[ttsIndex.value]
  try {
    const url = await ttsSynthesize(sentence, {
      voice: ttsVoice.value,
      speed: ttsSpeed.value,
    })
    if (!ttsPlaying.value) { URL.revokeObjectURL(url); return }
    if (currentAudio.value) { currentAudio.value.pause(); URL.revokeObjectURL(currentAudio.value.src) }
    const audio = new Audio(url)
    currentAudio.value = audio
    audio.onended = () => {
      URL.revokeObjectURL(url)
      ttsIndex.value++
      playNextTTS()
    }
    audio.onerror = () => { ttsIndex.value++; playNextTTS() }
    await audio.play()
  } catch (e: any) {
    if (!ttsPlaying.value) return
    toast.error('TTS 失败：' + e.message)
    stopTTS()
  }
}

async function autoPageAndContinue() {
  if (!book.value) { stopTTS(); return }
  const fmt = book.value.file_format

  // 判断是否最后一页
  let isLast = false
  if (fmt === 'txt') {
    isLast = txtPage.value >= txtTotalPages.value - 1
  } else if (fmt === 'pdf') {
    const pdf = (readerRef.value as any)?.__pdf
    const cur = (readerRef.value as any)?.__currentPage || 1
    isLast = !pdf || cur >= pdf.numPages
  } else if (fmt === 'epub') {
    isLast = epubTotalPages.value > 0 && epubCurrentPage.value >= epubTotalPages.value
  }

  if (isLast) {
    stopTTS()
    toast.success('朗读完毕')
    return
  }

  // 翻页
  try {
    if (fmt === 'epub') epubNext()
    else if (fmt === 'pdf') pdfNext()
    else txtNext()
  } catch (e: any) {
    toast.error('翻页失败：' + e.message)
    stopTTS()
    return
  }

  // 等待渲染完成
  await nextTick()
  await new Promise(r => setTimeout(r, 300))

  // 提取新页面文本
  let text = ''
  if (fmt === 'txt') {
    const pageSize = calcTxtPageSize()
    const start = txtPage.value * pageSize
    text = txtContent.value.slice(start, start + pageSize)
  } else if (fmt === 'epub') {
    try {
      let contents: any = null
      const currentView = epubRendition?.manager?.current?.()
      if (currentView?.contents) contents = currentView.contents
      if (!contents) contents = epubCurrentContents
      if (!contents && readerRef.value) {
        const iframe = readerRef.value.querySelector('iframe')
        if (iframe?.contentWindow?.document?.body) {
          text = (iframe.contentWindow.document.body.textContent || '').slice(0, 5000)
        }
      }
      if (!text && contents) {
        text = (contents.window.document.body.textContent || '').slice(0, 5000)
      }
    } catch {}
  } else if (fmt === 'pdf') {
    const cur = (readerRef.value as any)?.__currentPage || 1
    try {
      text = await extractPdfText(fileUrl.value, cur, cur + 1)
    } catch {}
  }

  if (!text) {
    toast.error('下一页没有可朗读的文本')
    stopTTS()
    return
  }

  // 追加到队列
  const newSentences = splitSentences(text, 280)
  ttsQueue.value.push(...newSentences)

  // 队列滚动窗口：> 100 句时丢弃前 50 句
  if (ttsQueue.value.length > 100) {
    const drop = 50
    ttsQueue.value = ttsQueue.value.slice(drop)
    ttsIndex.value = Math.max(0, ttsIndex.value - drop)
  }

  await playNextTTS()
}

function pauseTTS() { ttsPaused.value = true; currentAudio.value?.pause() }
function resumeTTS() { ttsPaused.value = false; playNextTTS() }
function stopTTS() {
  ttsPlaying.value = false
  ttsPaused.value = false
  currentAudio.value?.pause()
  currentAudio.value = null
  ttsQueue.value = []
  ttsIndex.value = 0
}

// =============== 书签 ===============
async function addCurrentBookmark() {
  if (!book.value) return
  const cfi = book.value.file_format === 'epub' && epubRendition?.currentLocation
    ? epubRendition.currentLocation().start.cfi
    : null
  const page = book.value.file_format !== 'epub'
    ? (txtPage.value + 1)
    : null
  const note = prompt('书签备注（可选）') || null
  const b = await addBookmark({ book_id: bookId.value, cfi, page, note, color: '#facc15' })
  bookmarks.value.unshift(b)
}

async function gotoBookmark(b: Bookmark) {
  if (b.cfi && epubRendition) {
    await epubRendition.display(b.cfi)
  } else if (b.page && book.value?.file_format === 'txt') {
    txtPage.value = b.page - 1
    applyTxtPage()
  } else if (b.page && book.value?.file_format === 'pdf') {
    const pdf = (readerRef.value as any)?.__pdf
    if (pdf) {
      ;(readerRef.value as any).__currentPage = b.page
      txtPage.value = b.page - 1
      renderPdfPage(pdf, b.page)
    }
  }
}
async function removeBookmark(id: string) {
  await deleteBookmark(id)
  bookmarks.value = bookmarks.value.filter((b: Bookmark) => b.id !== id)
}

// =============== 笔记 ===============
async function addNoteManual() {
  if (!newNoteText.value.trim()) return
  const n = await addNote({
    book_id: bookId.value,
    cfi: epubRendition?.currentLocation?.()?.start?.cfi ?? null,
    page: book.value?.file_format !== 'epub' ? (txtPage.value + 1) : null,
    content: newNoteText.value.trim(),
    comment: null,
    color: '#fbbf24',
  })
  notes.value.unshift(n)
  newNoteText.value = ''
}
async function removeNote(id: string) {
  await deleteNote(id)
  notes.value = notes.value.filter(n => n.id !== id)
}

// 键盘翻页
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (book.value?.file_format === 'epub') return // epubjs 自己处理
  if (e.key === 'ArrowLeft') book.value?.file_format === 'pdf' ? pdfPrev() : txtPrev()
  else if (e.key === 'ArrowRight') book.value?.file_format === 'pdf' ? pdfNext() : txtNext()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <!-- 顶部工具栏 -->
    <header class="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-primary-200">
      <div class="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between gap-2">
        <RouterLink to="/library" class="btn-ghost -ml-2 flex items-center gap-1 text-sm">
          <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
          <span class="hidden sm:inline">返回</span>
        </RouterLink>
        <div class="flex-1 flex items-center justify-center gap-1.5 min-w-0">
          <div class="text-center text-sm font-medium truncate" :title="book?.title">
            {{ book?.title || '加载中…' }}
          </div>
          <span v-if="isOnlineBook" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                   bg-emerald-500/90 text-white text-[10px] font-medium flex-shrink-0">
            <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            在线
          </span>
        </div>
        <div class="flex items-center gap-0.5">
          <button @click="showToc = !showToc" class="btn-icon btn-ghost" title="目录">
            <ListTree class="w-5 h-5" :stroke-width="1.75" />
          </button>
          <button @click="showBookmarks = true" class="btn-icon btn-ghost" title="书签">
            <BookmarkIcon class="w-5 h-5" :stroke-width="1.75" />
          </button>
          <button @click="showNotes = true" class="btn-icon btn-ghost" title="笔记">
            <NotebookPen class="w-5 h-5" :stroke-width="1.75" />
          </button>
          <button @click="showTTSPanel = true; startTTS()" class="btn-icon btn-ghost" title="AI 听书">
            <Volume2 class="w-5 h-5" :stroke-width="1.75" />
          </button>
          <button @click="showSettings = true" class="btn-icon btn-ghost" title="设置">
            <Settings class="w-5 h-5" :stroke-width="1.75" />
          </button>
        </div>
      </div>
      <div class="h-0.5 bg-ink-100">
        <div class="h-full bg-primary-1000 transition-all" :style="{ width: progressPct + '%' }"></div>
      </div>
    </header>

    <!-- 阅读区 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-ink-300">加载中…</div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-red-500">{{ error }}</div>
    <div v-else
      :class="['flex-1 reader-scroller', book?.file_format !== 'epub' ? 'reader-scroller-paged' : '']"
      @click="(e) => {
      // 点击翻页（txt + pdf）：
      //   左 1/3 → 上一页，右 2/3 → 下一页
      //   epubjs 自己处理翻页，所以 epub 不在这里绑定
      if (book?.file_format === 'epub') return
      const x = e.offsetX; const w = (e.currentTarget as HTMLElement).clientWidth
      if (w < 768) {
        if (x < w / 3) prevPage()
        else if (x > w * 2 / 3) nextPage()
      }
    }">
      <div ref="readerRef" class="reader-area" :class="{ 'pb-16': ttsPlaying }" style="min-height: calc(100vh - 120px);"></div>
    </div>

    <!-- 底部翻页 -->
    <footer
      v-if="!loading && !error && book"
      class="sticky bg-white shadow-sm backdrop-blur border-t border-primary-200 py-2 transition-all duration-300"
      :style="{ bottom: ttsPlaying && !showTTSPanel ? '48px' : '0' }"
    >
      <div class="max-w-4xl mx-auto px-4 flex items-center justify-between text-sm">
        <button
          @click="prevPage()"
          :disabled="book.file_format === 'epub' && !epubRendition"
          class="btn-secondary"
        >上一页</button>
        <span class="text-ink-300">
          <!-- 快速跳转页码 -->
          <span class="cursor-pointer" @click="pageInputVisible = true" v-if="!pageInputVisible">
            <template v-if="book.file_format === 'epub'">
              <template v-if="epubTotalPages > 0">
                第 {{ epubCurrentPage }} / {{ epubTotalPages }} 页
              </template>
              <template v-else>
                {{ Math.round(progressPct) }}%
              </template>
            </template>
            <template v-else>
              第 {{ txtPage + 1 }} / {{ txtTotalPages }} 页
            </template>
          </span>
          <form v-else @submit.prevent="jumpToInputPage" class="inline-flex items-center gap-1">
            <input
              ref="pageInputRef"
              v-model="pageInputValue"
              class="input w-20 text-center text-sm"
              type="number"
              min="1"
              :max="book.file_format === 'epub' ? epubTotalPages : txtTotalPages"
              placeholder="页码"
              @blur="pageInputVisible = false"
            />
            <button type="submit" class="btn-ghost text-xs px-1">跳转</button>
          </form>
        </span>
        <button
          @click="nextPage()"
          :disabled="book.file_format === 'epub' && !epubRendition"
          class="btn-secondary"
        >下一页</button>
      </div>
    </footer>

    <!-- 弹窗：设置（字体/主题/字号） -->
    <div v-if="showSettings" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showSettings = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] overflow-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-semibold">阅读设置</h3>
          <button @click="showSettings = false" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">字体</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="f in FONT_OPTIONS"
              :key="f.id"
              @click="reader.setFont(f.id)"
              :class="['px-3 py-2 rounded border text-sm',
                       reader.fontId === f.id ? 'border-primary-500 bg-primary-100 text-primary-600' : 'border-primary-200']"
              :style="{ fontFamily: f.family }"
            >{{ f.preview }}</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">字号</h4>
          <div class="flex items-center gap-2">
            <button @click="reader.zoom(-2)" class="btn-secondary px-3">A-</button>
            <div class="flex-1 text-center text-sm">{{ reader.fontSize }}px</div>
            <button @click="reader.zoom(2)" class="btn-secondary px-3">A+</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">行间距</h4>
          <input type="range" min="1.2" max="2.4" step="0.1" :value="reader.lineHeight"
                 @input="(e) => reader.setLineHeight(+(e.target as HTMLInputElement).value)" class="w-full" />
          <div class="text-xs text-ink-300 text-center">{{ reader.lineHeight }}</div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">页面宽度</h4>
          <input type="range" min="480" max="960" step="40" :value="reader.maxWidth"
                 @input="(e) => reader.setMaxWidth(+(e.target as HTMLInputElement).value)" class="w-full" />
          <div class="text-xs text-ink-300 text-center">{{ reader.maxWidth }}px</div>
        </section>

        <section>
          <h4 class="text-xs text-ink-300 mb-2">主题</h4>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in THEME_OPTIONS"
              :key="t.id"
              @click="reader.setTheme(t.id)"
              :class="['h-12 rounded border-2',
                       reader.themeId === t.id ? 'border-primary-500' : 'border-transparent']"
              :style="{ background: t.bg, color: t.color }"
            >{{ t.name }}</button>
          </div>
        </section>
      </div>
    </div>

    <!-- 弹窗：书签 -->
    <div v-if="showBookmarks" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showBookmarks = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold">书签 ({{ bookmarks.length }})</h3>
          <div class="flex items-center gap-2">
            <button @click="addCurrentBookmark" class="text-primary-600 text-sm">+ 添加当前页</button>
            <button @click="showBookmarks = false" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
          </div>
        </div>
        <div class="flex-1 overflow-auto space-y-2">
          <div v-if="bookmarks.length === 0" class="text-center text-ink-300 py-8 text-sm">暂无书签</div>
          <div v-for="b in bookmarks" :key="b.id" class="card p-3 flex items-center gap-2">
            <div class="w-1 self-stretch rounded" :style="{ background: b.color }"></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm">{{ b.note || `第 ${b.page} 页` }}</div>
              <div class="text-xs text-ink-300">{{ new Date(b.created_at).toLocaleString('zh-CN') }}</div>
            </div>
            <button @click="gotoBookmark(b)" class="text-primary-600 text-sm">跳转</button>
            <button @click="removeBookmark(b.id)" class="text-red-500 text-sm">删</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗：笔记 -->
    <div v-if="showNotes" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showNotes = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold">笔记 ({{ notes.length }})</h3>
          <button @click="showNotes = false" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>
        <div class="mb-3 flex gap-2">
          <input v-model="newNoteText" placeholder="添加新笔记…" class="input" @keydown.enter="addNoteManual" />
          <button @click="addNoteManual" class="btn-primary">添加</button>
        </div>
        <div class="flex-1 overflow-auto space-y-2">
          <div v-if="notes.length === 0" class="text-center text-ink-300 py-6 text-sm">暂无笔记</div>
          <div v-for="n in notes" :key="n.id" class="card p-3">
            <div class="text-sm whitespace-pre-wrap">{{ n.content }}</div>
            <div v-if="n.comment" class="text-xs text-ink-300 mt-1">批注：{{ n.comment }}</div>
            <div class="flex justify-between items-center mt-2">
              <span class="text-xs text-ink-300">
                {{ n.page ? `第 ${n.page} 页` : '当前位置' }} · {{ new Date(n.created_at).toLocaleString('zh-CN') }}
              </span>
              <button @click="removeNote(n.id)" class="text-red-500 text-xs">删</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗：TTS -->
    <div v-if="showTTSPanel" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showTTSPanel = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-semibold">AI 听书</h3>
          <button @click="showTTSPanel = false" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">音色</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="v in TTS_VOICES"
              :key="v.id"
              @click="ttsVoice = v.id; stopTTS(); startTTS()"
              :class="['px-3 py-2 rounded border text-sm text-left',
                       ttsVoice === v.id ? 'border-primary-500 bg-primary-100 text-primary-600' : 'border-primary-200']"
            >{{ v.name }}</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-ink-300 mb-2">语速 ({{ ttsSpeed.toFixed(1) }}x)</h4>
          <input type="range" min="0.5" max="2.0" step="0.1" v-model.number="ttsSpeed" class="w-full"
                 @change="stopTTS(); startTTS()" />
        </section>

        <div v-if="ttsPlaying" class="text-xs text-ink-300 mb-3">
          正在播放 {{ ttsIndex + 1 }} / {{ ttsQueue.length }} 句
          <div class="h-1 bg-ink-100 rounded mt-1">
            <div class="h-full bg-primary-1000 rounded transition-all"
                 :style="{ width: ((ttsIndex + 1) / ttsQueue.length * 100) + '%' }"></div>
          </div>
        </div>

        <div class="flex gap-2">
          <button v-if="!ttsPaused" @click="pauseTTS" :disabled="!ttsPlaying" class="btn-secondary flex-1">
            <Pause class="w-4 h-4" :stroke-width="1.75" />
            <span>暂停</span>
          </button>
          <button v-else @click="resumeTTS" class="btn-primary flex-1">
            <Play class="w-4 h-4" :stroke-width="1.75" />
            <span>继续</span>
          </button>
          <button @click="stopTTS" :disabled="!ttsPlaying" class="btn-secondary">
            <Square class="w-4 h-4" :stroke-width="1.75" />
            <span>停止</span>
          </button>
          <button @click="startTTS" class="btn-primary">
            <RefreshCw class="w-4 h-4" :stroke-width="1.75" />
            <span>重新播放</span>
          </button>
        </div>
        <p class="text-xs text-ink-300 mt-3">由 MiniMax M3 TTS 提供支持</p>
      </div>
    </div>

    <!-- 迷你播放条 -->
    <transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-200 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div v-if="ttsPlaying && !showTTSPanel"
           @click="showTTSPanel = true"
           class="fixed bottom-0 left-0 right-0 z-40 bg-white shadow-sm border-t border-primary-200 flex items-center justify-between px-4 h-12 cursor-pointer">
        <div class="flex items-center gap-2 text-sm">
          <Volume2 class="w-4 h-4 text-primary-500 animate-pulse" :stroke-width="1.75" />
          <span class="text-ink-500">AI 听书中</span>
          <span class="text-ink-300">· {{ ttsIndex + 1 }}/{{ ttsQueue.length }}</span>
        </div>
        <div class="flex items-center gap-2" @click.stop>
          <button v-if="!ttsPaused" @click="pauseTTS" class="btn-icon btn-ghost !p-1.5">
            <Pause class="w-4 h-4" :stroke-width="1.75" />
          </button>
          <button v-else @click="resumeTTS" class="btn-icon btn-ghost !p-1.5">
            <Play class="w-4 h-4" :stroke-width="1.75" />
          </button>
          <button @click="stopTTS" class="btn-icon btn-ghost !p-1.5">
            <Square class="w-4 h-4" :stroke-width="1.75" />
          </button>
        </div>
      </div>
    </transition>

    <!-- 弹窗：目录 -->
    <div v-if="showToc" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showToc = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold">目录 ({{ chapters.length }})</h3>
          <button @click="showToc = false" class="text-ink-300"><X class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>
        <div v-if="chapters.length === 0" class="text-center text-ink-300 py-6 text-sm">暂无目录</div>
        <div class="flex-1 overflow-auto space-y-1">
          <div v-for="(ch, i) in chapters" :key="ch.id || i"
               @click="book?.file_format === 'epub' ? gotoEpubChapter(ch) : jumpToChapter(ch.index!)"
               class="card p-3 cursor-pointer hover:bg-ink-100 transition text-sm"
               :title="ch.label">
            <div class="truncate">{{ i + 1 }}. {{ ch.label }}</div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
