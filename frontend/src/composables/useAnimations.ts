/**
 * useAnimations - 统一动画工具
 * - 提供常用动效类名
 * - 缓动曲线：cubic-bezier(0.16, 1, 0.3, 1)  - "ease out expo"
 */

export function fadeInUp(delayMs = 0) {
  return `opacity-0 animate-[fadeInUp_0.4s_cubic-bezier(0.16,1,0.3,1)_${delayMs}ms_forwards]`
}

export function staggerDelay(index: number, base = 40) {
  return `${index * base}ms`
}