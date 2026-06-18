/**
 * useTheme - light / dark 主题切换
 * - 持久化到 localStorage
 * - 默认 dark
 * - 切换时给 <html> 增减 .dark class
 */
import { ref, watch, onMounted } from 'vue'

const THEME_KEY = 'app:theme'
export type ThemeMode = 'light' | 'dark'

// 单例
const theme = ref<ThemeMode>('dark')

function apply(t: ThemeMode) {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (t === 'dark') html.classList.add('dark')
  else html.classList.remove('dark')
  html.setAttribute('data-theme', t)
}

function load() {
  if (typeof localStorage === 'undefined') return
  const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null
  if (saved === 'light' || saved === 'dark') {
    theme.value = saved
  }
}

export function useTheme() {
  onMounted(() => {
    load()
    apply(theme.value)
  })

  // 立即同步（避免首屏闪烁）
  if (typeof document !== 'undefined' && !document.documentElement.getAttribute('data-theme')) {
    load()
    apply(theme.value)
  }

  watch(theme, (t) => {
    apply(t)
    try { localStorage.setItem(THEME_KEY, t) } catch {}
  })

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  function setTheme(t: ThemeMode) {
    theme.value = t
  }

  return { theme, toggle, setTheme }
}
