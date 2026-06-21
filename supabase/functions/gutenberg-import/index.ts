// supabase/functions/gutenberg-import/index.ts
// 导入古登堡图书：查本地 gutenberg_catalog → 事务写 books + gutenberg_books
// Deploy: supabase functions deploy gutenberg-import --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 鉴权：必须登录
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // 入参校验
    const { gutenberg_id, language } = await req.json();
    if (!gutenberg_id || typeof gutenberg_id !== "number") {
      return json({ error: "gutenberg_id (number) required" }, 400);
    }
    if (!language || !["zh", "en"].includes(language)) {
      return json({ error: "language must be 'zh' or 'en'" }, 400);
    }

    // 用 service role 绕过 RLS（写操作需要）
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, serviceKey);

    // 1. 从 gutenberg_catalog 查元数据
    const { data: catalog, error: catErr } = await admin
      .from("gutenberg_catalog")
      .select("gutenberg_id, title, author, language, cover_url")
      .eq("gutenberg_id", gutenberg_id)
      .eq("language", language)
      .single();

    if (catErr || !catalog) {
      return json({ error: "book_not_found_in_catalog" }, 404);
    }

    // 2. 查重：用户是否已导入这本书
    const { data: existing } = await admin
      .from("gutenberg_books")
      .select("book_id, books!inner(user_id)")
      .eq("gutenberg_id", gutenberg_id)
      .eq("language", language)
      .is("format", null);

    const ownedExisting = (existing ?? []).find(
      (row: any) => row.books?.user_id === user.id
    );
    if (ownedExisting) {
      return json({
        exists: true,
        book_id: ownedExisting.book_id,
        message: "已在你的书架",
      }, 200);
    }

    // 3. 事务写两表
    // 先 INSERT books 拿到 id
    const { data: newBook, error: booksErr } = await admin
      .from("books")
      .insert({
        user_id: user.id,
        title: catalog.title,
        author: catalog.author ?? null,
        cover_url: catalog.cover_url ?? null,
        file_url: null,            // 在线书，文件不在 Storage
        file_format: "epub",       // 默认 epub，首次阅读时 fetch 会确认
        file_size: null,
        language: catalog.language,
        is_public: false,
        description: `来自古登堡计划 (id=${catalog.gutenberg_id})`,
      })
      .select("id")
      .single();

    if (booksErr || !newBook) {
      console.error("books insert failed:", booksErr);
      return json({ error: "books_insert_failed", detail: booksErr?.message }, 500);
    }

    // 再 INSERT gutenberg_books
    const { error: gbErr } = await admin
      .from("gutenberg_books")
      .insert({
        book_id: newBook.id,
        gutenberg_id: catalog.gutenberg_id,
        language: catalog.language,
        format: null,  // 首次阅读时由 gutenberg-fetch 填充
      });

    if (gbErr) {
      // 回滚 books（删除刚插入的）
      await admin.from("books").delete().eq("id", newBook.id);
      console.error("gutenberg_books insert failed, rolled back:", gbErr);
      return json({ error: "gutenberg_books_insert_failed", detail: gbErr.message }, 500);
    }

    return json({
      exists: false,
      book_id: newBook.id,
      message: "导入成功",
    }, 201);
  } catch (e) {
    console.error("gutenberg-import error:", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}