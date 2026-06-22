// src/composables/useBookSideData.ts
import { ref, onActivated } from 'vue'
import { listBookmarks, listNotes, deleteBookmark, deleteNote } from '@/lib/books'
import type { Bookmark, Note } from '@/types'

/**
 * 阅读器侧边数据 composable：书签、笔记。
 * 暴露列表 / 删除方法。Reader.vue 显式调用 load() 加载（onMounted + onActivated）。
 */
export function useBookSideData(opts: { getBookId: () => string | undefined }) {
  const bookmarks = ref<Bookmark[]>([])
  const notes = ref<Note[]>([])
  const newNoteText = ref('')

  async function load() {
    const bookId = opts.getBookId()
    if (!bookId) return
    const [b, n] = await Promise.all([listBookmarks(bookId), listNotes(bookId)])
    bookmarks.value = b
    notes.value = n
  }

  async function removeBookmark(id: string) {
    await deleteBookmark(id)
    bookmarks.value = bookmarks.value.filter(b => b.id !== id)
  }

  async function removeNote(id: string) {
    await deleteNote(id)
    notes.value = notes.value.filter(n => n.id !== id)
  }

  onActivated(load)

  return {
    bookmarks,
    notes,
    newNoteText,
    load,
    removeBookmark,
    removeNote,
  }
}