/**
 * 全局 Toast 通知
 * - 静态方法 toast.success/error/info/warn
 * - 自动消失，可堆叠
 */
import { ref } from 'vue'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'
export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  duration: number
}

const items = ref<ToastItem[]>([])
let nextId = 1

function push(kind: ToastKind, message: string, duration = 3000) {
  const id = nextId++
  items.value.push({ id, kind, message, duration })
  if (duration > 0) {
    setTimeout(() => remove(id), duration)
  }
}

function remove(id: number) {
  items.value = items.value.filter(t => t.id !== id)
}

export const toast = {
  items,
  remove,
  success: (msg: string, duration = 3000) => push('success', msg, duration),
  error:   (msg: string, duration = 4000) => push('error',   msg, duration),
  info:    (msg: string, duration = 3000) => push('info',    msg, duration),
  warn:    (msg: string, duration = 3500) => push('warn',    msg, duration),
}