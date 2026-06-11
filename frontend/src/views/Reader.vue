<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBook, getMyBookFileUrl, upsertProgress, getProgress, listBookmarks, addBookmark, deleteBookmark, listNotes, addNote, deleteNote, reportReadingHeartbeat } from '@/lib/books'
import { useReaderStore } from '@/stores/reader'
import { ttsSynthesize, splitSentences, extractPdfText } from '@/lib/tts'
import { useAchievementsStore } from '@/stores/achievements'
import { FONT_OPTIONS, THEME_OPTIONS, TTS_VOICES } from '@/types'
import type { Book, Bookmark, Note } from '@/types'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const ach = useAchievementsStore()
const bookId = computed(() => route.params.id as string)

const book = ref<Book | null>(null)
const fileUrl = ref<string>('')
const loading = ref(true)
const error = ref('')

// 状态面板
const showSettings = ref(false)
const showBookmarks = ref(false)
const showNotes = ref(false)
const showTTS = ref(false)

// 笔记 / 书签
const bookmarks = ref<Bookmark[]>([])
const notes = ref<Note[]>([])
const newNoteText = ref('')
const pendingNote = ref<string>('')

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
let onResize: (() => void) | null = null

onMounted(async () => {
  try {
    // 加载已解锁的成就
    onResize = () => { try { epubRendition?.resize() } catch {} }
    window.addEventListener('resize', onResize)

    ach.init().then(() => ach.checkAll())
    ach.lastHeartbeat = Date.now()
    const loaded = await getBook(bookId.value)
    book.value = loaded
    const me = await currentUserId()
    if (loaded.user_id !== me) {
      error.value = '无权访问此书'
      return
    }
    fileUrl.value = await getMyBookFileUrl(loaded)
    await loadSideData()
    await renderReader()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
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
const txtPageSize = 2000   // 每页字符数
const txtTotalPages = ref(1)
const progressPct = ref(0)

async function renderReader() {
  await nextTick()
  if (!readerRef.value) return
  // 应用阅读偏好
  reader.applyTo(readerRef.value)

  const format = book.value!.file_format
  if (format === 'txt') {
    await renderTxt()
  } else if (format === 'epub') {
    await renderEpub()
  } else if (format === 'pdf') {
    await renderPdf()
  } else {
    error.value = '暂不支持的格式: ' + format
  }
}

async function renderTxt() {
  // fetch 二进制再按 UTF-8 解码，避免 signedUrl 错误 Content-Type 导致
  // res.text() 拿到空 / 乱码（控制台不报错但页面空白）
  const res = await fetch(fileUrl.value)
  if (!res.ok) {
    error.value = '下载失败：HTTP ' + res.status
    return
  }
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  console.debug('[reader] txt decoded length =', text.length, 'bytes =', buf.byteLength)
  txtContent.value = text
  txtTotalPages.value = Math.max(1, Math.ceil(text.length / txtPageSize))
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
  const start = txtPage.value * txtPageSize
  const slice = txtContent.value.slice(start, start + txtPageSize)
  readerRef.value.innerHTML = slice
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')
  progressPct.value = ((txtPage.value + 1) / txtTotalPages.value) * 100
  scheduleSaveProgress()
}

function txtPrev() { if (txtPage.value > 0) { txtPage.value--; applyTxtPage() } }
function txtNext() { if (txtPage.value < txtTotalPages.value - 1) { txtPage.value++; applyTxtPage() } }

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

let epubBook: any = null
let epubRendition: any = null
let epubBlobUrl: string | null = null
async function renderEpub() {
  // 动态导入 epubjs
  const ePub = (await import('epubjs')).default
  if (epubRendition) {
    try { epubRendition.destroy() } catch {}
    epubRendition = null
    epubBook = null
  }
  if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  if (!readerRef.value) return
  readerRef.value.innerHTML = ''

  // 先把文件下载到内存再喂给 epubjs —— 避开 signedUrl 跨域/重定向/Content-Type
  // 不一致带来的 "不报错但渲染空白" 问题
  let epubSrc: string
  try {
    const res = await fetch(fileUrl.value)
    if (!res.ok) throw new Error('fetch epub failed: ' + res.status)
    const blob = await res.blob()
    const proper = blob.type && blob.type.includes('epub')
      ? blob
      : new Blob([blob], { type: 'application/epub+zip' })
    epubBlobUrl = URL.createObjectURL(proper)
    epubSrc = epubBlobUrl
  } catch (e) {
    console.error('[reader] epub download failed', e)
    epubSrc = fileUrl.value
  }

  console.debug('[reader] book source =', epubSrc.startsWith('blob:') ? 'blob:...' + epubSrc.slice(-8) : epubSrc)
  // epubjs: ePub(url) 返回的是 Book，必须 .renderTo(el) 拿 Rendition 才会渲染
  const book: any = ePub(epubSrc)
  epubBook = book

  const rendition: any = book.renderTo(readerRef.value, {
    width: '100%',
    height: '100%',
    spread: 'none',
    manager: 'default',
    flow: 'paginated',
  })
  epubRendition = rendition

  book.on?.('openFailed', (e: any) => console.error('[reader] book openFailed', e))
  book.on?.('closed', () => console.debug('[reader] book closed'))
  rendition.on?.('displayed', () => console.debug('[reader] rendition displayed'))
  rendition.on?.('rendered', (_section: any, view: any) => console.debug('[reader] rendition rendered, view =', view?.nodeName))
  rendition.on?.('layout', (_layout: any) => console.debug('[reader] rendition layout'))

  try {
    await Promise.race([
      book.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('book.ready timeout 15s')), 15000)),
    ])
  } catch (e) {
    console.error('[reader]', e)
  }
  const saved = await getProgress(bookId.value)
  try {
    await rendition.display(saved?.cfi || undefined)
  } catch (e) {
    console.error('[reader] display error', e)
  }

  await nextTick()
  try { rendition.resize() } catch {}
  setTimeout(() => { try { rendition.resize() } catch {} }, 200)
  setTimeout(() => { try { rendition.resize() } catch {} }, 800)
  console.debug('[reader] epub ready, container =', readerRef.value?.clientWidth, 'x', readerRef.value?.clientHeight)
  console.debug('[reader] readerRef innerHTML length =', readerRef.value?.innerHTML.length)
  console.debug('[reader] readerRef children =', readerRef.value?.children.length)
  // 应用偏好样式
  rendition.hooks.content.register((contents: any) => {
    const css = `
      body { font-family: ${reader.font().family} !important;
             font-size: ${reader.fontSize}px !important;
             line-height: ${reader.lineHeight}px !important;
             color: ${reader.theme().color} !important;
             background: ${reader.theme().bg} !important; }
      a { color: inherit; }
    `
    contents.document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`)
  })
  rendition.on('relocated', (loc: any) => {
    const pct = book.locations?.percentageFromCfi?.(loc.start.cfi)
    progressPct.value = (typeof pct === 'number' ? pct : 0) * 100
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
  const pdfjs = await import('pdfjs-dist')
  // 动态设置 worker（Vite import）
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const loadingTask = pdfjs.getDocument(fileUrl.value)
  const pdf = await loadingTask.promise
  if (!readerRef.value) return
  readerRef.value.innerHTML = ''

  const total = pdf.numPages
  const prog = await getProgress(bookId.value)
  const startPage = Math.max(1, prog?.page || 1)
  txtTotalPages.value = total
  txtPage.value = startPage - 1
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
    // 心跳：每 30 秒上报一次阅读统计
    ach.heartbeat(bookId.value, Math.round(progressPct.value * 5))
  }, 1500)
}

onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize)
  if (epubRendition) { try { epubRendition.destroy() } catch {} }
  if (epubBook) { try { epubBook.destroy() } catch {} }
  if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  stopTTS()
})

// =============== 偏好应用 ===============
watch([() => reader.fontId, () => reader.fontSize, () => reader.lineHeight, () => reader.themeId, () => reader.maxWidth], () => {
  if (readerRef.value) reader.applyTo(readerRef.value)
  if (epubRendition && book.value?.file_format === 'epub') {
    // 重新应用 epub 样式
    renderEpub()
  }
})

// =============== TTS ===============
async function startTTS() {
  let text = ''
  if (book.value?.file_format === 'txt') {
    const start = txtPage.value * txtPageSize
    text = txtContent.value.slice(start, start + txtPageSize)
  } else if (book.value?.file_format === 'epub' && epubRendition) {
    // 取当前章节
    try {
      const contents = epubRendition.book.transport?.get?.('current')?.contents
      if (contents) {
        text = (contents.window.document.body.textContent || '').slice(0, 5000)
      } else {
        text = '当前章节无法提取文本'
      }
    } catch {
      text = '当前章节无法提取文本'
    }
  } else if (book.value?.file_format === 'pdf') {
    const pdf = (readerRef.value as any)?.__pdf
    const cur = (readerRef.value as any)?.__currentPage || 1
    if (!pdf) { alert('PDF 未就绪'); return }
    showTTS.value = true
    try {
      text = await extractPdfText(fileUrl.value, cur, cur + 2)   // 读当前 + 后 2 页
    } catch (e: any) {
      alert('PDF 文本提取失败：' + e.message)
      return
    }
  }
  if (!text) {
    alert('没有可朗读的文本')
    return
  }
  showTTS.value = true
  ttsQueue.value = splitSentences(text, 280)
  ttsIndex.value = 0
  ttsPlaying.value = true
  ttsPaused.value = false
  await playNextTTS()
}

async function playNextTTS() {
  if (ttsIndex.value >= ttsQueue.value.length) {
    stopTTS()
    return
  }
  if (ttsPaused.value) return
  const sentence = ttsQueue.value[ttsIndex.value]
  try {
    const url = await ttsSynthesize(sentence, {
      voice: ttsVoice.value,
      speed: ttsSpeed.value,
    })
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
    alert('TTS 失败：' + e.message)
    stopTTS()
  }
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
  bookmarks.value = bookmarks.value.filter(b => b.id !== id)
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
  <div class="min-h-screen flex flex-col">
    <!-- 顶部工具栏 -->
    <header class="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
      <div class="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between gap-2">
        <RouterLink to="/library" class="btn-ghost text-sm">← 返回</RouterLink>
        <div class="flex-1 text-center text-sm font-medium truncate" :title="book?.title">
          {{ book?.title || '加载中…' }}
        </div>
        <div class="flex items-center gap-1">
          <button @click="showBookmarks = true" class="btn-ghost p-1.5" title="书签">🔖</button>
          <button @click="showNotes = true" class="btn-ghost p-1.5" title="笔记">📝</button>
          <button @click="showTTS = true; startTTS()" class="btn-ghost p-1.5" title="AI 听书">🔊</button>
          <button @click="showSettings = true" class="btn-ghost p-1.5" title="设置">⚙️</button>
        </div>
      </div>
      <div class="h-0.5 bg-slate-100">
        <div class="h-full bg-brand-500 transition-all" :style="{ width: progressPct + '%' }"></div>
      </div>
    </header>

    <!-- 阅读区 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-slate-500">加载中…</div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-red-500">{{ error }}</div>
    <div v-else class="flex-1 overflow-auto" @click="(e) => {
      const x = e.offsetX; const w = (e.currentTarget as HTMLElement).clientWidth
      if (w < 768) {
        if (x < w / 3) book?.file_format === 'pdf' ? pdfPrev() : txtPrev()
        else if (x > w * 2 / 3) book?.file_format === 'pdf' ? pdfNext() : txtNext()
      }
    }">
      <div ref="readerRef" class="reader-area" style="height: calc(100vh - 120px); min-height: 480px;"></div>
    </div>

    <!-- 底部翻页（TXT / PDF） -->
    <footer
      v-if="!loading && !error && book && (book.file_format === 'txt' || book.file_format === 'pdf')"
      class="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 py-2"
    >
      <div class="max-w-4xl mx-auto px-4 flex items-center justify-between text-sm">
        <button
          @click="book.file_format === 'pdf' ? pdfPrev() : txtPrev()"
          class="btn-secondary"
        >上一页</button>
        <span class="text-slate-500">
          第 {{ book.file_format === 'pdf' ? (txtPage + 1) : (txtPage + 1) }} / {{ txtTotalPages }} 页
        </span>
        <button
          @click="book.file_format === 'pdf' ? pdfNext() : txtNext()"
          class="btn-secondary"
        >下一页</button>
      </div>
    </footer>

    <!-- 弹窗：设置（字体/主题/字号） -->
    <div v-if="showSettings" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showSettings = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5 max-h-[80vh] overflow-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-semibold">阅读设置</h3>
          <button @click="showSettings = false" class="text-slate-400">✕</button>
        </div>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">字体</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="f in FONT_OPTIONS"
              :key="f.id"
              @click="reader.setFont(f.id)"
              :class="['px-3 py-2 rounded border text-sm',
                       reader.fontId === f.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200']"
              :style="{ fontFamily: f.family }"
            >{{ f.preview }}</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">字号</h4>
          <div class="flex items-center gap-2">
            <button @click="reader.zoom(-2)" class="btn-secondary px-3">A-</button>
            <div class="flex-1 text-center text-sm">{{ reader.fontSize }}px</div>
            <button @click="reader.zoom(2)" class="btn-secondary px-3">A+</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">行间距</h4>
          <input type="range" min="1.2" max="2.4" step="0.1" :value="reader.lineHeight"
                 @input="(e) => reader.setLineHeight(+(e.target as HTMLInputElement).value)" class="w-full" />
          <div class="text-xs text-slate-400 text-center">{{ reader.lineHeight }}</div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">页面宽度</h4>
          <input type="range" min="480" max="960" step="40" :value="reader.maxWidth"
                 @input="(e) => reader.setMaxWidth(+(e.target as HTMLInputElement).value)" class="w-full" />
          <div class="text-xs text-slate-400 text-center">{{ reader.maxWidth }}px</div>
        </section>

        <section>
          <h4 class="text-xs text-slate-500 mb-2">主题</h4>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in THEME_OPTIONS"
              :key="t.id"
              @click="reader.setTheme(t.id)"
              :class="['h-12 rounded border-2',
                       reader.themeId === t.id ? 'border-brand-500' : 'border-transparent']"
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
            <button @click="addCurrentBookmark" class="text-brand-600 text-sm">+ 添加当前页</button>
            <button @click="showBookmarks = false" class="text-slate-400">✕</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto space-y-2">
          <div v-if="bookmarks.length === 0" class="text-center text-slate-400 py-8 text-sm">暂无书签</div>
          <div v-for="b in bookmarks" :key="b.id" class="card p-3 flex items-center gap-2">
            <div class="w-1 self-stretch rounded" :style="{ background: b.color }"></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm">{{ b.note || `第 ${b.page} 页` }}</div>
              <div class="text-xs text-slate-400">{{ new Date(b.created_at).toLocaleString('zh-CN') }}</div>
            </div>
            <button @click="gotoBookmark(b)" class="text-brand-600 text-sm">跳转</button>
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
          <button @click="showNotes = false" class="text-slate-400">✕</button>
        </div>
        <div class="mb-3 flex gap-2">
          <input v-model="newNoteText" placeholder="添加新笔记…" class="input" @keydown.enter="addNoteManual" />
          <button @click="addNoteManual" class="btn-primary">添加</button>
        </div>
        <div class="flex-1 overflow-auto space-y-2">
          <div v-if="notes.length === 0" class="text-center text-slate-400 py-6 text-sm">暂无笔记</div>
          <div v-for="n in notes" :key="n.id" class="card p-3">
            <div class="text-sm whitespace-pre-wrap">{{ n.content }}</div>
            <div v-if="n.comment" class="text-xs text-slate-500 mt-1">批注：{{ n.comment }}</div>
            <div class="flex justify-between items-center mt-2">
              <span class="text-xs text-slate-400">
                {{ n.page ? `第 ${n.page} 页` : '当前位置' }} · {{ new Date(n.created_at).toLocaleString('zh-CN') }}
              </span>
              <button @click="removeNote(n.id)" class="text-red-500 text-xs">删</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗：TTS -->
    <div v-if="showTTS" class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" @click.self="showTTS = false">
      <div class="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-semibold">AI 听书</h3>
          <button @click="showTTS = false; stopTTS()" class="text-slate-400">✕</button>
        </div>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">音色</h4>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="v in TTS_VOICES"
              :key="v.id"
              @click="ttsVoice = v.id; stopTTS(); startTTS()"
              :class="['px-3 py-2 rounded border text-sm text-left',
                       ttsVoice === v.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200']"
            >{{ v.name }}</button>
          </div>
        </section>

        <section class="mb-4">
          <h4 class="text-xs text-slate-500 mb-2">语速 ({{ ttsSpeed.toFixed(1) }}x)</h4>
          <input type="range" min="0.5" max="2.0" step="0.1" v-model.number="ttsSpeed" class="w-full"
                 @change="stopTTS(); startTTS()" />
        </section>

        <div v-if="ttsPlaying" class="text-xs text-slate-500 mb-3">
          正在播放 {{ ttsIndex + 1 }} / {{ ttsQueue.length }} 句
          <div class="h-1 bg-slate-100 rounded mt-1">
            <div class="h-full bg-brand-500 rounded transition-all"
                 :style="{ width: ((ttsIndex + 1) / ttsQueue.length * 100) + '%' }"></div>
          </div>
        </div>

        <div class="flex gap-2">
          <button v-if="!ttsPaused" @click="pauseTTS" :disabled="!ttsPlaying" class="btn-secondary flex-1">⏸ 暂停</button>
          <button v-else @click="resumeTTS" class="btn-primary flex-1">▶ 继续</button>
          <button @click="stopTTS" :disabled="!ttsPlaying" class="btn-secondary">⏹ 停止</button>
          <button @click="startTTS" class="btn-primary">🔄 重新播放</button>
        </div>
        <p class="text-xs text-slate-400 mt-3">由 MiniMax M3 TTS 提供支持</p>
      </div>
    </div>
  </div>
</template>
