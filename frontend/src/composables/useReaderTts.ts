// src/composables/useReaderTts.ts
import { ref, watch, nextTick } from 'vue'
import { splitSentences, ttsSynthesize, extractPdfText } from '@/lib/tts'
import { calcTxtPageSize } from '@/lib/reader/pageSize'
import { toast } from '@/lib/toast'
import type { Ref } from 'vue'

export function useReaderTts(opts: {
  getBookFormat: () => string | undefined
  getReaderEl: () => HTMLElement | null
  getFileUrl: () => string
  // TXT
  getTxtContent: () => string
  getTxtPage: () => number
  getTxtTotalPages: () => number
  // EPUB
  getEpubRendition: () => any
  getEpubCurrentContents: () => any
  getEpubCurrentPage: () => number
  getEpubTotalPages: () => number
  // PDF
  getPdfDoc: () => any
  getPdfCurrentPage: () => number
  getPdfTotal: () => number
  // navigation
  onNextPage: () => void
}) {
  const ttsPlaying = ref(false)
  const ttsPaused = ref(false)
  const ttsVoice = ref('male-qn-jingying')
  const ttsSpeed = ref(1.0)
  const currentAudio = ref<HTMLAudioElement | null>(null)
  const ttsQueue = ref<string[]>([])
  const ttsIndex = ref(0)
  const showTTSPanel = ref(false)

  // ====== internal helpers ======

  function extractEpubText(): string {
    const rendition = opts.getEpubRendition()
    const contents = opts.getEpubCurrentContents()
    const readerEl = opts.getReaderEl()
    let text = ''
    try {
      let docContents: any = null
      const currentView = rendition?.manager?.current?.()
      if (currentView?.contents) docContents = currentView.contents
      if (!docContents) docContents = contents
      if (!docContents && readerEl) {
        const iframe = readerEl.querySelector('iframe')
        if (iframe?.contentWindow?.document?.body) {
          text = (iframe.contentWindow.document.body.textContent || '').slice(0, 5000)
        }
      }
      if (!text && docContents) {
        text = (docContents.window.document.body.textContent || '').slice(0, 5000)
      }
    } catch { /* best-effort */ }
    return text
  }

  // ====== stop ======

  function stopTTS() {
    ttsPlaying.value = false
    ttsPaused.value = false
    currentAudio.value?.pause()
    currentAudio.value = null
    ttsQueue.value = []
    ttsIndex.value = 0
  }

  // ====== auto-page ======

  async function autoPageAndContinue() {
    const fmt = opts.getBookFormat()
    if (!fmt) { stopTTS(); return }

    let isLast = false
    if (fmt === 'txt') {
      isLast = opts.getTxtPage() >= opts.getTxtTotalPages() - 1
    } else if (fmt === 'pdf') {
      isLast = !opts.getPdfDoc() || opts.getPdfCurrentPage() >= opts.getPdfTotal()
    } else if (fmt === 'epub') {
      const total = opts.getEpubTotalPages()
      isLast = total > 0 && opts.getEpubCurrentPage() >= total
    }
    if (isLast) { stopTTS(); toast.success('朗读完毕'); return }

    try { opts.onNextPage() } catch (e: any) {
      toast.error('翻页失败：' + e.message); stopTTS(); return
    }

    await nextTick()
    await new Promise(r => setTimeout(r, 300))

    let text = ''
    if (fmt === 'txt') {
      const ps = calcTxtPageSize(opts.getReaderEl())
      const start = opts.getTxtPage() * ps
      text = opts.getTxtContent().slice(start, start + ps)
    } else if (fmt === 'epub') {
      text = extractEpubText()
    } else if (fmt === 'pdf') {
      const cur = opts.getPdfCurrentPage() || 1
      try { text = await extractPdfText(opts.getFileUrl(), cur, cur + 1) } catch {}
    }

    if (!text) { toast.error('下一页没有可朗读的文本'); stopTTS(); return }

    const newSentences = splitSentences(text, 280)
    ttsQueue.value.push(...newSentences)
    if (ttsQueue.value.length > 100) {
      const drop = 50
      ttsQueue.value = ttsQueue.value.slice(drop)
      ttsIndex.value = Math.max(0, ttsIndex.value - drop)
    }
    await playNextTTS()
  }

  // ====== play next ======

  async function playNextTTS() {
    if (!ttsPlaying.value) return
    if (ttsIndex.value >= ttsQueue.value.length) { await autoPageAndContinue(); return }
    if (ttsPaused.value) return
    const sentence = ttsQueue.value[ttsIndex.value]
    try {
      const url = await ttsSynthesize(sentence, { voice: ttsVoice.value, speed: ttsSpeed.value })
      if (!ttsPlaying.value) { URL.revokeObjectURL(url); return }
      if (currentAudio.value) { currentAudio.value.pause(); URL.revokeObjectURL(currentAudio.value.src) }
      const audio = new Audio(url)
      currentAudio.value = audio
      audio.onended = () => { URL.revokeObjectURL(url); ttsIndex.value++; playNextTTS() }
      audio.onerror = () => { ttsIndex.value++; playNextTTS() }
      await audio.play()
    } catch (e: any) {
      if (!ttsPlaying.value) return
      toast.error('TTS 失败：' + e.message)
      stopTTS()
    }
  }

  // ====== start ======

  async function startTTS() {
    let text = ''
    const fmt = opts.getBookFormat()
    if (fmt === 'txt') {
      const ps = calcTxtPageSize(opts.getReaderEl())
      const start = opts.getTxtPage() * ps
      text = opts.getTxtContent().slice(start, start + ps)
    } else if (fmt === 'epub') {
      text = extractEpubText()
      if (!text) text = '当前章节无法提取文本'
    } else if (fmt === 'pdf') {
      const doc = opts.getPdfDoc()
      const cur = opts.getPdfCurrentPage() || 1
      if (!doc) { toast.error('PDF 未就绪'); return }
      showTTSPanel.value = true
      try { text = await extractPdfText(opts.getFileUrl(), cur, cur + 2) } catch (e: any) {
        toast.error('PDF 文本提取失败：' + e.message); return
      }
    }
    if (!text) { toast.error('没有可朗读的文本'); return }
    showTTSPanel.value = true
    ttsQueue.value = splitSentences(text, 280)
    ttsIndex.value = 0
    ttsPlaying.value = true
    ttsPaused.value = false
    await playNextTTS()
  }

  // ====== pause / resume ======

  function pauseTTS() { ttsPaused.value = true; currentAudio.value?.pause() }
  function resumeTTS() { ttsPaused.value = false; playNextTTS() }

  // ====== voice/speed change handler ======
  // When voice changes, restart TTS | when speed changes, just update value

  function onSetVoice(id: string) {
    ttsVoice.value = id
    stopTTS()
    startTTS()
  }
  function onSetSpeed(v: number) { ttsSpeed.value = v }

  // cleanup on TTS stop
  function destroy() { stopTTS() }

  return {
    ttsPlaying, ttsPaused, ttsVoice, ttsSpeed, currentAudio, ttsQueue, ttsIndex, showTTSPanel,
    startTTS, pauseTTS, resumeTTS, stopTTS, onSetVoice, onSetSpeed, destroy,
  }
}
