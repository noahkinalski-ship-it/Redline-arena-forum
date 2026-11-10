/* REDLINE ARENA – forum graczy (czysty JS, bez builda) */
(() => {
'use strict';

const C = Object.assign({
  SUPABASE_URL: '', SUPABASE_ANON_KEY: '', DISCORD_INVITE: '', DISCORD_GUILD_ID: '',
  FORUM_NAME: 'REDLINE ARENA', USE_NETLIFY_FUNCTIONS: true
}, window.FORUM_CONFIG || {});
const LIVE = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase);
let sb = null;

/* ---------- pomocnicze ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = d => new Date(d).toLocaleDateString('pl-PL', { dateStyle: 'medium' });
function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'przed chwilą';
  if (s < 3600) return Math.floor(s / 60) + ' min temu';
  if (s < 86400) return Math.floor(s / 3600) + ' godz. temu';
  if (s < 2592000) return Math.floor(s / 86400) + ' dn. temu';
  return fmtDate(d);
}
function fmtBody(t) {
  return esc(t)
    .replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`)
    .replace(/\n/g, '<br>');
}
const ROLE = { admin: 'Admin', moderator: 'Moderator', user: 'Gracz' };
const roleBadge = (r, bot) => (bot ? '<span class="badge bot">BOT</span> ' : '') +
  `<span class="badge ${esc(r)}">${esc(ROLE[r] || 'Gracz')}</span>`;

/* ---------- załączniki ---------- */
const MAX_FILES = 5, MAX_MB = 10;
const FILE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', json: 'application/json', csv: 'text/csv',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4', webm: 'video/webm'
};
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const ACCEPT = Object.keys(FILE_TYPES).map(e => '.' + e).join(',');
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const mimeOf = n => FILE_TYPES[extOf(n)] || '';
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const DEMO_MAX = 400 * 1024;
function checkFile(f) {
  if (!mimeOf(f.name)) return `Niedozwolony typ pliku: ${f.name}`;
  const lim = LIVE ? MAX_MB * 1048576 : DEMO_MAX;
  if (f.size > lim) return `Plik ${f.name} jest za duży (limit ${LIVE ? MAX_MB + ' MB' : '400 KB w trybie demo'}).`;
  if (!f.size) return `Plik ${f.name} jest pusty.`;
  return '';
}
/* Adres pliku. W trybie LIVE ufamy wyłącznie ścieżce w naszym buckecie (pole "data" jest ignorowane). */
function attUrl(a, download) {
  if (!LIVE) return typeof a.data === 'string' && a.data.startsWith('data:') ? a.data : '';
  if (typeof a.path !== 'string' || !/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(a.path)) return '';
  return sb.storage.from('attachments').getPublicUrl(a.path, download ? { download: String(a.name || 'plik').slice(0, 120) } : undefined).data.publicUrl;
}
function attachmentsHtml(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const media = [], files = [];
  list.slice(0, MAX_FILES).forEach(a => {
    if (!a || typeof a !== 'object') return;
    const url = attUrl(a); if (!url) return;
    const name = esc(String(a.name || 'plik').slice(0, 120)), type = String(a.type || '');
    if (IMG_TYPES.has(type)) media.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${name}" loading="lazy"></a>`);
    else if (VIDEO_TYPES.has(type)) media.push(`<video controls preload="metadata" src="${esc(url)}"></video>`);
    else files.push(`<a class="file" href="${esc(attUrl(a, true))}" target="_blank" rel="noopener noreferrer nofollow">📎 ${name} <span class="muted">${esc(fmtSize(Number(a.size) || 0))}</span></a>`);
  });
  return `<div class="atts">${media.length ? `<div class="att-media">${media.join('')}</div>` : ''}${files.length ? `<div class="att-files">${files.join('')}</div>` : ''}</div>`;
}
function uploaderHtml(id) {
  return `<div class="uploader" data-uploader>
    <label class="drop" for="${id}">📎 Dodaj pliki: PNG, JPG, GIF, WEBP, PDF, ZIP, TXT, LOG, JSON, CSV, MP4…<br>
      <small>do ${MAX_FILES} plików po ${LIVE ? MAX_MB + ' MB' : '400 KB (demo)'} · przeciągnij tutaj albo wklej zrzut ekranu (Ctrl+V)</small></label>
    <input class="sr" type="file" id="${id}" name="files" multiple accept="${ACCEPT}">
    <ul class="file-list" aria-live="polite"></ul></div>`;
}
function renderFileList(input) {
  const ul = input.closest('[data-uploader]')?.querySelector('.file-list'); if (!ul) return;
  ul.innerHTML = (input._keep || []).map((f, i) => `<li><span>${esc(f.name)} <span class="muted">${esc(fmtSize(f.size))}</span></span>
    <button type="button" class="link-btn" data-act="rm-file" data-i="${i}" aria-label="Usuń ${esc(f.name)}">✕</button></li>`).join('');
}
function mergeFiles(input, picked) {
  const all = [...(input._keep || [])];
  for (const f of picked) {
    if (all.length >= MAX_FILES) { toast(`Maksymalnie ${MAX_FILES} plików w jednym poście.`, 'err'); break; }
    const err = checkFile(f); if (err) { toast(err, 'err'); continue; }
    all.push(f);
  }
  const dt = new DataTransfer(); all.forEach(f => dt.items.add(f));
  input.files = dt.files; input._keep = all; renderFileList(input);
}
const formFiles = f => [...(f.querySelector('input[name=files]')?._keep || [])];
function avatar(u, size = 40) {
  const name = u?.username || '?';
  if (u?.avatar_url && (/^https:\/\//.test(u.avatar_url) || /^data:image\/svg\+xml/.test(u.avatar_url)))
    return `<img class="av" style="width:${size}px;height:${size}px" src="${esc(u.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="av" style="width:${size}px;height:${size}px;background:hsl(${h} 55% 32%);font-size:${Math.round(size * .42)}px">${esc(name[0].toUpperCase())}</span>`;
}
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function niceError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/already registered|already been registered/i.test(m)) return 'Ten e-mail jest już zarejestrowany.';
  if (/row-level security|permission denied|violates row/i.test(m)) return 'Brak uprawnień do tej operacji (konto może być zablokowane lub wątek zamknięty).';
  if (/Password should be/i.test(m)) return 'Hasło musi mieć co najmniej 8 znaków.';
  if (/duplicate key|unique/i.test(m)) return 'Taka nazwa użytkownika jest już zajęta.';
  if (/rate limit/i.test(m)) return 'Za dużo prób. Spróbuj ponownie za chwilę.';
  return m || 'Coś poszło nie tak.';
}

