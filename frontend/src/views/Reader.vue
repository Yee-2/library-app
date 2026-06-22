<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBook, getMyBookFileUrl, fetchOnlineBookFile, checkIsGutenbergBook, checkIsWikisourceBook, fetchWikisourceBookFile, upsertProgress, addBookmark, addNote } from '@/lib/books'
import { toast } from '@/lib/toast'
import { useReaderStore } from '@/stores/reader'
import { ttsSynthesize, splitSentences, extractPdfText } from '@/lib/tts'
import { useAchievementsStore } from '@/stores/achievements'
import { TTS_VOICES } from '@/types'
import { ListTree, Bookmark as BookmarkIcon, NotebookPen, Volume2, Settings, Pause, Play, Square, ArrowLeft } from 'lucide-vue-next'
import type { Book, Bookmark } from '@/types'
import { calcTxtPageSize } from '@/lib/reader/pageSize'
import { useReaderHeartbeat } from '@/composables/useReaderHeartbeat'
import { useBookSideData } from '@/composables/useBookSideData'
import { useTxtReader } from '@/composables/useTxtReader'
import { useEpubReader } from '@/composables/useEpubReader'
import { usePdfReader } from '@/composables/usePdfReader'
import PanelBookmarks from '@/components/reader/PanelBookmarks.vue'
import PanelNotes from '@/components/reader/PanelNotes.vue'
import PanelSettings from '@/components/reader/PanelSettings.vue'
import PanelToc from '@/components/reader/PanelToc.vue'
import PanelTts from '@/components/reader/PanelTts.vue'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const ach = useAchievementsStore()
const bookId = computed(() => route.params.id as string)

// 心跳（每 30s 上报一次估算阅读时长；标签页隐藏时暂停）
useReaderHeartbeat({
  getBookId: () => bookId.value,
  getProgressPct: () => progressPct.value,
})

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
const sideData = useBookSideData({ getBookId: () => bookId.value })
const { bookmarks, notes, newNoteText, load: loadSideData, removeBookmark, removeNote } = sideData

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
    onResize = () => { try { epub.epubRendition.value?.resize() } catch {} }
    window.addEventListener('resize', onResize)

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

// =============== 阅读器核心 ===============
const readerRef = ref<HTMLElement | null>(null)
const progressPct = ref(0)
const epubCurrentPage = ref(0)
const epubTotalPages = ref(0)

// 根据视口高度动态计算每页字符数（已抽取到 lib/reader/pageSize.ts）

// 目录：epub 从 navigation.toc 拿，txt 从正则识别章节标题
const chapters = ref<Array<{ id: string; label: string; cfi?: string; index?: number }>>([])
const showToc = ref(false)

// TXT 阅读器
const txt = useTxtReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  onProgressChange: (pct) => { progressPct.value = pct },
  onChapters: (ch) => { chapters.value = ch as any },
})
// 模板直接用 txt.txtPage 无法自动解包 — 暴露顶层别名（与 composable 共享同一 Ref）
const txtPage = txt.txtPage
const txtTotalPages = txt.txtTotalPages

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
      await txt.render()
    } else if (format === 'epub') {
      await epub.render()
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

// 跳转到 txt 章节（按字符位置换算到对应 page）
function jumpToTxtChapter(index: number) {
  txt.jumpToChapter(index)
  showToc.value = false
}

// 跳转到 epub 章节（通过 cfi）
function epubGotoChapter(ch: { cfi?: string; id?: string }) {
  epub.gotoChapter(ch)
  showToc.value = false
}

// 统一目录跳转（epub / pdf / txt 分支）
function jumpToChapter(index: number) {
  const fmt = book.value?.file_format
  if (fmt === 'epub') {
    const ch = chapters.value[index]
    if (ch) epubGotoChapter(ch)
  } else if (fmt === 'pdf') {
    pdf.jumpToChapter(index)
  } else if (fmt === 'txt') {
    jumpToTxtChapter(index)
  }
}

function prevPage() {
  if (!book.value) return
  if (book.value.file_format === 'epub') epub.prev()
  else if (book.value.file_format === 'pdf') pdf.prev()
  else txt.prev()
}
function nextPage() {
  if (!book.value) return
  if (book.value.file_format === 'epub') epub.next()
  else if (book.value.file_format === 'pdf') pdf.next()
  else txt.next()
}

function jumpToInputPage() {
  const page = +(pageInputValue.value || 1)
  if (book.value?.file_format === 'epub') {
    epub.jumpToPage(page)
  } else {
    txt.jumpToPage(page)
  }
  pageInputVisible.value = false
}

// EPUB 阅读器
const epub = useEpubReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  getFontSize: () => reader.fontSize,
  onProgressChange: (pct, cur, total) => {
    progressPct.value = pct
    epubCurrentPage.value = cur
    epubTotalPages.value = total
  },
  onChapters: (ch) => { chapters.value = ch },
})

