/**
 * useTheme - 仅浅色模式（已去除暗黑主题）
 * 保留 API 以兼容现有调用
 */
import { ref } from 'vue'

const theme = ref<'light'>('light')

export function useTheme() {
  function toggle() { /* no-op: single theme */ }
  function setTheme() { /* no-op */ }
  return { theme, toggle, setTheme }
}