/* ---------- stan ---------- */
const state = { user: null, profile: null, cooldown: 0, adminTab: 'reports' };
const isStaff = () => ['admin', 'moderator'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'admin';
const canPost = () => !!state.profile && !state.profile.banned;

/* ---------- działy ---------- */
const CATEGORIES = [
  { slug: 'ogloszenia', name: 'Ogłoszenia', description: 'Nowości, zasady i informacje od administracji.', icon: '📢', grp: 'Społeczność', sort: 1 },
  { slug: 'ogolne', name: 'Ogólne / Off-topic', description: 'Rozmowy o wszystkim, co nie pasuje gdzie indziej.', icon: '💬', grp: 'Społeczność', sort: 2 },
  { slug: 'sprzet', name: 'Sprzęt i benchmarki', description: 'GPU, CPU, recenzje komponentów i wyniki testów FPS.', icon: '🖥️', grp: 'Społeczność', sort: 3 },
  { slug: 'pomoc', name: 'Pomoc i zgłoszenia', description: 'Problemy z forum, serwerem Discord, pytania do moderacji.', icon: '🛠️', grp: 'Społeczność', sort: 4 },
  { slug: 'fh3', name: 'Forza Horizon 3', description: 'Tuning, wyścigi, zloty i porady do FH3.', icon: '🏝️', grp: 'Gry', sort: 10 },
  { slug: 'fh4', name: 'Forza Horizon 4', description: 'Tuning, wyścigi, zloty i porady do FH4.', icon: '🍂', grp: 'Gry', sort: 11 },
  { slug: 'fh5', name: 'Forza Horizon 5', description: 'Tuning, wyścigi, zloty i porady do FH5.', icon: '🌵', grp: 'Gry', sort: 12 },
  { slug: 'fh6', name: 'Forza Horizon 6', description: 'Wszystko o Forza Horizon 6.', icon: '🏁', grp: 'Gry', sort: 13 },
  { slug: 'cs2', name: 'Counter-Strike 2', description: 'Taktyki, ustawienia, skiny, szukanie składu.', icon: '🔫', grp: 'Gry', sort: 14 },
  { slug: 'ets2', name: 'Euro Truck Simulator 2', description: 'Trasy, mody, konwoje i ustawienia kierownic.', icon: '🚚', grp: 'Gry', sort: 15 },
  { slug: 'wot', name: 'World of Tanks', description: 'Czołgi, taktyki, klany i aktualizacje.', icon: '🛡️', grp: 'Gry', sort: 16 },
  { slug: 'heat', name: 'HEAT', description: 'Dział poświęcony grze HEAT.', icon: '🔥', grp: 'Gry', sort: 17 },
  { slug: 'gta5', name: 'GTA 5', description: 'Online, mody, serwery i poradniki do GTA V.', icon: '🚓', grp: 'Gry', sort: 18 }
];

/* ====================================================================
 *  WARSTWA DANYCH – SUPABASE
 * ==================================================================== */
const AUTH_SEL = 'id,username,role,avatar_url,is_bot';
async function callFn(name, payload) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token; if (!token) throw new Error('Zaloguj się ponownie.');
  const r = await fetch('/.netlify/functions/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Błąd serwera funkcji (' + r.status + ').');
  return j;
}
const Live = {
  async categories() {
    const { data, error } = await sb.from('categories').select('*').order('sort');
    if (error) throw error; return data;
  },
  async threadStats() {
    const { data, error } = await sb.from('threads')
      .select('id,title,category_slug,posts_count,last_post_at,created_at')
      .order('last_post_at', { ascending: false }).limit(1000);
    if (error) throw error; return data;
  },
  async memberCount() {
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
    return count || 0;
  },
  async threads(slug) {
    const { data, error } = await sb.from('threads')
      .select(`*, author:profiles!threads_author_id_fkey(${AUTH_SEL})`)
      .eq('category_slug', slug)
      .order('pinned', { ascending: false }).order('last_post_at', { ascending: false }).limit(200);
    if (error) throw error; return data;
  },
  async search(q) {
    const clean = q.replace(/[%,()_\\]/g, ' ').trim();
    const { data, error } = await sb.from('threads')
      .select(`*, author:profiles!threads_author_id_fkey(${AUTH_SEL})`)
      .ilike('title', `%${clean}%`).order('last_post_at', { ascending: false }).limit(50);
    if (error) throw error; return data;
  },
  async thread(id) {
    const { data: thread, error } = await sb.from('threads')
      .select(`*, author:profiles!threads_author_id_fkey(${AUTH_SEL})`).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!thread) return null;
    const { data: posts, error: e2 } = await sb.from('posts')
      .select(`*, author:profiles!posts_author_id_fkey(${AUTH_SEL},created_at)`)
      .eq('thread_id', id).order('created_at');
    if (e2) throw e2;
    let likes = [];
    if (posts.length) {
      const r = await sb.from('likes').select('post_id,user_id').in('post_id', posts.map(p => p.id));
      likes = r.data || [];
    }
    return { thread, posts, likes };
  },
  async upload(files) {
    const out = [];
    try {
      for (const f of files) {
        const ext = extOf(f.name), type = mimeOf(f.name);
        const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from('attachments').upload(path, f, { contentType: type, cacheControl: '31536000', upsert: false });
        if (error) throw error;
        out.push({ path, name: f.name.slice(0, 120), size: f.size, type });
      }
    } catch (e) { await Live.removeFiles(out); throw e; }
    return out;
  },
  async removeFiles(list) {
    const paths = (list || []).map(a => a?.path).filter(p => typeof p === 'string' && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(p));
    if (paths.length) { try { await sb.storage.from('attachments').remove(paths); } catch (e) { /* osierocone pliki nie blokują akcji */ } }
  },
  async createThread(slug, title, body, att = []) {
    const { data: t, error } = await sb.from('threads')
      .insert({ category_slug: slug, title, author_id: state.user.id }).select().single();
    if (error) throw error;
    const post = { thread_id: t.id, author_id: state.user.id, body };
    if (att.length) post.attachments = att;
    const { error: e2 } = await sb.from('posts').insert(post);
    if (e2) { await sb.from('threads').delete().eq('id', t.id); throw e2; }
    return t;
  },
  async createPost(threadId, body, att = []) {
    const post = { thread_id: threadId, author_id: state.user.id, body };
    if (att.length) post.attachments = att;
    const { error } = await sb.from('posts').insert(post);
    if (error) throw error;
  },
  async editPost(id, body) {
    const { error } = await sb.from('posts').update({ body }).eq('id', id);
    if (error) throw error;
  },
  async deletePost(id) {
    const { data } = await sb.from('posts').select('attachments').eq('id', id).maybeSingle();
    const { error } = await sb.from('posts').delete().eq('id', id); if (error) throw error;
    await Live.removeFiles(data?.attachments);
  },
  async deleteThread(id) {
    const { data } = await sb.from('posts').select('attachments').eq('thread_id', id);
    const { error } = await sb.from('threads').delete().eq('id', id); if (error) throw error;
    await Live.removeFiles((data || []).flatMap(p => p.attachments || []));
  },
  async setFlag(id, field, val) {
    const { error } = await sb.from('threads').update({ [field]: val }).eq('id', id);
    if (error) throw error;
  },
  async toggleLike(postId, liked) {
    const q = liked
      ? sb.from('likes').delete().eq('post_id', postId).eq('user_id', state.user.id)
      : sb.from('likes').insert({ post_id: postId, user_id: state.user.id });
    const { error } = await q; if (error) throw error;
  },
  async report(postId, reason) {
    const { error } = await sb.from('reports').insert({ post_id: postId, reporter_id: state.user.id, reason });
    if (error) throw error;
  },
  async profile(id) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [t, p] = await Promise.all([
      sb.from('threads').select('id', { count: 'exact', head: true }).eq('author_id', id),
      sb.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', id)
    ]);
    return { ...data, threads: t.count || 0, posts: p.count || 0 };
  },
  async users() {
    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error; return data;
  },
  async patchProfile(id, patch) {
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) throw error;
  },
  async reports() {
    const { data, error } = await sb.from('reports')
      .select(`*, reporter:profiles!reports_reporter_id_fkey(username), post:posts(id,body,thread_id,author:profiles!posts_author_id_fkey(username))`)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(100);
    if (error) throw error; return data;
  },
  async resolveReport(id) {
    const { error } = await sb.from('reports').update({ status: 'resolved', resolved_by: state.user.id }).eq('id', id);
    if (error) throw error;
  },
  /* auth */
  async signUp(email, password, username) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
    if (error) throw error;
    return { needsConfirm: !data.session };
  },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
  },
  async signInDiscord() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: location.origin + location.pathname, scopes: 'identify email' }
    });
    if (error) throw error;
  },
  async signOut() { await sb.auth.signOut(); }
};

/* ====================================================================
 *  WARSTWA DANYCH – TRYB DEMO (localStorage)
 * ==================================================================== */
