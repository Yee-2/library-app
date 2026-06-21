// scripts/import_gutenberg_catalog.mjs
// 一次性脚本：从 scripts/pg_catalog.csv 灌入 Supabase gutenberg_catalog 表
// 用法：node scripts/import_gutenberg_catalog.mjs
// 前提：环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, 'pg_catalog.csv');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Set in env: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import_gutenberg_catalog.mjs');
  process.exit(1);
}

const ALLOWED_LANGS = new Set(['zh', 'en']);
const BATCH_SIZE = 500;

/**
 * 简单 CSV 解析器：处理引号转义和逗号在引号内
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
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

    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      if (row.length > 0 && row.some(f => f.length > 0)) rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(f => f.length > 0)) rows.push(row);
  }

  return rows;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    console.error('Download: curl -o scripts/pg_catalog.csv https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv');
    process.exit(1);
  }

  console.log(`[import] Reading ${CSV_PATH}...`);
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error('[import] CSV empty or invalid');
    process.exit(1);
  }

  const header = rows[0];
  const idx = {
    id: header.indexOf('Text#'),
    title: header.indexOf('Title'),
    author: header.indexOf('Authors'),
    language: header.indexOf('Language'),
  };

  if (Object.values(idx).some(i => i < 0)) {
    console.error('[import] CSV missing columns:', idx);
    process.exit(1);
  }

  console.log(`[import] Parsed ${rows.length - 1} data rows`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  let batch = [];
  let synced = 0;
  let skipped = 0;
  const langCounts = { zh: 0, en: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const lang = (r[idx.language] ?? '').trim().toLowerCase();
    if (!ALLOWED_LANGS.has(lang)) {
      skipped++;
      continue;
    }

    const id = parseInt(r[idx.id], 10);
    if (!id) {
      skipped++;
      continue;
    }

    const title = (r[idx.title] ?? '').trim();
    if (!title) {
      skipped++;
      continue;
    }

    const author = (r[idx.author] ?? '').trim();

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
      await upsert(supabase, batch);
      synced += batch.length;
      batch = [];
      if (synced % 5000 === 0) {
        console.log(`[import] progress: ${synced} synced, ${skipped} skipped`);
      }
    }
  }

  if (batch.length > 0) {
    await upsert(supabase, batch);
    synced += batch.length;
  }

  console.log(`\n[import] Done.`);
  console.log(`  Total rows:    ${rows.length - 1}`);
  console.log(`  Synced:        ${synced}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Languages:     ${JSON.stringify(langCounts)}`);
}

async function upsert(supabase, batch) {
  const { error } = await supabase
    .from('gutenberg_catalog')
    .upsert(batch, { onConflict: 'gutenberg_id' });

  if (error) {
    console.error('[import] batch upsert error:', error.message);
    throw error;
  }
}

main().catch(e => {
  console.error('[import] FATAL:', e);
  process.exit(1);
});