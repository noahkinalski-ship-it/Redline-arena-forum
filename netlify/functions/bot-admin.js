// Zarządzanie botami (tylko dla administratora forum).
// POST { action: 'list' | 'create' | 'rotate' | 'toggle' | 'delete', ... }  + Authorization: Bearer <sesja Supabase>
// Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');
const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newToken = () => 'rlb_' + crypto.randomBytes(24).toString('hex');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Użyj metody POST.' });
  const env = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !env[k]);
  if (missing.length) return json(500, { error: 'Brak konfiguracji serwera: ' + missing.join(', ') });
  const SK = env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = (path, opts = {}) => fetch(env.SUPABASE_URL + path, {
    ...opts,
    headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });

  // uwierzytelnienie + wymóg roli admin (sprawdzany w bazie, nie w tokenie)
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Brak sesji.' });
  const ures = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt } });
  if (!ures.ok) return json(401, { error: 'Nieprawidłowa sesja.' });
  const me = await ures.json();
  const pres = await sb(`/rest/v1/profiles?id=eq.${me.id}&select=role,banned`);
  const prof = pres.ok ? (await pres.json())[0] : null;
  if (!prof || prof.role !== 'admin' || prof.banned) return json(403, { error: 'Tylko administrator może zarządzać botami.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Zły JSON.' }); }
  const id = p.id;
  if (['rotate', 'toggle', 'delete'].includes(p.action) && !UUID.test(String(id))) return json(400, { error: 'Zły identyfikator.' });

  if (p.action === 'list') {
    const r = await sb('/rest/v1/bots?select=id,profile_id,allowed_categories,active,last_used_at,created_at,profiles(username)&order=created_at.desc');
    if (!r.ok) return json(500, { error: 'Nie udało się pobrać listy (czy uruchomiono 02_uploads_and_bots.sql?).' });
    return json(200, { bots: await r.json() });
  }

  if (p.action === 'create') {
    const name = String(p.name || '').trim();
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(name)) return json(400, { error: 'Nazwa bota: 3–24 znaków (litery bez polskich znaków, cyfry, _ i -).' });
    const cats = Array.isArray(p.categories) ? p.categories.map(String).filter(c => /^[\w-]{1,40}$/.test(c)) : [];
    if (cats.length) {
      const cr = await sb('/rest/v1/categories?select=slug');
      const have = new Set((await cr.json()).map(c => c.slug));
      if (cats.some(c => !have.has(c))) return json(400, { error: 'Nieznany dział na liście.' });
    }
    // konto bota = zwykły użytkownik Supabase z losowym hasłem (nikt się na nie nie loguje)
    const ar = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `bot-${crypto.randomUUID()}@bots.invalid`, password: crypto.randomBytes(32).toString('hex'),
        email_confirm: true, user_metadata: { username: name }
      })
    });
    if (!ar.ok) return json(500, { error: 'Nie udało się utworzyć konta bota.' });
    const au = await ar.json();
    const token = newToken();
    const flag = await sb(`/rest/v1/profiles?id=eq.${au.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ is_bot: true }) });
    const flagged = flag.ok ? (await flag.json())[0] : null;
    const ins = flagged && await sb('/rest/v1/bots', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ profile_id: au.id, token_hash: sha(token), allowed_categories: cats, created_by: me.id })
    });
    if (!ins || !ins.ok) {
      await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + au.id, { method: 'DELETE', headers: { apikey: SK, Authorization: 'Bearer ' + SK } });
      return json(500, { error: 'Nie udało się zapisać bota (czy uruchomiono 02_uploads_and_bots.sql?).' });
    }
    return json(200, { token, username: flagged.username });   // token widoczny tylko teraz
  }

  if (p.action === 'rotate') {
    const token = newToken();
    const r = await sb(`/rest/v1/bots?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ token_hash: sha(token) }) });
    if (!r.ok || !(await r.json()).length) return json(404, { error: 'Nie znaleziono bota.' });
    return json(200, { token });
  }

  if (p.action === 'toggle') {
    const r = await sb(`/rest/v1/bots?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ active: !!p.active }) });
    if (!r.ok || !(await r.json()).length) return json(404, { error: 'Nie znaleziono bota.' });
    return json(200, { ok: true });
  }

  if (p.action === 'delete') {
    const r = await sb(`/rest/v1/bots?id=eq.${id}&select=profile_id`);
    const bot = r.ok ? (await r.json())[0] : null;
    if (!bot) return json(404, { error: 'Nie znaleziono bota.' });
    // usunięcie konta kasuje profil, wpis bota i (kaskadowo) wszystkie jego wątki i posty
    const d = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + bot.profile_id, { method: 'DELETE', headers: { apikey: SK, Authorization: 'Bearer ' + SK } });
    if (!d.ok) return json(500, { error: 'Nie udało się usunąć bota.' });
    return json(200, { ok: true });
  }

  return json(400, { error: 'Nieznana akcja.' });
};