const Demo = (() => {
  const KEY = 'redline_demo_v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(16).slice(2) + Date.now());
  const now = () => new Date().toISOString();
  const ago_ = ms => new Date(Date.now() - ms).toISOString();
  const H = 3600e3, D = 86400e3;
  let db;

  function seed() {
    const d = { users: [], threads: [], posts: [], likes: [], reports: [], session: null };
    const mk = (id, username, role) => ({ id, email: id + '@demo.local', password: '', username, role, banned: false, warnings: 0, avatar_url: null, created_at: ago_(40 * D) });
    const portrait = (bg, visor, mark) => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#11131b"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><path d="M18 112Q22 72 60 72t42 40" fill="#202532"/><path d="M31 56Q27 17 60 14q33 3 29 42l-8 23H39z" fill="#353d4b"/><path d="M32 48Q60 31 88 48L82 65H38z" fill="${visor}"/><path d="M42 54h36" stroke="#fff" stroke-opacity=".65" stroke-width="3"/><text x="60" y="105" text-anchor="middle" font-family="Arial" font-size="13" font-weight="bold" fill="#fff">${mark}</text></svg>`
    );
    d.users.push(
      mk('u-bot', 'RedlineBot', 'admin'),
      mk('u-2', 'NitroKing', 'moderator'),
      mk('u-3', 'FPS_Hunter', 'user'),
      mk('u-4', 'TruckerPL', 'user')
    );
    const demoBots = [
      ['bot-raven', 'Raven_X', '#a20d2d', '#ff365d', 'RX'],
      ['bot-pixel', 'PixelToxic', '#176c83', '#42d9ff', 'PX'],
      ['bot-volt', 'VoltRacer', '#6c4b12', '#ffc247', 'VR']
    ];
    demoBots.forEach(([id, username, bg, visor, mark]) => {
      const u = mk(id, username, 'user');
      u.is_bot = true;
      u.avatar_url = portrait(bg, visor, mark);
      d.users.push(u);
    });
    const add = (slug, author, title, body, ageMs, replies = [], extra = {}) => {
      const t = { id: uid(), category_slug: slug, author_id: author, title, pinned: false, locked: false, created_at: ago_(ageMs), last_post_at: ago_(ageMs), posts_count: 0, ...extra };
      d.threads.push(t);
      const push = (a, b, age) => { d.posts.push({ id: uid(), thread_id: t.id, author_id: a, body: b, created_at: ago_(age), edited_at: null }); t.posts_count++; t.last_post_at = ago_(age); };
      push(author, body, ageMs);
      replies.forEach((r, i) => push(r[0], r[1], ageMs - (i + 1) * H));
    };
    add('ogloszenia', 'u-bot', 'Witamy na REDLINE ARENA – przeczytaj zanim zaczniesz', 'Cześć! To forum graczy FH3–FH6, CS2, ETS2, World of Tanks, HEAT i GTA 5, a także miejsce na benchmarki i recenzje sprzętu.\n\nPrzeczytaj regulamin i wbij na nasz Discord.', 5 * D, [], { pinned: true });
    add('sprzet', 'u-3', 'RTX vs Radeon w CS2 – wyniki FPS 1080p/1440p', 'Zrobiłem serię testów CS2 na dwóch kartach. Ustawienia: wysokie, 1440p, Premier.\n\nWrzucajcie swoje wyniki w komentarzach – złożymy tabelę!', 2 * D, [['u-2', 'Super temat. Napisz jeszcze jaki CPU i pamięci RAM.'], ['u-3', 'Ryzen 7 + 32 GB DDR5 6000. Dopiszę do pierwszego posta.']]);
    add('fh5', 'u-2', 'Najlepszy tuning pod wyścigi uliczne – dzielimy się kodami', 'Wrzucajcie kody tuningu i opisy aut. Ja zaczynam od mojej ulubionej konfiguracji pod S1.', 1 * D, [['u-3', 'Dodaję swój do wątku jak tylko wrócę do domu.']]);
    add('ets2', 'u-4', 'Konwój ETS2 w sobotę wieczorem – kto chętny?', 'Organizujemy konwój po trasie Calais–Berlin. Zapisy w komentarzach, kanał głosowy na Discordzie.', 8 * H, [['u-2', 'Zapisuję się!']]);
    add('cs2', 'u-3', 'Szukam składu do Premier (Faceit lvl 7+)', 'Gram wieczorami, mikrofon i komunikacja po polsku. Odezwijcie się.', 5 * H);
    add('gta5', 'u-4', 'Polecane mody graficzne do GTA V', 'Jakie modyfikacje graficzne polecacie przy RTX 3070? Zależy mi na stabilnym FPS.', 3 * H);
    d.users.forEach(u => { u.created_at = u.created_at; });
    return d;
  }
  function load() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) { /* brak dostępu */ } return seed(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignoruj */ } }
  db = load(); save();

  const pub = u => u ? { id: u.id, username: u.username, role: u.role, avatar_url: u.avatar_url, is_bot: !!u.is_bot, created_at: u.created_at } : null;
  const user = id => db.users.find(u => u.id === id);
  const th = t => ({ ...t, author: pub(user(t.author_id)) });

  return {
    async categories() { return CATEGORIES; },
    async threadStats() { return [...db.threads].sort((a, b) => b.last_post_at.localeCompare(a.last_post_at)); },
    async memberCount() { return db.users.length; },
    async threads(slug) {
      return db.threads.filter(t => t.category_slug === slug).map(th)
        .sort((a, b) => (b.pinned - a.pinned) || b.last_post_at.localeCompare(a.last_post_at));
    },
    async search(q) { const s = q.toLowerCase(); return db.threads.filter(t => t.title.toLowerCase().includes(s)).map(th); },
    async thread(id) {
      const t = db.threads.find(x => x.id === id); if (!t) return null;
      const posts = db.posts.filter(p => p.thread_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(p => ({ ...p, author: pub(user(p.author_id)) }));
      return { thread: th(t), posts, likes: db.likes.filter(l => posts.some(p => p.id === l.post_id)) };
    },
    async upload(files) {
      const out = [];
      for (const f of files) {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        out.push({ name: f.name.slice(0, 120), size: f.size, type: mimeOf(f.name), data });
      }
      return out;
    },
    async removeFiles() { /* w demo pliki są częścią posta */ },
    async createThread(slug, title, body, att = []) {
      const t = { id: uid(), category_slug: slug, author_id: state.user.id, title, pinned: false, locked: false, created_at: now(), last_post_at: now(), posts_count: 1 };
      db.threads.push(t);
      db.posts.push({ id: uid(), thread_id: t.id, author_id: state.user.id, body, attachments: att, created_at: now(), edited_at: null });
      save(); return t;
    },
    async createPost(threadId, body, att = []) {
      const t = db.threads.find(x => x.id === threadId);
      if (t.locked && !isStaff()) throw new Error('row-level security: wątek zamknięty');
      db.posts.push({ id: uid(), thread_id: threadId, author_id: state.user.id, body, attachments: att, created_at: now(), edited_at: null });
      t.posts_count++; t.last_post_at = now(); save();
    },
    async addBotReply(threadId, botId, body, imageData) {
      const t = db.threads.find(x => x.id === threadId);
      const bot = user(botId);
      if (!t || t.locked || !bot?.is_bot) return false;
      const attachments = imageData ? [{
        name: 'reakcja-' + bot.username + '.svg', size: imageData.length,
        type: 'image/svg+xml', data: imageData
      }] : [];
      db.posts.push({ id: uid(), thread_id: threadId, author_id: botId, body, attachments, created_at: now(), edited_at: null });
      t.posts_count++; t.last_post_at = now(); save(); return true;
    },
    async editPost(id, body) { const p = db.posts.find(x => x.id === id); p.body = body; p.edited_at = now(); save(); },
    async deletePost(id) {
      const p = db.posts.find(x => x.id === id); if (!p) return;
      db.posts = db.posts.filter(x => x.id !== id);
      const t = db.threads.find(x => x.id === p.thread_id); if (t) t.posts_count = Math.max(0, t.posts_count - 1);
      db.reports = db.reports.filter(r => r.post_id !== id); save();
    },
    async deleteThread(id) {
      const ids = db.posts.filter(p => p.thread_id === id).map(p => p.id);
      db.threads = db.threads.filter(t => t.id !== id); db.posts = db.posts.filter(p => p.thread_id !== id);
      db.reports = db.reports.filter(r => !ids.includes(r.post_id)); save();
    },
    async setFlag(id, field, val) { db.threads.find(t => t.id === id)[field] = val; save(); },
    async toggleLike(postId, liked) {
      db.likes = liked ? db.likes.filter(l => !(l.post_id === postId && l.user_id === state.user.id))
        : [...db.likes, { post_id: postId, user_id: state.user.id }];
      save();
    },
    async report(postId, reason) {
      db.reports.push({ id: uid(), post_id: postId, reporter_id: state.user.id, reason, status: 'open', created_at: now() }); save();
    },
    async profile(id) {
      const u = user(id); if (!u) return null;
      return { ...u, threads: db.threads.filter(t => t.author_id === id).length, posts: db.posts.filter(p => p.author_id === id).length };
    },
    async users() { return [...db.users].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async patchProfile(id, patch) { Object.assign(user(id), patch); save(); if (id === state.user?.id) state.profile = { ...user(id) }; },
    async reports() {
      return db.reports.filter(r => r.status === 'open').map(r => {
        const p = db.posts.find(x => x.id === r.post_id);
        return { ...r, reporter: { username: user(r.reporter_id)?.username }, post: p ? { ...p, author: { username: user(p.author_id)?.username } } : null };
      });
    },
    async resolveReport(id) { db.reports.find(r => r.id === id).status = 'resolved'; save(); },
    /* auth demo */
    async signUp(email, password, username) {
      if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('already registered');
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('duplicate key');
      const first = !db.users.some(u => !u.id.startsWith('u-'));
      const u = { id: uid(), email, password, username, role: first ? 'admin' : 'user', banned: false, warnings: 0, avatar_url: null, created_at: now() };
      db.users.push(u); db.session = u.id; save();
      return { needsConfirm: false };
    },
    async signIn(email, password) {
      const u = db.users.find(x => x.email.toLowerCase() === email.toLowerCase() && x.password === password && x.password);
      if (!u) throw new Error('Invalid login credentials');
      db.session = u.id; save();
    },
    async signInDiscord() { throw new Error('Logowanie przez Discord działa po podłączeniu Supabase (patrz README).'); },
    async signOut() { db.session = null; save(); },
    sessionUser() { const u = user(db.session); return u ? { id: u.id, email: u.email } : null; },
    profileSync(id) { const u = user(id); return u ? { ...u } : null; }
  };
})();

