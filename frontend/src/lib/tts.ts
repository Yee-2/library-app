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