// PDF 阅读器
const pdf = usePdfReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  onProgressChange: (pct, cur, total) => {
    progressPct.value = pct
    txtPage.value = cur - 1
    txtTotalPages.value = total
  },
  onChapters: (ch) => { chapters.value = ch },
})

async function renderPdf() { await pdf.render() }

function scheduleSaveProgress(cfi?: string, page?: number) {
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    upsertProgress({
      book_id: bookId.value,
      cfi: cfi || null,
      page: page ?? (txt.txtPage.value + 1),
      percentage: progressPct.value,
    }).catch(() => {})
    // 心跳改由独立定时器驱动（每 30s 一次），不再依赖翻页
  }, 1500)
}

onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize)
  epub.destroy()
  stopTTS()
})

// =============== 偏好应用 ===============
// 修复：原来这里调用 renderEpub() 会导致死循环（rendition.on('rendered') 持续触发）
// 改为只更新 epubjs 主题/样式，不重新渲染整个书
watch([() => reader.fontId, () => reader.fontSize, () => reader.lineHeight, () => reader.themeId, () => reader.maxWidth], () => {
  if (readerRef.value) reader.applyTo(readerRef.value)
  if (book.value?.file_format === 'epub') {
    // 字号（epubjs 唯一稳定的 API）
    epub.applyFontSize()
  }
})