const Data = LIVE ? Live : Demo;

/* ====================================================================
 *  SESJA
 * ==================================================================== */
async function loadProfile() {
  if (!state.user) { state.profile = null; return; }
  if (!LIVE) { state.profile = Demo.profileSync(state.user.id); return; }
  for (let i = 0; i < 4; i++) {
    const { data } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (data) { state.profile = data; return; }
    await new Promise(r => setTimeout(r, 500));
  }
}
async function syncDiscord(silent) {
  if (!LIVE || !C.USE_NETLIFY_FUNCTIONS) return;
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token; if (!token) return;
    const r = await fetch('/.netlify/functions/discord-sync', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (!silent) toast(j.error || 'Synchronizacja z Discordem nie powiodła się.', 'err'); return; }
    await loadProfile(); renderUserbox();
    if (!silent) toast(j.inGuild === false ? 'Nie jesteś na naszym serwerze Discord.' : 'Ranga zsynchronizowana: ' + (ROLE[state.profile?.role] || 'Gracz'));
  } catch (e) { if (!silent) toast('Synchronizacja z Discordem jest niedostępna.', 'err'); }
}
async function applySession(session) {
  state.user = session?.user ? { id: session.user.id, email: session.user.email, provider: session.user.app_metadata?.provider } : null;
  await loadProfile();
  renderUserbox();
  if (LIVE && state.user && state.user.provider === 'discord' && !sessionStorage.getItem('dc_synced')) {
    try { sessionStorage.setItem('dc_synced', '1'); } catch (e) { /* ignoruj */ }
    syncDiscord(true);
  }
}
async function initAuth() {
  if (LIVE) {
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
    const { data } = await sb.auth.getSession();
    await applySession(data.session);
    if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + (location.hash || '#/'));
    sb.auth.onAuthStateChange((evt, session) => {
      if (evt === 'INITIAL_SESSION') return;
      setTimeout(async () => { await applySession(session); route(); }, 0);
    });
  } else {
    state.user = Demo.sessionUser();
    await loadProfile(); renderUserbox();
  }
}

/* ====================================================================
 *  INTERFEJS – wspólne
 * ==================================================================== */
function view(html) {
  const el = $('#view');
  el.innerHTML = `<div class="fade">${html}</div>`;
  window.scrollTo(0, 0);
}
function renderUserbox() {
  const box = $('#userbox');
  if (state.profile) {
    box.innerHTML = `<a class="who" href="#/u/${esc(state.profile.id)}">${avatar(state.profile, 32)}<span>${esc(state.profile.username)}</span></a>
      <button class="btn ghost sm" data-act="logout">Wyloguj</button>`;
  } else if (state.user) {
    box.innerHTML = `<span class="muted">Ładowanie profilu…</span> <button class="btn ghost sm" data-act="logout">Wyloguj</button>`;
  } else {
    box.innerHTML = `<button class="btn ghost sm" data-act="login">Zaloguj</button><button class="btn sm" data-act="register">Dołącz</button>`;
  }
  $('#nav-admin').hidden = !isStaff();
}
function openModal(inner) {
  $('#modal-root').innerHTML = `<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
  const f = $('#modal-root input, #modal-root textarea'); if (f) f.focus();
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };
function errorBox(e) {
  return `<div class="empty"><h2 style="justify-content:center">Błąd</h2><p>${esc(niceError(e))}</p><a class="btn" href="#/">Wróć na start</a></div>`;
}
function inviteUrl(extra) { return extra || C.DISCORD_INVITE || '#'; }

function authModal(tab = 'login') {
  const reg = tab === 'register';
  openModal(`
    <button class="link-btn modal-x" data-act="close-modal" aria-label="Zamknij">✕</button>
    <h2>${reg ? 'Dołącz do areny' : 'Zaloguj się'}</h2>
    <button class="btn discord" style="width:100%;justify-content:center" data-act="discord-login">Kontynuuj z Discordem</button>
    <div class="divider">lub e-mail</div>
    <form data-form="${reg ? 'register' : 'login'}">
      ${reg ? `<label for="f-user">Nazwa użytkownika</label><input id="f-user" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_\\-]{3,24}" title="3–24 znaków: litery bez polskich znaków, cyfry, _ i -" autocomplete="username">` : ''}
      <label for="f-mail">E-mail</label><input id="f-mail" name="email" type="email" required autocomplete="email">
      <label for="f-pass">Hasło</label><input id="f-pass" name="password" type="password" required minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}">
      <p style="margin:18px 0 0"><button class="btn" type="submit">${reg ? 'Załóż konto' : 'Zaloguj'}</button></p>
    </form>
    <p class="muted" style="margin:14px 0 0">${reg ? 'Masz konto?' : 'Nie masz konta?'}
      <button class="link-btn" data-act="${reg ? 'login' : 'register'}">${reg ? 'Zaloguj się' : 'Załóż konto'}</button></p>
    ${LIVE ? '' : '<p class="notice">Tryb demo: pierwsze założone konto dostaje rolę admina, żebyś mógł przetestować panel.</p>'}`);
}

/* ====================================================================
 *  WIDOKI
 * ==================================================================== */
async function home() {
  document.title = C.FORUM_NAME + ' – forum graczy';
  const [cats, stats, members] = await Promise.all([Data.categories(), Data.threadStats(), Data.memberCount()]);
  const by = {};
  stats.forEach(t => { (by[t.category_slug] ||= { threads: 0, posts: 0, last: null }); const c = by[t.category_slug]; c.threads++; c.posts += t.posts_count; if (!c.last) c.last = t; });
  const totalPosts = stats.reduce((a, t) => a + t.posts_count, 0);
  const catHtml = c => {
    const s = by[c.slug] || { threads: 0, posts: 0, last: null };
    return `<a class="cat" href="#/k/${esc(c.slug)}">
      <div class="cat-ic" aria-hidden="true">${esc(c.icon)}</div>
      <div><div class="cat-name">${esc(c.name)}</div><div class="cat-desc">${esc(c.description)}</div>
      <div class="cat-meta"><span><b>${s.threads}</b> wątków</span><span><b>${s.posts}</b> postów</span>${s.last ? `<span>${esc(ago(s.last.last_post_at))}</span>` : ''}</div></div></a>`;
  };
  const groups = ['Społeczność', 'Gry'].map(g => `<section class="section"><h2>${esc(g)}</h2><div class="cats">${cats.filter(c => c.grp === g).map(catHtml).join('')}</div></section>`).join('');
  const latest = stats.slice(0, 6).map(t => {
    const c = cats.find(x => x.slug === t.category_slug);
    return `<li><a href="#/w/${esc(t.id)}">${esc(t.title)}</a><span class="sub">${esc(c?.name || '')} · ${esc(ago(t.last_post_at))}</span></li>`;
  }).join('') || '<li class="muted">Brak wątków.</li>';

  view(`
    <section class="hero">
      <h1>Wjedź na <em>czerwone pole</em>.<br>Forum polskich graczy.</h1>
      <p>Forza Horizon 3–6, CS2, ETS2, World of Tanks, HEAT i GTA 5. Do tego benchmarki, recenzje GPU i CPU oraz porady sprzętowe od społeczności.</p>
      <div class="hero-cta">
        <a class="btn discord" href="${esc(inviteUrl())}" target="_blank" rel="noopener">Dołącz na Discord</a>
        ${state.user ? '<a class="btn" href="#/k/sprzet">Benchmarki i sprzęt</a>' : '<button class="btn" data-act="register">Załóż konto</button>'}
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b>${stats.length}</b><span>Wątków</span></div>
      <div class="stat"><b>${totalPosts}</b><span>Postów</span></div>
      <div class="stat"><b>${members}</b><span>Członków</span></div>
      <div class="stat"><b id="dc-online">–</b><span>Online na Discordzie</span></div>
    </div>
    <div class="cols">
      <div>${groups}</div>
      <aside>
        <div class="card dc-card section">
          <h3>Nasz Discord</h3>
          <div class="dc-online"><span class="dc-dot"></span><span id="dc-text">Dołącz do rozmów na żywo</span></div>
          <p class="muted">Kanały głosowe, ekipy do gier, wsparcie moderatorów.</p>
          <a class="btn discord sm" href="${esc(inviteUrl())}" target="_blank" rel="noopener">Wbijaj na serwer</a>
        </div>
        <div class="card section"><h3>Najnowsza aktywność</h3><ul class="mini">${latest}</ul></div>
      </aside>
    </div>`);
  loadDiscordWidget();
}
async function loadDiscordWidget() {
  if (!C.DISCORD_GUILD_ID) return;
  try {
    const r = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(C.DISCORD_GUILD_ID)}/widget.json`);
    if (!r.ok) return;
    const j = await r.json();
    const n = j.presence_count ?? (j.members || []).length;
    const a = $('#dc-online'), b = $('#dc-text');
    if (a) a.textContent = n;
    if (b) b.textContent = `${n} online teraz${j.name ? ' – ' + j.name : ''}`;
  } catch (e) { /* widget wyłączony – pomijamy */ }
}

