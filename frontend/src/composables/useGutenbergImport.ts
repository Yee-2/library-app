// src/composables/useGutenbergImport.ts
// 导入古登堡图书：调 gutenberg-import Edge Function 写 books + gutenberg_books
// 登录态由 auth store 校验，未登录跳 /login

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { FUNCTIONS_URL } from '@/lib/supabase'
import { toast } from '@/lib/toast'

export function useGutenbergImport() {
  const router = useRouter()
  const auth = useAuthStore()
  const importing = ref(false)
  const error = ref('')

  /**
   * 导入一本古登堡书
   * @returns 新书 book_id（如果用户已有则返回已存在的 book_id）；未登录返回 null
   */
  async function importBook(gutenbergId: number, language: 'zh' | 'en'): Promise<string | null> {
    if (!auth.isLoggedIn) {
      toast.warn('请先登录')
      router.push({ name: 'login', query: { redirect: '/library?tab=online' } })
      return null
    }

    importing.value = true
    error.value = ''
    try {
      const session = (await (await import('@/lib/supabase')).supabase.auth.getSession()).data.session
      const token = session?.access_token
      if (!token) {
        toast.error('登录状态已过期，请重新登录')
        return null
      }

      const res = await fetch(`${FUNCTIONS_URL}/gutenberg-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ gutenberg_id: gutenbergId, language }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = json?.error ?? `导入失败 (${res.status})`
        toast.error(msg)
        error.value = msg
        return null
      }

      if (json.exists) {
        toast.info('已在你的书架')
      } else {
        toast.success('已加入书架')
      }

      return json.book_id as string
    } catch (e: any) {
      console.error('[gutenberg-import]', e)
      const msg = e?.message ?? '导入失败，请重试'
      toast.error(msg)
      error.value = msg
      return null
    } finally {
      importing.value = false
    }
  }

  /**
   * 导入并跳转到书架「在线图书」tab
   */
  async function importAndGo(gutenbergId: number, language: 'zh' | 'en') {
    const bookId = await importBook(gutenbergId, language)
    if (bookId) {
      router.push({ path: '/library', query: { tab: 'online', highlight: bookId } })
    }
  }

  return { importing, error, importBook, importAndGo }
}