// =============== TTS ==============
// 注意：TTS 流程对本地书和古登堡在线书完全一致 ——
// 不管 fileUrl 是 Supabase signed URL 还是 gutenberg-fetch 返回的 blob URL，
// renderTxt() 和 renderEpub() 都会把内容加载到前端内存（txt.txtContent / epubBook），
// TTS 直接从内存取文本。所以在线书无需特殊的 TTS 分支。
async function startTTS() {
  let text = ''
  if (book.value?.file_format === 'txt') {
    const pageSize = calcTxtPageSize(readerRef.value)
    const start = txt.txtPage.value * pageSize
    text = txt.txtContent.value.slice(start, start + pageSize)
  } else if (book.value?.file_format === 'epub' && epub.epubRendition.value) {
    // 优先从 rendition 当前 view 获取 contents（避免 epubCurrentContents 因 view 重建而 stale）
    try {
      let contents: any = null
      // 方式 1：从 rendition.manager 当前 view 取
      const currentView = epub.epubRendition.value.manager?.current?.()
      if (currentView?.contents) {
        contents = currentView.contents
      }
      // 方式 2：fallback 到 content hook 缓存
      if (!contents) contents = epub.epubCurrentContents.value
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
    const pdfDoc = pdf.pdfDoc.value
    const cur = pdf.currentPage.value || 1
    if (!pdfDoc) { toast.error('PDF 未就绪'); return }
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
    isLast = txt.txtPage.value >= txt.txtTotalPages.value - 1
  } else if (fmt === 'pdf') {
    isLast = !pdf.pdfDoc.value || pdf.currentPage.value >= pdf.total.value
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
    if (fmt === 'epub') epub.next()
    else if (fmt === 'pdf') pdf.next()
    else txt.next()
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
    const pageSize = calcTxtPageSize(readerRef.value)
    const start = txt.txtPage.value * pageSize
    text = txt.txtContent.value.slice(start, start + pageSize)
  } else if (fmt === 'epub') {
    try {
      let contents: any = null
      const currentView = epub.epubRendition.value?.manager?.current?.()
      if (currentView?.contents) contents = currentView.contents
      if (!contents) contents = epub.epubCurrentContents.value
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
    const cur = pdf.currentPage.value || 1
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
  const cfi = book.value.file_format === 'epub' && epub.epubRendition.value?.currentLocation
    ? epub.epubRendition.value.currentLocation().start.cfi
    : null
  const page = book.value.file_format !== 'epub'
    ? (txt.txtPage.value + 1)
    : null
  const note = prompt('书签备注（可选）') || null
  const b = await addBookmark({ book_id: bookId.value, cfi, page, note, color: '#facc15' })
  bookmarks.value.unshift(b)
}

async function gotoBookmark(b: Bookmark) {
  if (b.cfi && epub.epubRendition.value) {
    await epub.epubRendition.value.display(b.cfi)
  } else if (b.page && book.value?.file_format === 'txt') {
    txt.jumpToPage(b.page)
  } else if (b.page && book.value?.file_format === 'pdf') {
    pdf.jumpToChapter(b.page - 1)
  }
}
// =============== 笔记 ===============
async function addNoteManual() {
  if (!newNoteText.value.trim()) return
  const n = await addNote({
    book_id: bookId.value,
    cfi: epub.epubRendition.value?.currentLocation?.()?.start?.cfi ?? null,
    page: book.value?.file_format !== 'epub' ? (txt.txtPage.value + 1) : null,
    content: newNoteText.value.trim(),
    comment: null,
    color: '#fbbf24',
  })
  notes.value.unshift(n)
  newNoteText.value = ''
}

// 键盘翻页
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (book.value?.file_format === 'epub') return // epubjs 自己处理
  if (e.key === 'ArrowLeft') book.value?.file_format === 'pdf' ? pdf.prev() : txt.prev()
  else if (e.key === 'ArrowRight') book.value?.file_format === 'pdf' ? pdf.next() : txt.next()
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
          :disabled="book.file_format === 'epub' && !epub.epubRendition"
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
          :disabled="book.file_format === 'epub' && !epub.epubRendition"
          class="btn-secondary"
        >下一页</button>
      </div>
    </footer>

    <!-- 弹窗：设置（字体/主题/字号） -->
    <PanelSettings :open="showSettings"
      :fontId="reader.fontId" :themeId="reader.themeId"
      :fontSize="reader.fontSize" :lineHeight="reader.lineHeight" :maxWidth="reader.maxWidth"
      @close="showSettings = false"
      @setFont="reader.setFont" @setTheme="reader.setTheme"
      @zoom="reader.zoom" @setLineHeight="reader.setLineHeight" @setMaxWidth="reader.setMaxWidth" />

    <!-- 弹窗：书签 -->
    <PanelBookmarks :open="showBookmarks" :bookmarks="bookmarks"
      @close="showBookmarks = false"
      @add="addCurrentBookmark"
      @remove="removeBookmark"
      @jump="(b) => gotoBookmark(b)" />

    <!-- 弹窗：笔记 -->
    <PanelNotes :open="showNotes" :notes="notes" :newNoteText="newNoteText"
      @close="showNotes = false"
      @update:newNoteText="newNoteText = $event"
      @add="addNoteManual"
      @remove="removeNote" />

    <!-- 弹窗：TTS -->
    <PanelTts :open="showTTSPanel"
      :playing="ttsPlaying" :paused="ttsPaused"
      :voice="ttsVoice" :speed="ttsSpeed" :voices="TTS_VOICES"
      :index="ttsIndex" :queueLength="ttsQueue.length"
      @close="showTTSPanel = false"
      @play="startTTS"
      @pause="pauseTTS"
      @resume="resumeTTS"
      @stop="stopTTS"
      @restart="startTTS"
      @setVoice="(p) => { ttsVoice = p.id; stopTTS(); startTTS() }"
      @setSpeed="(v) => { ttsSpeed = v }" />

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
    <PanelToc :open="showToc" :chapters="chapters"
      @close="showToc = false"
      @jump="(ch) => { book?.file_format === 'epub' ? epubGotoChapter(ch) : jumpToChapter(ch.index!) }" />

  </div>
</template>
