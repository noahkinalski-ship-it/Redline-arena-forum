// API dla botów: tworzenie wątków i odpowiedzi (opcjonalnie z plikami).
//
// POST /.netlify/functions/bot-post
// Nagłówek:  Authorization: Bearer <token bota>   (token tworzy admin w panelu -> Boty)
// Treść JSON:
//   nowy wątek:  { "category": "cs2", "title": "Tytuł", "body": "Treść",
//                  "files": [{ "name": "wynik.png", "base64": "..." }] }
//   odpowiedź:   { "thread_id": "<uuid>", "body": "Treść" }
//
// Zmienne: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (opcjonalnie)

const crypto = require('crypto');

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', json: 'application/json', csv: 'text/csv',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4', webm: 'video/webm'
};
const MAGIC = { png: '89504e47', jpg: 'ffd8ff', jpeg: 'ffd8ff', gif: '47494638', pdf: '25504446', zip: '504b0304', docx: '504b0304', xlsx: '504b0304' };
const MAX_FILES = 5;
const MAX_TOTAL = 4 * 1024 * 1024;     // limit żądania funkcji Netlify to ok. 6 MB (base64 powiększa dane o 1/3)
const MAX_BODY = 10000;
const RATE_LIMIT_PER_MIN = 10;

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Użyj metody POST.' });
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Brak konfiguracji serwera.' });
  const SK = env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = (path, opts = {}) => fetch(env.SUPABASE_URL + path, {
    ...opts,
    headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });

  // 1) uwierzytelnienie tokenem bota (porównanie po skrócie SHA-256)
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 200) return json(401, { error: 'Brak tokenu.' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const bres = await sb(`/rest/v1/bots?token_hash=eq.${hash}&select=id,profile_id,allowed_categories,active,profiles(username,banned)`);
  const bot = bres.ok ? (await bres.json())[0] : null;
  if (!bot || !bot.active || bot.profiles?.banned) return json(401, { error: 'Nieprawidłowy lub wyłączony token.' });

  // 2) dane wejściowe
  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Zły JSON.' }); }
  const text = typeof p.body === 'string' ? p.body.trim() : '';
  if (!text || text.length > MAX_BODY) return json(400, { error: `Pole "body" jest wymagane (1–${MAX_BODY} znaków).` });
  const isReply = !!p.thread_id;
  let title = '';
  if (!isReply) {
    title = typeof p.title === 'string' ? p.title.trim() : '';
    if (title.length < 3 || title.length > 120) return json(400, { error: 'Pole "title" musi mieć 3–120 znaków.' });
    if (typeof p.category !== 'string' || !/^[\w-]{1,40}$/.test(p.category)) return json(400, { error: 'Brak poprawnego pola "category".' });
  } else if (!UUID.test(String(p.thread_id))) return json(400, { error: 'Zły "thread_id".' });
  const files = Array.isArray(p.files) ? p.files : [];
  if (files.length > MAX_FILES) return json(400, { error: `Maksymalnie ${MAX_FILES} plików.` });

  // 3) limit tempa
  const since = new Date(Date.now() - 60000).toISOString();
  const rres = await sb(`/rest/v1/posts?author_id=eq.${bot.profile_id}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${RATE_LIMIT_PER_MIN + 1}`);
  if (rres.ok && (await rres.json()).length >= RATE_LIMIT_PER_MIN) return json(429, { error: 'Za dużo wpisów. Spróbuj za minutę.' });

  // 4) dział / wątek + uprawnienia bota
  let category = p.category, threadId = p.thread_id;
  if (isReply) {
    const tres = await sb(`/rest/v1/threads?id=eq.${threadId}&select=id,locked,category_slug`);
    const t = tres.ok ? (await tres.json())[0] : null;
    if (!t) return json(404, { error: 'Nie ma takiego wątku.' });
    if (t.locked) return json(423, { error: 'Wątek jest zamknięty.' });
    category = t.category_slug;
  } else {
    const cres = await sb(`/rest/v1/categories?slug=eq.${encodeURIComponent(category)}&select=slug`);
    if (!cres.ok || !(await cres.json()).length) return json(404, { error: 'Nie ma takiego działu.' });
  }
  if (bot.allowed_categories.length && !bot.allowed_categories.includes(category))
    return json(403, { error: 'Ten bot nie ma uprawnień do działu "' + category + '".' });

  // 5) pliki -> Storage
  const attachments = [], uploaded = [];
  const cleanup = () => Promise.all(uploaded.map(path =>
    sb(`/storage/v1/object/attachments/${path}`, { method: 'DELETE' }).catch(() => {})));
  let total = 0;
  for (const f of files) {
    const name = String(f?.name || '').slice(0, 120);
    const ext = (name.split('.').pop() || '').toLowerCase();
    const type = TYPES[ext];
    if (!type) { await cleanup(); return json(400, { error: `Niedozwolony typ pliku: ${name}` }); }
    const buf = Buffer.from(String(f.base64 || ''), 'base64');
    total += buf.length;
    if (!buf.length || total > MAX_TOTAL) { await cleanup(); return json(413, { error: 'Pliki są puste lub większe niż 4 MB łącznie.' }); }
    if (MAGIC[ext] && buf.subarray(0, 4).toString('hex').indexOf(MAGIC[ext]) !== 0) { await cleanup(); return json(400, { error: `Zawartość nie pasuje do rozszerzenia: ${name}` }); }
    const path = `${bot.profile_id}/${crypto.randomUUID()}.${ext}`;
    const ures = await sb(`/storage/v1/object/attachments/${path}`, { method: 'POST', headers: { 'Content-Type': type, 'x-upsert': 'false' }, body: buf });
    if (!ures.ok) { await cleanup(); return json(502, { error: 'Nie udało się zapisać pliku: ' + name }); }
    uploaded.push(path);
    attachments.push({ path, name, size: buf.length, type });
  }

  // 6) zapis wątku/posta
  let createdThread = false;
  if (!isReply) {
    const r = await sb('/rest/v1/threads', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ category_slug: category, author_id: bot.profile_id, title }) });
    if (!r.ok) { await cleanup(); return json(500, { error: 'Nie udało się utworzyć wątku.' }); }
    threadId = (await r.json())[0].id; createdThread = true;
  }
  const post = { thread_id: threadId, author_id: bot.profile_id, body: text };
  if (attachments.length) post.attachments = attachments;
  const pr = await sb('/rest/v1/posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(post) });
  if (!pr.ok) {
    if (createdThread) await sb(`/rest/v1/threads?id=eq.${threadId}`, { method: 'DELETE' });
    await cleanup();
    return json(500, { error: 'Nie udało się zapisać wpisu.' });
  }
  const postId = (await pr.json())[0].id;
  await sb(`/rest/v1/bots?id=eq.${bot.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) });

  const base = (env.SITE_URL || '').replace(/\/$/, '');
  return json(200, { ok: true, thread_id: threadId, post_id: postId, url: base ? `${base}/#/w/${threadId}` : undefined });
};
