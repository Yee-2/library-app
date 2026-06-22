// src/composables/reader/lazyImport.ts
// 封装"按需 import + 错误兜底"模式 —— Reader.vue 阶段 1 重构引入

const RETRY_LIMIT = 2
const retryCount = new Map<string, number>()

async function withRetry<T>(key: string, loader: () => Promise<T>): Promise<T> {
  try {
    const result = await loader()
    retryCount.delete(key)
    return result
  } catch (e) {
    const count = (retryCount.get(key) ?? 0) + 1
    retryCount.set(key, count)
    if (count >= RETRY_LIMIT) {
      retryCount.delete(key)
      throw new Error('阅读器组件加载失败，请刷新页面重试')
    }
    return loader()
  }
}

/** 按需加载 epubjs。返回 epubjs 的 Book 构造器（default export）。 */
export async function loadEpubJs() {
  return withRetry('epubjs', async () => {
    const mod = await import('epubjs')
    return (mod as any).default ?? mod
  })
}

/** 按需加载 pdfjs-dist，并配置 worker。 */
export async function loadPdfJs() {
  return withRetry('pdfjs-dist', async () => {
    const mod: any = await import('pdfjs-dist')
    const workerMod: any = await import('pdfjs-dist/build/pdf.worker.mjs?url')
    mod.GlobalWorkerOptions.workerSrc = workerMod.default
    return mod
  })
}
