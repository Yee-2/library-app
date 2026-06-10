// supabase/functions/public-book-url/index.ts
// 给公开图书生成临时签名下载链接

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { book_id } = await req.json();
    if (!book_id) {
      return json({ error: "book_id required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. 查书
    const { data: book, error } = await admin
      .from("books")
      .select("file_url, is_public, user_id")
      .eq("id", book_id)
      .single();

    if (error || !book) {
      return json({ error: "Book not found" }, 404);
    }

    // 2. 鉴权：要么是公开书，要么是所有者
    const authHeader = req.headers.get("Authorization") ?? "";
    let isOwner = false;
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user && user.id === book.user_id) isOwner = true;
    }

    if (!book.is_public && !isOwner) {
      return json({ error: "Forbidden" }, 403);
    }

    // 3. 生成签名 URL（1 小时有效）
    const path = book.file_url.replace(/^book-files\//, "");
    const { data: signed, error: signErr } = await admin.storage
      .from("book-files")
      .createSignedUrl(path, 3600);

    if (signErr || !signed) {
      return json({ error: "Cannot sign url", detail: signErr?.message }, 500);
    }

    // 4. 公开书则增加下载计数
    if (book.is_public && !isOwner) {
      await admin.rpc("increment_download", { book_uuid: book_id }).then(() => {});
    }

    return json({ url: signed.signedUrl, expires_in: 3600 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
