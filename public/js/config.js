/*
 * KONFIGURACJA FORUM
 * Klucz "anon" Supabase jest publiczny z założenia – bezpieczeństwo zapewniają reguły RLS z supabase/schema.sql.
 * NIGDY nie wklejaj tu klucza "service_role".
 * Gdy SUPABASE_URL jest pusty, forum działa w trybie DEMO (dane w localStorage przeglądarki).
 */
window.FORUM_CONFIG = {
  SUPABASE_URL: "https://bhgilnjwlbwbpofushyd.supabase.co",          // np. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZ2lsbmp3bGJ3YnBvZnVzaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNDQzOTgsImV4cCI6MjEwOTkyMDM5OH0.rvg42IagIQvOcsSN_9wcZsJItm__yzB1_VN9z_L_sCM",     // Project Settings -> API -> anon public
  DISCORD_INVITE: "https://discord.gg/TWOJ_KOD",   // link zaproszenia do Twojego serwera
  DISCORD_GUILD_ID: "",      // ID serwera (do widgetu online; włącz Widget w ustawieniach serwera)
  FORUM_NAME: "REDLINE ARENA",
  USE_NETLIFY_FUNCTIONS: true  // synchronizacja ról i powiadomienia na Discordzie (wymaga wdrożenia z funkcjami)
};
