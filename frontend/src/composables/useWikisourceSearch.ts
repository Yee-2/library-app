// src/composables/useWikisourceSearch.ts
// 搜索维基文库（zh.wikisource.org）中文公版书
// 直接调 MediaWiki API，无需 Supabase

import { ref } from 'vue'

export interface WikisourceResult {
  pageid: number
  title: string
  snippet: string
  chapters: number
}

const WIKI_API = 'https://zh.wikisource.org/w/api.php'

export function useWikisourceSearch() {
  const results = ref<WikisourceResult[]>([])
  const loading = ref(false)
  const error = ref('')

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
      // 1. 搜索
      const searchUrl = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=10&srnamespace=0`
      const res = await fetch(searchUrl)
      const data = await res.json()
      const searchResults = data?.query?.search ?? []

      // 2. 取每个页面的信息（标题、大小）
      const pageTitles = searchResults.map((s: any) => s.title)
      if (pageTitles.length === 0) {
        results.value = []
        return
      }

      // 批量拿页面信息
      const infoUrl = `${WIKI_API}?action=query&titles=${encodeURIComponent(pageTitles.join('|'))}&prop=info&format=json&origin=*`
      const infoRes = await fetch(infoUrl)
      const infoData = await infoRes.json()
      const pages = infoData?.query?.pages ?? {}
      const pageMap: Record<string, any> = {}
      for (const p of Object.values(pages) as any[]) {
        pageMap[p.title] = p
      }

      // 3. 对每个页面查子页面数
      const detailed: WikisourceResult[] = []
      for (const s of searchResults) {
        const info = pageMap[s.title]
        if (!info || info.missing !== undefined) continue

        // 查分类子页面数
        let chapters = 1
        try {
          const catUrl = `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(s.title)}&cmtype=page&format=json&origin=*&cmlimit=500`
          const catRes = await fetch(catUrl, { signal: AbortSignal.timeout(5000) })
          const catData = await catRes.json()
          chapters = Math.max(1, (catData?.query?.categorymembers ?? []).length)
        } catch {
          // 查子页面失败不影响主结果
        }

        detailed.push({
          pageid: info.pageid,
          title: s.title,
          snippet: s.snippet.replace(/<[^>]+>/g, ''),
          chapters,
        })
      }

      results.value = detailed
    } catch (e: any) {
      console.error('[wikisource-search]', e)
      error.value = e?.message ?? '维基文库搜索失败'
      results.value = []
    } finally {
      loading.value = false
    }
  }

  return { results, loading, error, search }
}
