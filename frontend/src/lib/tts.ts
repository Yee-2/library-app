// src/lib/tts.ts
import { supabase, FUNCTIONS_URL } from './supabase'

/**
 * 把文本发给后端 TTS Edge Function，返回音频 Blob URL
 * 后端会调用 MiniMax M3 的 T2A 接口
 */
export async function ttsSynthesize(
  text: string,
  opts: { voice?: string; speed?: number; format?: 'mp3' | 'wav' } = {}
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('请先登录')

  const res = await fetch(`${FUNCTIONS_URL}/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      text,
      voice: opts.voice ?? 'male-qn-jingying',
      speed: opts.speed ?? 1.0,
      format: opts.format ?? 'mp3',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || err.message || 'TTS 失败')
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** 长文本分句（按中文/英文常见标点） */
export function splitSentences(text: string, maxLen = 300): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  let buf = ''
  for (const ch of normalized) {
    buf += ch
    if (/[。！？!?\n]/.test(ch) || buf.length >= maxLen) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** 用 pdf.js 提取指定页范围的纯文本（按页拼接，过滤空白） */
export async function extractPdfText(fileUrl: string, startPage = 1, endPage?: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjs.getDocument(fileUrl).promise
  const end = Math.min(endPage ?? pdf.numPages, pdf.numPages)
  const parts: string[] = []
  for (let p = startPage; p <= end; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    // 按 y 坐标分行
    const lines: string[] = []
    let lastY: number | null = null
    let line: string[] = []
    for (const item of content.items as any[]) {
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.join(''))
        line = []
      }
      line.push(item.str || '')
      lastY = y
    }
    if (line.length) lines.push(line.join(''))
    parts.push(lines.filter(l => l.trim()).join('\n'))
  }
  return parts.join('\n\n')
}
