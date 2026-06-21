// supabase/functions/gutenberg-sync/index.ts
// 手动同步古登堡目录：下载 pg_catalog.csv → 流式解析 → UPSERT 到 gutenberg_catalog
//
// 鉴权：管理员（用 ADMIN_USER_IDS 环境变量白名单，逗号分隔）
//
// 流式设计说明：
//   pg_catalog.csv 约 21MB / 9 万行，部分字段含引号内换行。
//   用逐字符流式解析（非按行切分），正确处理引号内逗号和换行。
//   每 500 行 flush 一次 UPSERT，减少内存峰值。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN_USER_IDS = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map(s => s.trim()).filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv";
const DOWNLOAD_TIMEOUT_MS = 180000;
const BATCH_SIZE = 500;
const ALLOWED_LANGS = new Set(["zh", "en"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 鉴权
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (ADMIN_USER_IDS.length === 0 || !ADMIN_USER_IDS.includes(user.id)) {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // ============================================
    // 流式逐字符 CSV 解析
    // ============================================
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let csvRes: Response;
    try {
      csvRes = await fetch(CATALOG_URL, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timeoutId);
      return json({ error: "csv_download_failed", detail: String(e) }, 502);
    }
    clearTimeout(timeoutId);
    if (!csvRes.ok) {
      return json({ error: "csv_download_failed", status: csvRes.status }, 502);
    }

    // 逐字符流式状态
    const reader = csvRes.body!.getReader();
    const decoder = new TextDecoder();

    // CSV 解析状态
    const field: string[] = [];   // 当前字段字符
    const row: string[] = [];     // 当前行字段列表
    let inQuotes = false;
    let headerParsed = false;
    let idx = { id: -1, title: -1, author: -1, language: -1 };

    // 批处理
    const langCounts: Record<string, number> = { zh: 0, en: 0 };
    let batch: any[] = [];
    let totalSynced = 0;
    let totalSkipped = 0;

    // 每次 read 后 flush 当前 field+row
    function flushRow() {
      if (row.length === 0 && field.length === 0) return;
      // 把当前 field 加入 row
      row.push(field.join(""));
      field.length = 0;

      if (row.length === 0) return;
      const hasContent = row.some(f => f.length > 0);
      if (!hasContent) { row.length = 0; return; }

      if (!headerParsed) {
        // 第一行 = header
        const hId = row.indexOf("Text#");
        const hTitle = row.indexOf("Title");
        const hAuthor = row.indexOf("Authors");
        const hLang = row.indexOf("Language");
        if (hId >= 0 && hTitle >= 0 && hLang >= 0) {
          idx = { id: hId, title: hTitle, author: hAuthor, language: hLang };
          headerParsed = true;
        }
        row.length = 0;
        return;
      }

      // 数据行
      if (row.length <= Math.max(idx.id, idx.title, idx.language)) {
        row.length = 0;
        return;
      }

      const lang = (row[idx.language] ?? "").trim().toLowerCase();
      if (!ALLOWED_LANGS.has(lang)) {
        totalSkipped++;
        row.length = 0;
        return;
      }

      const gId = parseInt(row[idx.id], 10);
      if (!gId) { totalSkipped++; row.length = 0; return; }

      const title = (row[idx.title] ?? "").trim();
      if (!title) { totalSkipped++; row.length = 0; return; }

      const author = (row[idx.author] ?? "").trim();
      langCounts[lang] = (langCounts[lang] ?? 0) + 1;

      batch.push({
        gutenberg_id: gId,
        title: title.slice(0, 500),
        author: author.slice(0, 500) || null,
        language: lang,
        epub_url: `https://www.gutenberg.org/ebooks/${gId}.epub3.images`,
        txt_url: `https://www.gutenberg.org/ebooks/${gId}.txt.utf-8`,
        cover_url: null,
        updated_at: new Date().toISOString(),
      });

      if (batch.length >= BATCH_SIZE) {
        // 同步 flush
        totalSynced += batch.length;
      }

      row.length = 0;
    }

    async function flushBatch() {
      if (batch.length === 0) return;
      await upsertBatch(admin, batch);
      if (totalSynced % 5000 === 0) {
        console.log(`[sync] progress: ${totalSynced} synced, ${totalSkipped} skipped`);
      }
      batch = [];
    }

    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? "" : decoder.decode(value, { stream: true });

      // 逐字符处理
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];

        if (inQuotes) {
          if (c === '"') {
            if (i + 1 < chunk.length && chunk[i + 1] === '"') {
              field.push('"');
              i++; // skip escaped quote
            } else {
              inQuotes = false;
            }
          } else {
            field.push(c);
          }
          continue;
        }

        if (c === '"') {
          inQuotes = true;
          continue;
        }

        if (c === ",") {
          row.push(field.join(""));
          field.length = 0;
          continue;
        }

        if (c === "\n") {
          flushRow();
          // 检查是否需要 flush batch（在 flushRow 中计数了）
          if (batch.length >= BATCH_SIZE) {
            await flushBatch();
          }
          continue;
        }

        // \r 忽略（\r\n 时 \n 会触发 flush）
        if (c === "\r") continue;

        field.push(c);
      }

      if (done) break;
    }

    // 处理最后一行（无换行结尾）
    if (field.length > 0 || row.length > 0) {
      flushRow();
    }

    // 最后一批
    if (batch.length > 0) {
      totalSynced += batch.length;
      await flushBatch();
    }

    return json({
      ok: true,
      synced: totalSynced,
      skipped: totalSkipped,
      languages: langCounts,
    });
  } catch (e) {
    console.error("gutenberg-sync error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

async function upsertBatch(admin: any, batch: any[]) {
  const { error } = await admin
    .from("gutenberg_catalog")
    .upsert(batch, { onConflict: "gutenberg_id" });
  if (error) {
    console.error("[sync] batch upsert error:", error.message);
    throw error;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