async function category(slug) {
  const cats = await Data.categories();
  const c = cats.find(x => x.slug === slug);
  if (!c) return view(errorBox('Nie ma takiego działu.'));
  document.title = c.name + ' – ' + C.FORUM_NAME;
  const list = await Data.threads(slug);
  const canNew = canPost() && (slug !== 'ogloszenia' || isStaff());
  const newBtn = canNew ? `<a class="btn" href="#/nowy/${esc(slug)}">Nowy wątek</a>`
    : (!state.user ? '<button class="btn" data-act="login">Zaloguj, aby pisać</button>'
      : (state.profile?.banned ? '<span class="badge ban">Konto zablokowane</span>' : ''));
  view(`
    <div class="crumbs"><a href="#/">Start</a> › ${esc(c.name)}</div>
    <div class="page-head"><div><h1>${esc(c.icon)} ${esc(c.name)}</h1><p class="muted">${esc(c.description)}</p></div>${newBtn}</div>
    <div class="trow head"><div>Wątek</div><div style="text-align:center">Odp.</div><div class="last">Ostatnia aktywność</div></div>
    ${list.length ? list.map(t => threadRow(t)).join('') : '<div class="empty">Brak wątków w tym dziale. Zacznij pierwszy!</div>'}`);
}
function threadRow(t, catName) {
  return `<div class="trow">
    <div><a class="t" href="#/w/${esc(t.id)}">${t.pinned ? '<span class="tag">Przypięty</span>' : ''}${t.locked ? '<span class="tag lock">Zamknięty</span>' : ''}${esc(t.title)}</a>
      <div class="sub">${esc(t.author?.username || 'usunięty')} · ${esc(fmtDay(t.created_at))}${catName ? ' · ' + esc(catName) : ''}</div></div>
    <div class="num">${Math.max(0, t.posts_count - 1)}</div>
    <div class="last">${esc(ago(t.last_post_at))}</div></div>`;
}

async function thread(id) {
  const r = await Data.thread(id);
  if (!r) return view(errorBox('Nie znaleziono wątku.'));
  const { thread: t, posts, likes } = r;
  const cats = await Data.categories();
  const c = cats.find(x => x.slug === t.category_slug);
  document.title = t.title + ' – ' + C.FORUM_NAME;
  const me = state.user?.id;
  const staff = isStaff();
  const firstId = posts[0]?.id;
  const postHtml = (p, i) => {
    const lk = likes.filter(l => l.post_id === p.id);
    const liked = !!me && lk.some(l => l.user_id === me);
    const mine = me && p.author_id === me;
    const a = p.author;
    return `<article class="post" id="p-${esc(p.id)}">
      <aside class="post-user">${avatar(a, 64)}<div><a class="nm" href="#/u/${esc(a?.id || '')}">${esc(a?.username || 'usunięty')}</a>${roleBadge(a?.role, a?.is_bot)}<div class="muted" style="font-size:.82rem;margin-top:4px">od ${a?.created_at ? esc(fmtDay(a.created_at)) : '–'}</div></div></aside>
      <div class="post-main">
        <div class="post-meta"><span>${esc(fmtDate(p.created_at))}${p.edited_at ? ' · edytowano' : ''}</span><span>#${i + 1}</span></div>
        <div class="post-body" id="body-${esc(p.id)}">${fmtBody(p.body)}</div>
        ${attachmentsHtml(p.attachments)}
        <div class="post-edit hidden" id="edit-${esc(p.id)}"><form data-form="edit" data-id="${esc(p.id)}"><textarea name="body" required maxlength="10000">${esc(p.body)}</textarea><p><button class="btn sm" type="submit">Zapisz</button> <button class="btn ghost sm" type="button" data-act="edit-toggle" data-id="${esc(p.id)}">Anuluj</button></p></form></div>
        <div class="post-actions">
          <button class="link-btn ${liked ? 'on' : ''}" data-act="like" data-id="${esc(p.id)}" data-liked="${liked ? 1 : 0}">👍 ${lk.length}</button>
          ${(mine || staff) && canPost() ? `<button class="link-btn" data-act="edit-toggle" data-id="${esc(p.id)}">Edytuj</button>` : ''}
          ${(mine || staff) && p.id !== firstId ? `<button class="link-btn" data-act="del-post" data-id="${esc(p.id)}">Usuń</button>` : ''}
          ${state.user && !mine ? `<button class="link-btn" data-act="report" data-id="${esc(p.id)}">Zgłoś</button>` : ''}
        </div>
      </div></article>`;
  };
  let reply;
  if (!state.user) reply = '<div class="empty">Aby odpowiedzieć, <button class="link-btn on" data-act="login">zaloguj się</button>.</div>';
  else if (state.profile?.banned) reply = '<div class="notice">Twoje konto jest zablokowane – nie możesz pisać.</div>';
  else if (t.locked && !staff) reply = '<div class="notice">Ten wątek jest zamknięty.</div>';
  else reply = `<div class="card"><h3>Twoja odpowiedź</h3><form data-form="reply" data-id="${esc(t.id)}"><textarea name="body" required maxlength="10000" placeholder="Napisz odpowiedź…"></textarea>${uploaderHtml('up-reply')}<p style="margin:14px 0 0"><button class="btn" type="submit">Wyślij</button></p></form></div>`;
  const mod = (me && t.author_id === me) || staff ? `<button class="btn ghost sm" data-act="del-thread" data-id="${esc(t.id)}" data-cat="${esc(t.category_slug)}">Usuń wątek</button>` : '';
  const modStaff = staff ? `<button class="btn ghost sm" data-act="pin" data-id="${esc(t.id)}" data-v="${t.pinned ? 0 : 1}">${t.pinned ? 'Odepnij' : 'Przypnij'}</button> <button class="btn ghost sm" data-act="lock" data-id="${esc(t.id)}" data-v="${t.locked ? 0 : 1}">${t.locked ? 'Otwórz' : 'Zamknij'}</button>` : '';
  view(`
    <div class="crumbs"><a href="#/">Start</a> › <a href="#/k/${esc(t.category_slug)}">${esc(c?.name || '')}</a> › ${esc(t.title)}</div>
    <div class="page-head"><h1>${t.pinned ? '<span class="tag">Przypięty</span>' : ''}${t.locked ? '<span class="tag lock">Zamknięty</span>' : ''}${esc(t.title)}</h1><div>${modStaff} ${mod}</div></div>
    ${posts.map(postHtml).join('')}
    <div style="margin-top:20px">${reply}</div>`);
}

