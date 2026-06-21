// src/lib/featureFlags.ts
// 集中管理功能开关，让关闭某功能时一处生效

/**
 * 古登堡功能开关
 * - 默认开启（VITE_ENABLE_GUTENBERG 未设置时）
 * - 设置 VITE_ENABLE_GUTENBERG=false 可关闭
 */
export const isGutenbergEnabled = (): boolean => {
  const v = import.meta.env.VITE_ENABLE_GUTENBERG
  // 未设置、'true'、'1' → 开启
  if (v === undefined || v === '' || v === 'true' || v === '1') return true
  return false
}