<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBook, getMyBookFileUrl, fetchOnlineBookFile, checkIsGutenbergBook, checkIsWikisourceBook, fetchWikisourceBookFile, upsertProgress, addBookmark, addNote } from '@/lib/books'
import { useReaderStore } from '@/stores/reader'; import { useAchievementsStore } from '@/stores/achievements'
import { TTS_VOICES } from '@/types'; import type { Book, Bookmark } from '@/types'
import { ListTree, Bookmark as BookmarkIcon, NotebookPen, Volume2, Settings, Pause, Play, Square, ArrowLeft } from 'lucide-vue-next'
import { useReaderHeartbeat } from '@/composables/useReaderHeartbeat'; import { useBookSideData } from '@/composables/useBookSideData'
import { useTxtReader } from '@/composables/useTxtReader'; import { useEpubReader } from '@/composables/useEpubReader'
import { usePdfReader } from '@/composables/usePdfReader'; import { useReaderTts } from '@/composables/useReaderTts'
import PanelBookmarks from '@/components/reader/PanelBookmarks.vue'; import PanelNotes from '@/components/reader/PanelNotes.vue'
import PanelSettings from '@/components/reader/PanelSettings.vue'; import PanelToc from '@/components/reader/PanelToc.vue'; import PanelTts from '@/components/reader/PanelTts.vue'

const route = useRoute(); const router = useRouter()
const reader = useReaderStore(); const ach = useAchievementsStore()
const bookId = computed(() => route.params.id as string)

useReaderHeartbeat({ getBookId: () => bookId.value, getProgressPct: () => progressPct.value })

const book = ref<Book | null>(null); const fileUrl = ref<string>('')
const loading = ref(true); const error = ref(''); const isOnlineBook = ref(false)
const onlineBlobUrl = ref<string | null>(null)
const showSettings = ref(false); const showBookmarks = ref(false); const showNotes = ref(false)
const pageInputVisible = ref(false); const pageInputValue = ref(1)
const pageInputRef = ref<HTMLInputElement | null>(null)

const { bookmarks, notes, newNoteText, load: loadSideData, removeBookmark, removeNote } = useBookSideData({ getBookId: () => bookId.value })

const readerRef = ref<HTMLElement | null>(null); const progressPct = ref(0)
const epubCurrentPage = ref(0); const epubTotalPages = ref(0)
const chapters = ref<Array<{ id: string; label: string; cfi?: string; index?: number }>>([])
const showToc = ref(false)
let progressTimer: any; let onResize: (() => void) | null = null

const txt = useTxtReader({
  getBookId: () => bookId.value, getFileUrl: () => fileUrl.value, getReaderRef: () => readerRef.value,
  onProgressChange: (pct) => { progressPct.value = pct },
  onChapters: (ch) => { chapters.value = ch as any } })
const txtPage = txt.txtPage; const txtTotalPages = txt.txtTotalPages

const epub = useEpubReader({
  getBookId: () => bookId.value, getFileUrl: () => fileUrl.value, getReaderRef: () => readerRef.value,
  getFontSize: () => reader.fontSize,
  onProgressChange: (pct, cur, total) => { progressPct.value = pct; epubCurrentPage.value = cur; epubTotalPages.value = total },
  onChapters: (ch) => { chapters.value = ch } })

const pdf = usePdfReader({
  getBookId: () => bookId.value, getFileUrl: () => fileUrl.value, getReaderRef: () => readerRef.value,
  onProgressChange: (pct, cur, total) => { progressPct.value = pct; txtPage.value = cur - 1; txtTotalPages.value = total },
  onChapters: (ch) => { chapters.value = ch } })

const tts = useReaderTts({
  getBookFormat: () => book.value?.file_format, getReaderEl: () => readerRef.value,
  getFileUrl: () => fileUrl.value,
  getTxtContent: () => txt.txtContent.value, getTxtPage: () => txt.txtPage.value,
  getTxtTotalPages: () => txt.txtTotalPages.value,
  getEpubRendition: () => epub.epubRendition.value,
  getEpubCurrentContents: () => epub.epubCurrentContents.value,
  getEpubCurrentPage: () => epubCurrentPage.value, getEpubTotalPages: () => epubTotalPages.value,
  getPdfDoc: () => pdf.pdfDoc.value, getPdfCurrentPage: () => pdf.currentPage.value,
  getPdfTotal: () => pdf.total.value, onNextPage: nextPage })

