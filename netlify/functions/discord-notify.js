// Powiadomienie na kanale Discord o nowym wątku (webhook).
// Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_URL, SITE_URL (opcjonalnie)

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metoda niedozwolona.' });
  const env = process.env;
  if (!env.DISCORD_WEBHOOK_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(204, {});

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Brak tokenu.' });

  const ures = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!ures.ok) return json(401, { error: 'Nieprawidłowa sesja.' });
  const user = await ures.json();

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Zły JSON.' }); }
  const id = String(payload.thread_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'Zły identyfikator.' });

  // dane bierzemy z bazy, a nie od klienta – nie da się podszyć ani wysłać dowolnej treści
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const tres = await fetch(
    `${env.SUPABASE_URL}/rest/v1/threads?id=eq.${id}&select=id,title,author_id,created_at,category_slug,categories(name),profiles!threads_author_id_fkey(username)`,
    { headers: h }
  );
  const rows = tres.ok ? await tres.json() : [];
  const t = rows[0];
  if (!t || t.author_id !== user.id) return json(403, { error: 'Brak dostępu.' });
  if (Date.now() - new Date(t.created_at).getTime() > 5 * 60 * 1000) return json(409, { error: 'Wątek jest za stary.' });

  const base = (env.SITE_URL || event.headers.origin || '').replace(/\/$/, '');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const body = {
    username: 'REDLINE ARENA',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clip(t.title, 250),
      url: base ? `${base}/#/w/${t.id}` : undefined,
      color: 0xe4002b,
      description: `Nowy wątek w dziale **${clip(t.categories?.name || t.category_slug, 80)}**`,
      author: { name: clip(t.profiles?.username || 'gracz', 80) },
      timestamp: t.created_at
    }]
  };
  const r = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return json(r.ok ? 200 : 502, { ok: r.ok });
};
