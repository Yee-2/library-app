// src/composables/useGutenbergSearch.ts
// 搜索古登堡本地目录（gutenberg_catalog 表）
// 策略：先判定查询语言（中文 zh / 英文 en），再按 trigram 索引做模糊匹配

import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface GutenbergBook {
  gutenberg_id: number
  title: string
  author: string | null
  language: 'zh' | 'en'
  cover_url: string | null
  download_count: number
}

export function useGutenbergSearch() {
  const results = ref<GutenbergBook[]>([])
  const loading = ref(false)
  const error = ref('')

  /** 用 CJK 字符比例判断语言 */
  function detectLanguage(q: string): 'zh' | 'en' {
    if (!q) return 'en'
    const cjkChars = (q.match(/[一-鿿㐀-䶿]/g) || []).length
    return cjkChars > 0 ? 'zh' : 'en'
  }

  async function search(q: string) {
    const query = q.trim()
    if (!query) {
      results.value = []
      error.value = ''
      return
    }

    loading.value = true
    error.value = ''
    try {
      const lang = detectLanguage(query)
      // 用 ILIKE 兜底 + 排序：title 命中 > author 命中 > download_count
      const escaped = query.replace(/[%_]/g, '\\$&')  // 转义 LIKE 通配符
      const { data, error: qErr } = await supabase
        .from('gutenberg_catalog')
        .select('gutenberg_id, title, author, language, cover_url, download_count')
        .eq('language', lang)
        .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`)
        .order('download_count', { ascending: false })
        .limit(10)

      if (qErr) throw qErr
      results.value = (data ?? []) as GutenbergBook[]
    } catch (e: any) {
      console.error('[gutenberg-search]', e)
      error.value = e?.message ?? '古登堡搜索失败'
      results.value = []
    } finally {
      loading.value = false
    }
  }

  /** 拉取热门古登堡书（按下载量），用于初次展示 */
  async function fetchPopular(language: 'zh' | 'en' = 'en', limit = 10) {
    loading.value = true
    error.value = ''
    try {
      const { data, error: qErr } = await supabase
        .from('gutenberg_catalog')
        .select('gutenberg_id, title, author, language, cover_url, download_count')
        .eq('language', language)
        .order('download_count', { ascending: false })
        .limit(limit)
      if (qErr) throw qErr
      results.value = (data ?? []) as GutenbergBook[]
    } catch (e: any) {
      console.error('[gutenberg-popular]', e)
      error.value = e?.message ?? '加载失败'
      results.value = []
    } finally {
      loading.value = false
    }
  }

  return { results, loading, error, search, fetchPopular }
}