onMounted(async () => {
  try {
    onResize = () => { try { epub.epubRendition.value?.resize() } catch {} }
    window.addEventListener('resize', onResize)
    await ach.init(); ach.checkAll(); ach.lastHeartbeat = Date.now()
    const loaded = await getBook(bookId.value); book.value = loaded
    const me = await currentUserId()
    if (me && loaded.user_id !== me && !loaded.is_public) { error.value = '无权访问此书（此书属于其他用户）'; return }
    const gbInfo = await checkIsGutenbergBook(bookId.value)
    if (gbInfo?.isGutenberg) {
      isOnlineBook.value = true
      const online = await fetchOnlineBookFile(bookId.value)
      onlineBlobUrl.value = online.blobUrl; fileUrl.value = online.blobUrl
      if (loaded.file_format !== online.format) {
        loaded.file_format = online.format; book.value = { ...loaded, file_format: online.format } }
    } else {
      const wsInfo = await checkIsWikisourceBook(bookId.value)
      if (wsInfo?.isWikisource) {
        isOnlineBook.value = true
        const data = await fetchWikisourceBookFile(bookId.value)
        const blob = new Blob([data.content], { type: 'text/plain; charset=utf-8' })
        onlineBlobUrl.value = URL.createObjectURL(blob); fileUrl.value = onlineBlobUrl.value
        loaded.file_format = 'txt'; book.value = { ...loaded, file_format: 'txt' }
      } else { fileUrl.value = await getMyBookFileUrl(loaded) }
    }
    await loadSideData(); loading.value = false; await renderReader()
  } catch (e: any) { error.value = e.message ?? String(e) } finally { loading.value = false }
})

onBeforeUnmount(() => {
  if (onlineBlobUrl.value) { URL.revokeObjectURL(onlineBlobUrl.value); onlineBlobUrl.value = null }
  if (onResize) window.removeEventListener('resize', onResize); epub.destroy(); tts.destroy()
})

async function currentUserId() { const { data } = await (await import('@/lib/supabase')).supabase.auth.getUser(); return data.user?.id }

