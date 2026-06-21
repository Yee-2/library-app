// supabase/functions/gutenberg-sync/index.ts
// 手动同步古登堡目录：下载 pg_catalog.csv → 解析 → UPSERT 到 gutenberg_catalog
// Deploy: supabase functions deploy gutenberg-sync --no-verify-jwt
//
// 鉴权：管理员（用 ADMIN_USER_IDS 环境变量白名单，逗号分隔）

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
const DOWNLOAD_TIMEOUT_MS = 60000;  // 21MB CSV，需要较长超时
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

    // 管理员校验
    if (ADMIN_USER_IDS.length === 0 || !ADMIN_USER_IDS.includes(user.id)) {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // 1. 下载 CSV
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

    // 2. 流式解析 CSV
    const text = await csvRes.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return json({ error: "csv_empty_or_invalid" }, 400);
    }

    const header = rows[0];
    const idx = {
      id: header.indexOf("Text#"),
      title: header.indexOf("Title"),
      author: header.indexOf("Authors"),
      language: header.indexOf("Language"),
    };

    if (Object.values(idx).some(i => i < 0)) {
      return json({ error: "csv_missing_columns", got_header: header }, 400);
    }

    // 3. 过滤 + 批处理
    const langCounts: Record<string, number> = { zh: 0, en: 0 };
    let batch: any[] = [];
    let totalSynced = 0;
    let totalSkipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const lang = (r[idx.language] ?? "").trim().toLowerCase();
      if (!ALLOWED_LANGS.has(lang)) {
        totalSkipped++;
        continue;
      }

      const id = parseInt(r[idx.id], 10);
      if (!id) {
        totalSkipped++;
        continue;
      }

      const title = (r[idx.title] ?? "").trim();
      const author = (r[idx.author] ?? "").trim();

      if (!title) {
        totalSkipped++;
        continue;
      }

      langCounts[lang] = (langCounts[lang] ?? 0) + 1;

      batch.push({
        gutenberg_id: id,
        title: title.slice(0, 500),
        author: author.slice(0, 500) || null,
        language: lang,
        epub_url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
        txt_url: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
        cover_url: null,
        updated_at: new Date().toISOString(),
      });

      if (batch.length >= BATCH_SIZE) {
        await upsertBatch(admin, batch);
        totalSynced += batch.length;
        batch = [];
        if (totalSynced % 5000 === 0) {
          console.log(`[sync] progress: ${totalSynced} synced, ${totalSkipped} skipped`);
        }
      }
    }

    // 处理剩余
    if (batch.length > 0) {
      await upsertBatch(admin, batch);
      totalSynced += batch.length;
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

/**
 * 简单 CSV 解析器：处理引号转义和逗号在引号内的情况
 * 适合 Project Gutenberg 的 catalog CSV
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      if (row.length > 0 && row.some(f => f.length > 0)) {
        rows.push(row);
      }
      row = [];
      // 跳过 \r\n
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }

    field += c;
    i++;
  }

  // 最后一行（无换行结尾）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(f => f.length > 0)) rows.push(row);
  }

  return rows;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}