// src/composables/useWikisourceSearch.ts
// 搜索维基文库（zh.wikisource.org）中文公版书
//
// 问题：zh.wikisource 的 NS 0 包含大量法院判决书和公司公告，
// 必须按分类（categories）过滤，只保留文学/文化类作品。
//
// 策略：
// 1. 搜索得到结果
// 2. 批量查每个页面的分类（1 次 API 调用）
// 3. 只保留属于文学/文化分类的页面
// 4. 快速预过滤：标题含公司/判决书关键词的直接跳过分类查询

import { ref } from 'vue'

export interface WikisourceResult {
  pageid: number
  title: string
  snippet: string
  chapters: number
}

const WIKI_API = 'https://zh.wikisource.org/w/api.php'

// 这些分类下的页面是合法的文学作品（或其子分类）
// 子分类会被 MediaWiki 自动追溯（clshow=subcats）
const LITERARY_CATEGORIES = new Set([
  '小说', '诗歌', '散文', '戏曲', '古典小说', '古典文学',
  '文学', '诗词', '史书', '话本', '文集', '词集', '诗集',
  '哲学', '历史', '国学', '诸子百家', '经典', '传统文化',
  '神话', '寓言', '传记', '回忆录', '游记', '随笔', '杂文',
  '辞赋', '散曲', '童谣', '民间文学', '传说',
  // 作者分类（作品集中的页面也是文学）
  '作者',
])
// 注意：Category 判断用的是 "包含" 匹配，
// 所以 "小说" 会匹配 "古典小说"、"短篇小说" 等子分类

// 标题快速预过滤：包含这些关键词的直接丢弃
const NOISE_TITLE_PATTERNS = [
  '有限公司', '公司', '判决书', '合同', '协议', '责任',
  '纠纷', '民事', '刑事', '行政', '仲裁', '鉴定',
  '事务所', '委员会', '报告', '纪要', '通知', '公告',
  '条例', '法规', '规章', '办法', '批复',
  '劳动合同', '申请书', '答辩状', '上诉状', '起诉状',
  '判决', '裁定', '决定', '破产',
  '施工', '项目', '招标', '投标', '工程', '装修',
  '租赁', '担保', '借贷', '抵押', '保险',
  '分公司', '村委会', '人民政府', '街道',
  '第20', '第21', '第22', '第23', '第24',  // 现代年份案号
  '执异', '执复',
  // 现代年份开头
  '20\\d{2}', '19\\d{2}',
]

function isNoiseTitle(title: string): boolean {
  return NOISE_TITLE_PATTERNS.some(p => title.includes(p))
}

/** 判断分类名是否属于文学/文化范畴 */
function isLiteraryCategory(catTitle: string): boolean {
  // Category: 前缀去除
  const name = catTitle.replace(/^Category:/, '').replace(/^分类:/, '')
  for (const lc of LITERARY_CATEGORIES) {
    if (name.includes(lc)) return true
  }
  return false
}

/** 判断分类名是否属于噪音（法律/公司等） */
function isNoiseCategory(catTitle: string): boolean {
  const name = catTitle.replace(/^Category:/, '').replace(/^分类:/, '')
  const noise = [
    '判决书', '公司', '有限公司', '司法', '法律', '诉讼',
    '劳动', '行政', '赔偿',
  ]
  return noise.some(n => name.includes(n))
}

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
      // 1. 搜索（拉更多结果，给过滤留余量）
      const searchUrl = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=30&srnamespace=0`
      const res = await fetch(searchUrl)
      const data = await res.json()
      let searchResults = data?.query?.search ?? []

      // 2. 快速预过滤：按标题关键词排除
      searchResults = searchResults.filter((s: any) => !isNoiseTitle(s.title))

      if (searchResults.length === 0) {
        results.value = []
        return
      }

      // 为节省时间，先取前 15 个结果深度检查
      searchResults = searchResults.slice(0, 15)
      const pageTitles = searchResults.map((s: any) => s.title)

      // 3. 批量查分类（1 次 API 调用获取所有页面的 categories）
      const catsUrl = `${WIKI_API}?action=query&titles=${encodeURIComponent(pageTitles.join('|'))}&prop=categories&format=json&origin=*&cllimit=50`
      const catsRes = await fetch(catsUrl, { signal: AbortSignal.timeout(10000) })
      const catsData = await catsRes.json()
      const catsPages: Record<string, any> = {}
      for (const p of Object.values(catsData?.query?.pages ?? {}) as any[]) {
        catsPages[p.title] = p
      }

      // 4. 过滤 + 收集信息
      // 如果页面没有任何分类，也排除（99% 是噪音）
      const filtered: { s: any; info: any }[] = []
      for (const s of searchResults) {
        const cp = catsPages[s.title]
        if (!cp || cp.missing !== undefined) continue

        const categories: string[] = (cp.categories ?? []).map((c: any) => c.title)

        // 有噪音分类 → 排除
        if (categories.some(isNoiseCategory)) continue

        // 有文学分类 → 保留
        const hasLitCat = categories.some(isLiteraryCategory)

        // 没有任何分类 → 排除（噪音几率极高）
        if (categories.length === 0) continue

        // 没有文学分类但有其他分类 → 看标题是否像文学
        if (!hasLitCat) {
          // 保守：只保留明显像文学作品标题的结果
          // 判断依据：标题不含标点、不含数字年份、不含英文
          const t = s.title
          const hasYear = /\b(19|20)\d{2}\b/.test(t)
          const hasEnglish = /[a-zA-Z]{4,}/.test(t)
          const looksLiterary = !hasYear && !hasEnglish && t.length <= 20 && !t.includes('与')
          if (!looksLiterary) continue
        }

        filtered.push({ s, info: cp })
      }

      // 5. 对每个保留页面查子页面数（并发限制）
      const detailed: WikisourceResult[] = []
      const BATCH_SIZE = 5
      for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
        const batch = filtered.slice(i, i + BATCH_SIZE)
        const results_batch = await Promise.all(
          batch.map(async ({ s, info }) => {
            let chapters = 1
            try {
              const catUrl = `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(s.title)}&cmtype=page&format=json&origin=*&cmlimit=500`
              const catRes = await fetch(catUrl, { signal: AbortSignal.timeout(5000) })
              const catData = await catRes.json()
              chapters = Math.max(1, (catData?.query?.categorymembers ?? []).length)
            } catch { /* 单个失败不影响整体 */ }
            return {
              pageid: info.pageid,
              title: s.title,
              snippet: s.snippet.replace(/<[^>]+>/g, '').slice(0, 200),
              chapters,
            }
          })
        )
        detailed.push(...results_batch)
      }

      results.value = detailed.slice(0, 10)
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