async function renderReader() {
  for (let i = 0; i < 5; i++) { await nextTick(); if (readerRef.value) break; await new Promise(r => requestAnimationFrame(r)) }
  if (!readerRef.value) { error.value = '阅读器容器未就绪'; return }
  reader.applyTo(readerRef.value); const fmt = book.value!.file_format
  try {
    if (fmt === 'txt') await txt.render()
    else if (fmt === 'epub') await epub.render()
    else if (fmt === 'pdf') await pdf.render()
    else error.value = '暂不支持的格式: ' + fmt
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

function prevPage() { if (!book.value) return; const f = book.value.file_format; if (f==='epub') epub.prev(); else if (f==='pdf') pdf.prev(); else txt.prev() }
function nextPage() { if (!book.value) return; const f = book.value.file_format; if (f==='epub') epub.next(); else if (f==='pdf') pdf.next(); else txt.next() }

function epubGotoChapter(ch: { cfi?: string; id?: string }) { epub.gotoChapter(ch); showToc.value = false }
function jumpToChapter(index: number) {
  const fmt = book.value?.file_format
  if (fmt === 'epub') { const ch = chapters.value[index]; if (ch) epubGotoChapter(ch) }
  else if (fmt === 'pdf') pdf.jumpToChapter(index)
  else { txt.jumpToChapter(index); showToc.value = false } }

function jumpToInputPage() { const p = +(pageInputValue.value || 1); if (book.value?.file_format === 'epub') epub.jumpToPage(p); else txt.jumpToPage(p); pageInputVisible.value = false }

function scheduleSaveProgress(cfi?: string, page?: number) { clearTimeout(progressTimer); progressTimer = setTimeout(() => upsertProgress({
    book_id: bookId.value, cfi: cfi || null,
    page: page ?? (txt.txtPage.value + 1), percentage: progressPct.value }).catch(() => {}), 1500) }

watch([() => reader.fontId, () => reader.fontSize, () => reader.lineHeight, () => reader.themeId, () => reader.maxWidth], () => {
  if (readerRef.value) reader.applyTo(readerRef.value); if (book.value?.file_format === 'epub') epub.applyFontSize() })

async function addCurrentBookmark() {
  if (!book.value) return
  const cfi = book.value.file_format === 'epub' && epub.epubRendition.value?.currentLocation
    ? epub.epubRendition.value.currentLocation().start.cfi : null
  const b = await addBookmark({ book_id: bookId.value, cfi,
    page: book.value.file_format !== 'epub' ? (txt.txtPage.value + 1) : null,
    note: prompt('书签备注（可选）') || null, color: '#facc15' })
  bookmarks.value.unshift(b) }

async function gotoBookmark(b: Bookmark) {
  if (b.cfi && epub.epubRendition.value) await epub.epubRendition.value.display(b.cfi)
  else if (b.page && book.value?.file_format === 'txt') txt.jumpToPage(b.page)
  else if (b.page && book.value?.file_format === 'pdf') pdf.jumpToChapter(b.page - 1) }

async function addNoteManual() {
  if (!newNoteText.value.trim()) return
  const n = await addNote({ book_id: bookId.value,
    cfi: epub.epubRendition.value?.currentLocation?.()?.start?.cfi ?? null,
    page: book.value?.file_format !== 'epub' ? (txt.txtPage.value + 1) : null,
    content: newNoteText.value.trim(), comment: null, color: '#fbbf24' })
  notes.value.unshift(n); newNoteText.value = '' }

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (book.value?.file_format === 'epub') return
  if (e.key === 'ArrowLeft') { book.value?.file_format === 'pdf' ? pdf.prev() : txt.prev() }
  else if (e.key === 'ArrowRight') { book.value?.file_format === 'pdf' ? pdf.next() : txt.next() } }
onMounted(() => window.addEventListener('keydown', onKey)); onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <header class="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-primary-200">
      <div class="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between gap-2">
        <RouterLink to="/library" class="btn-ghost -ml-2 flex items-center gap-1 text-sm"><ArrowLeft class="w-4 h-4" :stroke-width="1.75" /><span class="hidden sm:inline">返回</span></RouterLink>
        <div class="flex-1 flex items-center justify-center gap-1.5 min-w-0">
          <div class="text-center text-sm font-medium truncate" :title="book?.title">{{ book?.title || '加载中…' }}</div>
          <span v-if="isOnlineBook" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/90 text-white text-[10px] font-medium flex-shrink-0">
            <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>在线</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button @click="showToc = !showToc" class="btn-icon btn-ghost" title="目录"><ListTree class="w-5 h-5" :stroke-width="1.75" /></button>
          <button @click="showBookmarks = true" class="btn-icon btn-ghost" title="书签"><BookmarkIcon class="w-5 h-5" :stroke-width="1.75" /></button>
          <button @click="showNotes = true" class="btn-icon btn-ghost" title="笔记"><NotebookPen class="w-5 h-5" :stroke-width="1.75" /></button>
          <button @click="tts.showTTSPanel.value = true; tts.startTTS()" class="btn-icon btn-ghost" title="AI 听书"><Volume2 class="w-5 h-5" :stroke-width="1.75" /></button>
          <button @click="showSettings = true" class="btn-icon btn-ghost" title="设置"><Settings class="w-5 h-5" :stroke-width="1.75" /></button>
        </div>
      </div>
      <div class="h-0.5 bg-ink-100"><div class="h-full bg-primary-1000 transition-all" :style="{ width: progressPct + '%' }"></div></div>
    </header>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-ink-300">加载中…</div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-red-500">{{ error }}</div>
    <div v-else :class="['flex-1 reader-scroller', book?.file_format !== 'epub' ? 'reader-scroller-paged' : '']"
      @click="(e) => { if (book?.file_format === 'epub') return; const w=(e.currentTarget as HTMLElement).clientWidth; if (w<768) { if (e.offsetX<w/3) prevPage(); else if (e.offsetX>w*2/3) nextPage() } }">
      <div ref="readerRef" class="reader-area" :class="{ 'pb-16': tts.ttsPlaying.value }" style="min-height: calc(100vh - 120px);"></div>
    </div>
    <footer v-if="!loading && !error && book"
      class="sticky bg-white shadow-sm backdrop-blur border-t border-primary-200 py-2 transition-all duration-300"
      :style="{ bottom: tts.ttsPlaying.value && !tts.showTTSPanel.value ? '48px' : '0' }">
      <div class="max-w-4xl mx-auto px-4 flex items-center justify-between text-sm">
        <button @click="prevPage()" :disabled="book.file_format === 'epub' && !epub.epubRendition.value" class="btn-secondary">上一页</button>
        <span class="text-ink-300 cursor-pointer" @click="!pageInputVisible && (pageInputVisible = true)">
          <span v-if="!pageInputVisible">
            <template v-if="book.file_format === 'epub'">
              <template v-if="epubTotalPages > 0">第 {{ epubCurrentPage }} / {{ epubTotalPages }} 页</template>
              <template v-else>{{ Math.round(progressPct) }}%</template>
            </template>
            <template v-else>第 {{ txtPage + 1 }} / {{ txtTotalPages }} 页</template>
          </span>
          <form v-else @submit.prevent="jumpToInputPage" class="inline-flex items-center gap-1">
            <input ref="pageInputRef" v-model="pageInputValue" class="input w-20 text-center text-sm" type="number" min="1"
              :max="book.file_format === 'epub' ? epubTotalPages : txtTotalPages" @blur="pageInputVisible = false" />
            <button type="submit" class="btn-ghost text-xs px-1">跳转</button>
          </form>
        </span>
        <button @click="nextPage()" :disabled="book.file_format === 'epub' && !epub.epubRendition.value" class="btn-secondary">下一页</button>
      </div>
    </footer>

    <PanelSettings :open="showSettings" :fontId="reader.fontId" :themeId="reader.themeId"
      :fontSize="reader.fontSize" :lineHeight="reader.lineHeight" :maxWidth="reader.maxWidth"
      @close="showSettings = false" @setFont="reader.setFont" @setTheme="reader.setTheme"
      @zoom="reader.zoom" @setLineHeight="reader.setLineHeight" @setMaxWidth="reader.setMaxWidth" />
    <PanelBookmarks :open="showBookmarks" :bookmarks="bookmarks" @close="showBookmarks = false"
      @add="addCurrentBookmark" @remove="removeBookmark" @jump="(b) => gotoBookmark(b)" />
    <PanelNotes :open="showNotes" :notes="notes" :newNoteText="newNoteText" @close="showNotes = false"
      @update:newNoteText="newNoteText = $event" @add="addNoteManual" @remove="removeNote" />
    <PanelTts :open="tts.showTTSPanel.value" :playing="tts.ttsPlaying.value" :paused="tts.ttsPaused.value"
      :voice="tts.ttsVoice.value" :speed="tts.ttsSpeed.value" :voices="TTS_VOICES"
      :index="tts.ttsIndex.value" :queueLength="tts.ttsQueue.value.length"
      @close="tts.showTTSPanel.value = false" @play="tts.startTTS" @pause="tts.pauseTTS" @resume="tts.resumeTTS"
      @stop="tts.stopTTS" @restart="tts.startTTS"
      @setVoice="(p) => tts.onSetVoice(p.id)" @setSpeed="(v) => tts.onSetSpeed(v)" />
    <transition enter-active-class="transition-transform duration-300 ease-out" leave-active-class="transition-transform duration-200 ease-in" enter-from-class="translate-y-full" leave-to-class="translate-y-full">
      <div v-if="tts.ttsPlaying.value && !tts.showTTSPanel.value" @click="tts.showTTSPanel.value = true"
        class="fixed bottom-0 left-0 right-0 z-40 bg-white shadow-sm border-t border-primary-200 flex items-center justify-between px-4 h-12 cursor-pointer">
        <div class="flex items-center gap-2 text-sm">
          <Volume2 class="w-4 h-4 text-primary-500 animate-pulse" :stroke-width="1.75" />
          <span class="text-ink-500">AI 听书中</span>
          <span class="text-ink-300">· {{ tts.ttsIndex.value + 1 }}/{{ tts.ttsQueue.value.length }}</span>
        </div>
        <div class="flex items-center gap-2" @click.stop>
          <button v-if="!tts.ttsPaused.value" @click="tts.pauseTTS" class="btn-icon btn-ghost !p-1.5"><Pause class="w-4 h-4" :stroke-width="1.75" /></button>
          <button v-else @click="tts.resumeTTS" class="btn-icon btn-ghost !p-1.5"><Play class="w-4 h-4" :stroke-width="1.75" /></button>
          <button @click="tts.stopTTS" class="btn-icon btn-ghost !p-1.5"><Square class="w-4 h-4" :stroke-width="1.75" /></button>
        </div>
      </div>
    </transition>

    <PanelToc :open="showToc" :chapters="chapters" @close="showToc = false"
      @jump="(ch) => { book?.file_format === 'epub' ? epubGotoChapter(ch) : jumpToChapter(ch.index!) }" />
  </div>
</template>