async function newThread(slug) {
  const cats = await Data.categories();
  const c = cats.find(x => x.slug === slug);
  if (!c) return view(errorBox('Nie ma takiego działu.'));
  if (!state.user) { view('<div class="empty">Zaloguj się, aby założyć wątek.</div>'); return authModal('login'); }
  if (!canPost() || (slug === 'ogloszenia' && !isStaff())) return view(errorBox('Nie masz uprawnień do tworzenia wątków w tym dziale.'));
  document.title = 'Nowy wątek – ' + C.FORUM_NAME;
  view(`
    <div class="crumbs"><a href="#/">Start</a> › <a href="#/k/${esc(slug)}">${esc(c.name)}</a> › Nowy wątek</div>
    <h1>Nowy wątek: ${esc(c.name)}</h1>
    <div class="card"><form data-form="new-thread" data-slug="${esc(slug)}">
      <label for="nt-title">Tytuł</label><input id="nt-title" name="title" required minlength="3" maxlength="120" placeholder="Krótki, konkretny tytuł">
      <label for="nt-body">Treść</label><textarea id="nt-body" name="body" required maxlength="10000" placeholder="${slug === 'sprzet' ? 'Np. model GPU/CPU, gra, rozdzielczość, ustawienia, średnie FPS, 1% low…' : 'Opisz temat…'}"></textarea>
      ${uploaderHtml('up-thread')}
      <p style="margin:18px 0 0"><button class="btn" type="submit">Opublikuj</button></p>
    </form></div>`);
}

async function profile(id) {
  const p = await Data.profile(id);
  if (!p) return view(errorBox('Nie znaleziono użytkownika.'));
  document.title = p.username + ' – ' + C.FORUM_NAME;
  const own = state.user?.id === p.id;
  view(`
    <div class="crumbs"><a href="#/">Start</a> › Profil</div>
    <div class="card" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
      ${avatar(p, 96)}
      <div><h1 style="margin:0">${esc(p.username)}</h1>
        <p style="margin:6px 0">${roleBadge(p.role, p.is_bot)} ${p.banned ? '<span class="badge ban">Zablokowany</span>' : ''}</p>
        <p class="muted" style="margin:0">Dołączył: ${esc(fmtDay(p.created_at))} · Wątków: <b style="color:#fff">${p.threads}</b> · Postów: <b style="color:#fff">${p.posts}</b>${own || isStaff() ? ` · Ostrzeżenia: <b style="color:#fff">${p.warnings || 0}</b>` : ''}</p>
        ${own && LIVE && C.USE_NETLIFY_FUNCTIONS ? '<p style="margin:14px 0 0"><button class="btn discord sm" data-act="sync-discord">Synchronizuj rangę z Discordem</button></p>' : ''}
      </div></div>`);
}

async function search(q) {
  document.title = 'Szukaj – ' + C.FORUM_NAME;
  const cats = await Data.categories();
  const res = q.trim().length >= 2 ? await Data.search(q.trim()) : [];
  view(`
    <div class="crumbs"><a href="#/">Start</a> › Wyszukiwanie</div>
    <h1>Wyniki: „${esc(q)}”</h1>
    <div class="trow head"><div>Wątek</div><div style="text-align:center">Odp.</div><div class="last">Aktywność</div></div>
    ${res.length ? res.map(t => threadRow(t, cats.find(c => c.slug === t.category_slug)?.name)).join('') : '<div class="empty">Brak wyników (wpisz co najmniej 2 znaki).</div>'}`);
}

function rules() {
  document.title = 'Regulamin – ' + C.FORUM_NAME;
  view(`
    <div class="crumbs"><a href="#/">Start</a> › Regulamin</div>
    <h1>Regulamin</h1>
    <div class="card rules"><ol>
      <li>Szanuj innych. Bez wyzwisk, nękania, mowy nienawiści i pogróżek.</li>
      <li>Pisz w odpowiednim dziale. Benchmarki i recenzje sprzętu trafiają do działu „Sprzęt i benchmarki”.</li>
      <li>Benchmarki podawaj rzetelnie: model sprzętu, sterowniki, rozdzielczość, ustawienia, metoda pomiaru.</li>
      <li>Zakaz spamu, reklam, piractwa, cheatów i sprzedaży kont.</li>
      <li>Nie publikuj danych prywatnych swoich ani innych osób.</li>
      <li>Decyzje moderatorów można odwołać przez dział „Pomoc i zgłoszenia” lub na Discordzie.</li>
      <li>Za łamanie zasad grożą ostrzeżenia, a w skrajnych przypadkach blokada konta.</li>
    </ol></div>`);
}

