// Synchronizacja rangi forum z rolami na serwerze Discord.
// Wymaga zmiennych środowiskowych (Netlify -> Site settings -> Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_ADMIN_ROLE_ID, DISCORD_MOD_ROLE_ID
// Bot musi być na serwerze i mieć włączony "Server Members Intent".

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metoda niedozwolona.' });
  const env = process.env;
  const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) return json(500, { error: 'Brak konfiguracji serwera: ' + missing.join(', ') });

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Brak tokenu.' });

  // 1) zweryfikuj użytkownika przez Supabase Auth
  const ures = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!ures.ok) return json(401, { error: 'Nieprawidłowa sesja.' });
  const user = await ures.json();

  const discord = (user.identities || []).find(i => i.provider === 'discord');
  const discordId = discord?.id || discord?.identity_data?.provider_id || discord?.identity_data?.sub;
  if (!discordId) return json(400, { error: 'To konto nie jest połączone z Discordem. Zaloguj się przez Discord.' });

  // 2) pobierz role członka serwera (bot)
  const mres = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${encodeURIComponent(discordId)}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (mres.status === 404) return json(200, { inGuild: false });
  if (!mres.ok) return json(502, { error: 'Discord odrzucił zapytanie (sprawdź token bota i ID serwera).' });
  const member = await mres.json();
  const roles = member.roles || [];

  let role = 'user';
  if (env.DISCORD_MOD_ROLE_ID && roles.includes(env.DISCORD_MOD_ROLE_ID)) role = 'moderator';
  if (env.DISCORD_ADMIN_ROLE_ID && roles.includes(env.DISCORD_ADMIN_ROLE_ID)) role = 'admin';

  // 3) zapisz rangę (service role omija RLS – tylko po weryfikacji powyżej)
  const patch = { role, discord_id: String(discordId) };
  const pres = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!pres.ok) return json(500, { error: 'Nie udało się zapisać rangi.' });
  return json(200, { inGuild: true, role });
};