async function botsTab() {
  if (!isAdmin()) return '<div class="empty">Boty może konfigurować tylko administrator.</div>';
  if (!LIVE || !C.USE_NETLIFY_FUNCTIONS)
    return '<div class="notice">Boty działają po podłączeniu Supabase i wdrożeniu funkcji Netlify (patrz README). W trybie demo są niedostępne.</div>';
  const [{ bots }, cats] = await Promise.all([callFn('bot-admin', { action: 'list' }), Data.categories()]);
  const catName = s => cats.find(c => c.slug === s)?.name || s;
  return `<div class="card section"><h3>Nowy bot</h3>
      <p class="muted">Bot to osobne konto z odznaką BOT, które pisze przez API (np. z GitHub Actions, skryptu lub własnego bota Discord). Token zobaczysz tylko raz.</p>
      <form data-form="bot-create">
        <label for="bot-name">Nazwa bota</label><input id="bot-name" name="name" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_\\-]{3,24}" placeholder="np. NewsBot" title="3–24 znaków: litery bez polskich znaków, cyfry, _ i -">
        <label>Dozwolone działy <span class="muted" style="text-transform:none;letter-spacing:0">(nic nie zaznaczone = wszystkie)</span></label>
        <div class="checks">${cats.map(c => `<label class="chk"><input type="checkbox" name="cat" value="${esc(c.slug)}"> ${esc(c.name)}</label>`).join('')}</div>
        <p style="margin:16px 0 0"><button class="btn" type="submit">Utwórz bota</button></p>
      </form></div>
    <h3>Twoje boty</h3>
    ${bots.length ? `<div class="table-wrap"><table><thead><tr><th>Bot</th><th>Działy</th><th>Ostatnio</th><th>Status</th><th>Akcje</th></tr></thead><tbody>
      ${bots.map(b => `<tr><td><a href="#/u/${esc(b.profile_id)}">${esc(b.profiles?.username || '?')}</a></td>
        <td>${b.allowed_categories.length ? esc(b.allowed_categories.map(catName).join(', ')) : 'wszystkie'}</td>
        <td>${b.last_used_at ? esc(ago(b.last_used_at)) : 'nigdy'}</td>
        <td>${b.active ? '<span class="badge moderator">aktywny</span>' : '<span class="badge ban">wyłączony</span>'}</td>
        <td><div class="row">
          <button class="btn ghost sm" data-act="bot-toggle" data-id="${esc(b.id)}" data-v="${b.active ? 0 : 1}">${b.active ? 'Wyłącz' : 'Włącz'}</button>
          <button class="btn ghost sm" data-act="bot-rotate" data-id="${esc(b.id)}">Nowy token</button>
          <button class="btn danger sm" data-act="bot-del" data-id="${esc(b.id)}" data-name="${esc(b.profiles?.username || '')}">Usuń</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Brak botów. Utwórz pierwszego powyżej.</div>'}`;
}
function tokenModal(token, name) {
  const url = location.origin + '/.netlify/functions/bot-post';
  const example = `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"category":"ogolne","title":"Test bota","body":"Cześć od ${name}!"}'`;
  openModal(`<button class="link-btn modal-x" data-act="close-modal" aria-label="Zamknij">✕</button>
    <h2>Token bota ${esc(name)}</h2>
    <p class="notice">Skopiuj token teraz. Ze względów bezpieczeństwa nie będzie już widoczny (przechowujemy tylko jego skrót).</p>
    <label for="tok">Token</label><input id="tok" readonly value="${esc(token)}" onfocus="this.select()">
    <label>Przykład użycia</label><pre>${esc(example)}</pre>
    <p class="muted" style="margin:10px 0 0">Odpowiedź w wątku: <code>{"thread_id":"…","body":"…"}</code>. Pliki: <code>"files":[{"name":"wynik.png","base64":"…"}]</code> (do 5 plików, łącznie 4 MB).</p>`);
}

async function admin() {
  if (!isStaff()) return view(errorBox('Ta sekcja jest dostępna tylko dla moderatorów i administratorów.'));
  document.title = 'Panel – ' + C.FORUM_NAME;
  const tab = state.adminTab;
  let body = '';
  if (tab === 'reports') {
    const rs = await Data.reports();
    body = rs.length ? rs.map(r => `<div class="card" style="margin-bottom:10px">
      <div class="muted" style="font-size:.9rem">Zgłosił: <b>${esc(r.reporter?.username || '?')}</b> · ${esc(ago(r.created_at))} · autor posta: <b>${esc(r.post?.author?.username || '?')}</b></div>
      <p style="margin:8px 0"><b>Powód:</b> ${esc(r.reason)}</p>
      ${r.post ? `<blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid var(--red);background:var(--bg2)">${fmtBody(r.post.body.slice(0, 400))}${r.post.body.length > 400 ? '…' : ''}</blockquote>` : '<p class="muted">Post został usunięty.</p>'}
      <div class="row">${r.post ? `<a class="btn ghost sm" href="#/w/${esc(r.post.thread_id)}">Otwórz wątek</a> <button class="btn danger sm" data-act="rep-del" data-id="${esc(r.id)}" data-post="${esc(r.post.id)}">Usuń post</button>` : ''} <button class="btn sm" data-act="rep-ok" data-id="${esc(r.id)}">Załatwione</button></div></div>`).join('')
      : '<div class="empty">Brak otwartych zgłoszeń. 🎉</div>';
  } else if (tab === 'users') {
    const us = await Data.users();
    body = `<input id="user-filter" placeholder="Filtruj użytkowników…" style="max-width:320px;margin-bottom:12px" aria-label="Filtruj użytkowników">
      <div class="table-wrap"><table><thead><tr><th>Użytkownik</th><th>Ranga</th><th>Ostrz.</th><th>Status</th><th>Akcje</th></tr></thead><tbody>
      ${us.map(u => {
        const protectedUser = u.role === 'admin' && !isAdmin();
        const self = u.id === state.user.id;
        return `<tr data-name="${esc(u.username.toLowerCase())}"><td><a href="#/u/${esc(u.id)}">${esc(u.username)}</a></td>
          <td>${isAdmin() && !self ? `<select data-change="set-role" data-id="${esc(u.id)}" aria-label="Ranga ${esc(u.username)}">${['user', 'moderator', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>` : roleBadge(u.role, u.is_bot)}</td>
          <td>${u.warnings || 0}</td><td>${u.banned ? '<span class="badge ban">Ban</span>' : 'OK'}</td>
          <td>${protectedUser || self ? '–' : `<div class="row"><button class="btn ghost sm" data-act="warn" data-id="${esc(u.id)}" data-w="${u.warnings || 0}">Ostrzeż</button><button class="btn ${u.banned ? 'ghost' : 'danger'} sm" data-act="ban" data-id="${esc(u.id)}" data-v="${u.banned ? 0 : 1}">${u.banned ? 'Odbanuj' : 'Banuj'}</button></div>`}</td></tr>`;
      }).join('')}</tbody></table></div>
      ${isAdmin() ? '<p class="muted">Aby dodać moderatora, zmień rangę użytkownika na „Moderator”. Role z Discorda synchronizują się przy logowaniu przez Discord.</p>' : '<p class="muted">Rangi zmienia tylko administrator.</p>'}`;
  } else if (tab === 'bots') {
    body = await botsTab();
  } else {
    body = `<div class="card"><h3>Integracja z Discordem</h3>
      <ul>
        <li>Zaproszenie: <b>${esc(C.DISCORD_INVITE || 'nie ustawiono')}</b></li>
        <li>Widget online (ID serwera): <b>${esc(C.DISCORD_GUILD_ID || 'nie ustawiono')}</b></li>
        <li>Logowanie Discord + synchronizacja ról + powiadomienia: ${LIVE && C.USE_NETLIFY_FUNCTIONS ? '<b style="color:var(--ok)">włączone</b>' : '<b style="color:var(--warn)">wymaga Supabase i funkcji Netlify</b>'}</li>
      </ul><p class="muted">Szczegóły konfiguracji znajdziesz w README.</p></div>`;
  }
  view(`
    <div class="crumbs"><a href="#/">Start</a> › Panel moderacji</div>
    <h1>Panel moderacji</h1>
    <div class="tabs" role="tablist">
      ${[['reports', 'Zgłoszenia'], ['users', 'Użytkownicy'], ...(isAdmin() ? [['bots', 'Boty']] : []), ['discord', 'Discord']].map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" role="tab" data-act="tab" data-tab="${k}">${l}</button>`).join('')}
    </div>${body}`);
}

/* ====================================================================
 *  ROUTER
 * ==================================================================== */
const routes = [
  [/^#?\/?$/, home],
  [/^#\/k\/([\w-]+)$/, category],
  [/^#\/w\/([\w-]+)$/, thread],
  [/^#\/nowy\/([\w-]+)$/, newThread],
  [/^#\/u\/([\w-]+)$/, profile],
  [/^#\/admin$/, admin],
  [/^#\/szukaj\/(.*)$/, search],
  [/^#\/regulamin$/, rules]
];
async function route() {
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try { await fn(...m.slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); view(errorBox(e)); }
      $$('.nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === h));
      return;
    }
  }
  view(errorBox('Nie znaleziono strony.'));
}

/* ====================================================================
 *  ZDARZENIA
 * ==================================================================== */
const guardCooldown = () => {
  if (Date.now() < state.cooldown) { toast('Poczekaj chwilę przed kolejnym wpisem.', 'err'); return false; }
  state.cooldown = Date.now() + 8000; return true;
};
const needLogin = () => { if (!state.user) { authModal('login'); return true; } return false; };

const clickActions = {
  'close-modal': (el, e) => { if (e.target === el) closeModal(); },
  login: () => authModal('login'),
  register: () => authModal('register'),
  'discord-login': async () => { try { await Data.signInDiscord(); } catch (e) { toast(niceError(e), 'err'); } },
  logout: async () => { await Data.signOut(); state.user = null; state.profile = null; try { sessionStorage.removeItem('dc_synced'); } catch (e) { /* ignoruj */ } renderUserbox(); toast('Wylogowano.'); location.hash = '#/'; route(); },
  'sync-discord': () => syncDiscord(false),
  like: async el => {
    if (needLogin()) return;
    if (!canPost()) return toast('Konto zablokowane.', 'err');
    await Data.toggleLike(el.dataset.id, el.dataset.liked === '1'); route();
  },
  'edit-toggle': el => { $('#body-' + el.dataset.id).classList.toggle('hidden'); $('#edit-' + el.dataset.id).classList.toggle('hidden'); },
  'del-post': async el => { if (confirm('Usunąć ten post?')) { await Data.deletePost(el.dataset.id); toast('Post usunięty.'); route(); } },
  'del-thread': async el => {
    if (!confirm('Usunąć cały wątek wraz z odpowiedziami?')) return;
    await Data.deleteThread(el.dataset.id); toast('Wątek usunięty.'); location.hash = '#/k/' + el.dataset.cat;
  },
  pin: async el => { await Data.setFlag(el.dataset.id, 'pinned', el.dataset.v === '1'); route(); },
  lock: async el => { await Data.setFlag(el.dataset.id, 'locked', el.dataset.v === '1'); route(); },
  report: el => {
    if (needLogin()) return;
    openModal(`<button class="link-btn modal-x" data-act="close-modal" aria-label="Zamknij">✕</button><h2>Zgłoś post</h2>
      <form data-form="report" data-id="${esc(el.dataset.id)}"><label for="rp">Powód zgłoszenia</label><textarea id="rp" name="reason" required minlength="3" maxlength="500" style="min-height:100px"></textarea>
      <p style="margin:16px 0 0"><button class="btn" type="submit">Wyślij zgłoszenie</button></p></form>`);
  },
  tab: el => { state.adminTab = el.dataset.tab; route(); },
  'rm-file': el => {
    const input = el.closest('[data-uploader]').querySelector('input[name=files]');
    const keep = [...(input._keep || [])]; keep.splice(Number(el.dataset.i), 1);
    const dt = new DataTransfer(); keep.forEach(f => dt.items.add(f));
    input.files = dt.files; input._keep = keep; renderFileList(input);
  },
  'bot-toggle': async el => { await callFn('bot-admin', { action: 'toggle', id: el.dataset.id, active: el.dataset.v === '1' }); toast('Zapisano.'); route(); },
  'bot-rotate': async el => {
    if (!confirm('Wygenerować nowy token? Stary przestanie działać.')) return;
    const r = await callFn('bot-admin', { action: 'rotate', id: el.dataset.id });
    tokenModal(r.token, 'bota');
  },
  'bot-del': async el => {
    if (!confirm(`Usunąć bota ${el.dataset.name}? Zniknie też WSZYSTKO, co opublikował (wątki i posty).`)) return;
    await callFn('bot-admin', { action: 'delete', id: el.dataset.id }); toast('Bot usunięty.'); route();
  },
  'rep-ok': async el => { await Data.resolveReport(el.dataset.id); route(); },
  'rep-del': async el => { if (confirm('Usunąć zgłoszony post?')) { await Data.deletePost(el.dataset.post); toast('Post usunięty.'); route(); } },
  warn: async el => { await Data.patchProfile(el.dataset.id, { warnings: Number(el.dataset.w) + 1 }); toast('Ostrzeżenie dodane.'); route(); },
  ban: async el => {
    const on = el.dataset.v === '1';
    if (on && !confirm('Zablokować tego użytkownika?')) return;
    await Data.patchProfile(el.dataset.id, { banned: on }); toast(on ? 'Użytkownik zablokowany.' : 'Użytkownik odblokowany.'); route();
  }
};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = clickActions[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  try { await fn(el, e); } catch (err) { console.error(err); toast(niceError(err), 'err'); }
});
document.addEventListener('change', async e => {
  const el = e.target.closest('[data-change="set-role"]'); if (!el) return;
  try { await Data.patchProfile(el.dataset.id, { role: el.value }); toast('Ranga zmieniona: ' + ROLE[el.value]); route(); }
  catch (err) { toast(niceError(err), 'err'); route(); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'user-filter') return;
  const q = e.target.value.toLowerCase();
  $$('tbody tr[data-name]').forEach(tr => { tr.hidden = !tr.dataset.name.includes(q); });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* uploader: wybór z okna, przeciąganie i wklejanie zrzutów ekranu */
document.addEventListener('change', e => {
  const i = e.target;
  if (i.matches?.('input[type=file][name=files]')) mergeFiles(i, [...i.files].filter(f => f !== undefined && !(i._keep || []).includes(f)));
});
document.addEventListener('paste', e => {
  const ta = e.target.closest?.('textarea'); if (!ta) return;
  const input = ta.closest('form')?.querySelector('input[name=files]'); if (!input) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length || [...(e.clipboardData.types || [])].includes('text/plain')) return;
  e.preventDefault(); mergeFiles(input, files);
});
document.addEventListener('dragover', e => { const u = e.target.closest?.('[data-uploader]'); if (u) { e.preventDefault(); u.classList.add('over'); } });
document.addEventListener('dragleave', e => { e.target.closest?.('[data-uploader]')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  const u = e.target.closest?.('[data-uploader]'); if (!u) return;
  e.preventDefault(); u.classList.remove('over');
  mergeFiles(u.querySelector('input[name=files]'), [...(e.dataTransfer?.files || [])]);
});

const formHandlers = {
  search: f => { const q = new FormData(f).get('q').toString().trim(); if (q) location.hash = '#/szukaj/' + encodeURIComponent(q); },
  login: async f => {
    const d = new FormData(f);
    await Data.signIn(d.get('email').toString().trim(), d.get('password').toString());
    if (!LIVE) { state.user = Demo.sessionUser(); await loadProfile(); renderUserbox(); route(); }
    closeModal(); toast('Zalogowano!');
  },
  register: async f => {
    const d = new FormData(f);
    const r = await Data.signUp(d.get('email').toString().trim(), d.get('password').toString(), d.get('username').toString().trim());
    if (!LIVE) { state.user = Demo.sessionUser(); await loadProfile(); renderUserbox(); route(); }
    closeModal();
    toast(r.needsConfirm ? 'Konto utworzone. Sprawdź e-mail i potwierdź adres.' : 'Konto utworzone. Witaj w arenie!');
  },
  'new-thread': async f => {
    if (!guardCooldown()) return;
    const d = new FormData(f), slug = f.dataset.slug;
    const title = d.get('title').toString().trim(), body = d.get('body').toString().trim();
    const att = await Data.upload(formFiles(f));
    let t;
    try { t = await Data.createThread(slug, title, body, att); }
    catch (e) { await Data.removeFiles(att); throw e; }
    if (LIVE && C.USE_NETLIFY_FUNCTIONS) notifyDiscord(t, title, slug);
    toast('Wątek opublikowany.'); location.hash = '#/w/' + t.id;
    if (!LIVE) startOfflineBotReplies(t.id, title);
  },
  reply: async f => {
    if (!guardCooldown()) return;
    const att = await Data.upload(formFiles(f));
    try { await Data.createPost(f.dataset.id, new FormData(f).get('body').toString().trim(), att); }
    catch (e) { await Data.removeFiles(att); throw e; }
    toast('Odpowiedź dodana.'); route();
  },
  edit: async f => {
    await Data.editPost(f.dataset.id, new FormData(f).get('body').toString().trim()); toast('Zapisano zmiany.'); route();
  },
  'bot-create': async f => {
    const d = new FormData(f);
    const r = await callFn('bot-admin', { action: 'create', name: d.get('name').toString().trim(), categories: d.getAll('cat') });
    tokenModal(r.token, r.username); route();
  },
  report: async f => {
    await Data.report(f.dataset.id, new FormData(f).get('reason').toString().trim()); closeModal(); toast('Dziękujemy! Zgłoszenie trafiło do moderacji.');
  }
};
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const btn = $('button[type=submit]', f); if (btn) btn.disabled = true;
  try { await formHandlers[f.dataset.form](f); } catch (err) { console.error(err); toast(niceError(err), 'err'); }
  finally { if (btn) btn.disabled = false; }
});


function startOfflineBotReplies(threadId, title) {
  if (LIVE) return; // prawdziwy backend nie dostaje fikcyjnych kont ani postów
  const bots = [
    { id: 'bot-raven', name: 'Raven_X', lines: [
      'No dobra, temat ciekawy. Ale konkrety poproszę, bo samym tytułem benchmarku nie zrobisz 😏',
      'Widzę odważne założenia. Masz pomiary przed i po, czy lecimy na przeczuciach?'
    ]},
    { id: 'bot-pixel', name: 'PixelToxic', lines: [
      'Oho, kolejny temat do testowania. Nie spal nam sekcji komentarzy pierwszym wynikiem 😂',
      'Brzmi nieźle, ale pokaż screeny i ustawienia. Bez tego wynik jest trochę z kosmosu.'
    ]},
    { id: 'bot-volt', name: 'VoltRacer', lines: [
      'Wbijam do dyskusji. Ktoś tu chyba chce wywołać małą wojnę sprzętową 😈',
      'Dobra, nieźle. Czekam na szczegóły, bo na razie to tylko rozgrzewka.'
    ]}
  ];
  const safeTitle = String(title || 'ten temat').slice(0, 70);
  const reactions = [
    ['#8e1533', '#ff4b70', 'NICE TRY'],
    ['#145a72', '#47dfff', 'SHOW FPS'],
    ['#705018', '#ffd166', 'PROVE IT']
  ];
  bots.forEach((bot, index) => {
    const delay = index === 0 ? 5000 : (index === 1 ? 10000 : 15000);
    window.setTimeout(async () => {
      try {
        const line = bot.lines[Math.floor(Math.random() * bot.lines.length)];
        const body = index === 0
          ? `@${state.profile?.username || 'autor'} ${line}\n\nOdnoszę się do: „${safeTitle}”.`
          : line;
        const [bg, accent, caption] = reactions[index];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180" viewBox="0 0 480 180"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#10131b"/></linearGradient></defs><rect width="480" height="180" rx="18" fill="url(#b)"/><path d="M20 135L105 50l55 55 55-70 85 100" fill="none" stroke="${accent}" stroke-width="8" opacity=".7"/><text x="24" y="42" fill="#fff" font-family="Arial" font-size="20" font-weight="bold">${bot.name}</text><text x="24" y="160" fill="${accent}" font-family="Arial" font-size="25" font-weight="bold">${caption}</text></svg>`;
        const data = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
        const added = await Demo.addBotReply(threadId, bot.id, body, data);
        if (added && location.hash === '#/w/' + threadId) route();
      } catch (e) { console.warn('Offline bot reply:', e); }
    }, delay);
  });
}

async function notifyDiscord(t, title, slug) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token; if (!token) return;
    const cats = await Data.categories();
    await fetch('/.netlify/functions/discord-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ thread_id: t.id, title, category: cats.find(c => c.slug === slug)?.name || slug })
    });
  } catch (e) { /* powiadomienie opcjonalne */ }
}

/* ====================================================================
 *  START
 * ==================================================================== */
(async function boot() {
  $('#nav-discord').href = inviteUrl();
  if (!LIVE) $('#demo-banner').hidden = false;
  try { await initAuth(); } catch (e) { console.error(e); toast('Nie udało się połączyć z backendem.', 'err'); }
  window.addEventListener('hashchange', route);
  route();
})();
})();
