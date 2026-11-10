# REDLINE ARENA – forum graczy (Netlify + Supabase + Discord)

Forum z działami: FH3, FH4, FH5, FH6, CS2, ETS2, World of Tanks, HEAT, GTA 5, a do tego
Ogłoszenia, Ogólne, Sprzęt i benchmarki oraz Pomoc.
Styl: ciemny, gamingowy, czerwone akcenty. Logo jest własne (bez znaku ROG/ASUS).

## 0. Szybki test bez konfiguracji
Wrzuć folder na Netlify (krok 4) albo otwórz `public/index.html` przez dowolny serwer statyczny.
Bez Supabase forum działa w **trybie DEMO**: dane są tylko w Twojej przeglądarce,
a pierwsze założone konto dostaje rolę admina. To dobry sposób, żeby obejrzeć wygląd i panel.

## 1. Supabase (prawdziwe forum)
1. Załóż projekt na https://supabase.com (darmowy plan).
2. **SQL Editor -> New query**, wklej całą zawartość `supabase/schema.sql`, kliknij **Run**.
   Następnie w **nowym zapytaniu** wklej `supabase/02_uploads_and_bots.sql` i też kliknij **Run**
   (pliki/zdjęcia w postach oraz boty; skrypt można uruchamiać wielokrotnie).
3. **Project Settings -> API**: skopiuj `Project URL` i klucz `anon public`.
   Wklej je do `public/js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
   Klucz `service_role` NIGDY nie trafia do `config.js`, tylko do zmiennych Netlify.
4. **Authentication -> URL Configuration**: ustaw `Site URL` na adres swojej strony
   (np. `https://twoja-nazwa.netlify.app`) i dodaj go do `Redirect URLs`.
5. Zarejestruj się na forum, potem w SQL Editor:
   `update public.profiles set role = 'admin' where username = 'TWOJ_NICK';`

## 2. Logowanie przez Discord
1. https://discord.com/developers/applications -> **New Application**.
2. **OAuth2**: skopiuj `Client ID` i `Client Secret`. W **Redirects** dodaj adres z Supabase:
   `https://TWOJ-PROJEKT.supabase.co/auth/v1/callback`.
3. Supabase -> **Authentication -> Providers -> Discord**: włącz i wklej Client ID oraz Secret.

## 3. Role z Discorda, widget i powiadomienia
- **Zaproszenie i widget:** w `config.js` ustaw `DISCORD_INVITE` oraz `DISCORD_GUILD_ID`.
  W Discordzie: Ustawienia serwera -> **Widget** -> włącz (to pokazuje liczbę osób online).
  ID serwera: Ustawienia -> Zaawansowane -> Tryb dewelopera, potem PPM na serwer -> Kopiuj ID.
- **Synchronizacja ról:** w aplikacji Discord (zakładka **Bot**) utwórz bota, włącz
  **Server Members Intent**, dodaj bota na serwer (OAuth2 -> URL Generator -> scope `bot`).
  Skopiuj token bota. Skopiuj też ID roli admina i roli moderatora serwera.
  Po zalogowaniu przez Discord ranga na forum ustawia się sama (profil -> „Synchronizuj rangę”).
- **Powiadomienia o nowych wątkach:** na wybranym kanale: Edytuj kanał -> Integracje ->
  Webhooki -> Nowy webhook -> Kopiuj URL.

Zmienne środowiskowe (Netlify -> Site configuration -> Environment variables), wzór w `.env.example`:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID`, `DISCORD_MOD_ROLE_ID`, `DISCORD_WEBHOOK_URL`, `SITE_URL`.

## 4. Wdrożenie na Netlify
**Najprościej:** Netlify -> Add new site -> **Deploy manually** -> przeciągnij cały folder projektu
(z `public/`, `netlify/` i `netlify.toml`). Funkcje Discorda działają tylko przy wdrożeniu z folderem
`netlify/functions`. Samo przeciągnięcie `public/` wyłącza je, a forum nadal działa bez nich.
**Lepiej:** wrzuć projekt na GitHub i połącz repozytorium z Netlify (build command pusty, publish `public`).

## 5. Pliki i zdjęcia w postach
Przy nowym wątku i odpowiedzi jest pole „Dodaj pliki”. Można je wybrać, **przeciągnąć** albo
**wkleić zrzut ekranu (Ctrl+V)** w polu tekstu. Idealne do wyników benchmarków.
- Dozwolone: PNG, JPG, GIF, WEBP (wyświetlane jako obraz), MP4/WEBM (odtwarzacz),
  PDF, ZIP, 7Z, RAR, TXT, LOG, JSON, CSV, DOCX, XLSX (jako plik do pobrania).
- Limity: 5 plików na post, 10 MB na plik. Zmiana limitu: bucket `attachments` w Supabase
  (Storage) oraz `MAX_MB` w `public/js/app.js`. Darmowy plan Supabase ma 1 GB miejsca.
- Pliki są walidowane po stronie bazy (typ, rozmiar, własny folder użytkownika); skrypty i HTML są zablokowane.
- Usunięcie posta lub wątku usuwa też jego pliki.
- W trybie demo pliki mają limit 400 KB, bo zapisują się w przeglądarce.

## 6. Boty (konta piszące przez API)
Admin tworzy bota w **Panel -> Boty**: wybiera nazwę i działy, do których wolno mu pisać
(puste = wszystkie). Bot dostaje odznakę **BOT**, a token widać tylko raz (w bazie jest jego skrót).
Wymaga wdrożenia z funkcjami Netlify i zmiennych `SUPABASE_*` (te same co dla Discorda).

Nowy wątek:
```
curl -X POST https://TWOJA-STRONA.netlify.app/.netlify/functions/bot-post \
  -H "Authorization: Bearer rlb_TWOJ_TOKEN" -H "Content-Type: application/json" \
  -d '{"category":"cs2","title":"Nowy patch CS2","body":"Opis zmian…"}'
```
Odpowiedź w wątku: `{"thread_id":"…","body":"…"}`. Z plikami: `"files":[{"name":"wynik.png","base64":"…"}]`
(do 5 plików, łącznie 4 MB; typ jest sprawdzany po rozszerzeniu i zawartości).
Zabezpieczenia: limit 10 wpisów/min na bota, bot nie pisze w zamkniętych wątkach ani w działach
spoza swojej listy, można go wyłączyć, zrotować token lub usunąć (znikają wtedy też jego wpisy).
Bota można podpiąć do GitHub Actions, własnego bota Discord albo skryptu w Pythonie.

## 7. Moderatorzy
- Panel moderacji (link „Panel” w menu) – zgłoszenia, ostrzeżenia, bany.
- Admin w zakładce **Użytkownicy** zmienia rangę na Moderator lub Admin.
- Albo nadaj rolę na Discordzie i użyj synchronizacji (krok 3).
  Uwaga: synchronizacja ustawia rangę wg ról Discorda, więc ręcznie nadanego moderatora
  zdegraduje do „Gracz”, jeśli nie ma roli na serwerze.

## Bezpieczeństwo
- Uprawnienia pilnuje baza (RLS + wyzwalacze), a nie sam interfejs: zwykły użytkownik nie
  nada sobie roli ani nie odbanuje konta, nawet przez konsolę przeglądarki.
- Treści są escapowane (brak XSS), linki mają `rel="noopener nofollow"`.
- Webhook, token bota Discord i tokeny botów forum są tylko w funkcjach Netlify/bazie (jako skrót), nigdy w przeglądarce.
- Włącz w Supabase potwierdzanie e-mail i CAPTCHA (Authentication), żeby ograniczyć boty.

## Struktura
```
public/            strona (index.html, css/, js/app.js, js/config.js)
netlify/functions/ discord-sync.js, discord-notify.js, bot-post.js, bot-admin.js
supabase/          schema.sql, 02_uploads_and_bots.sql
netlify.toml, .env.example
```


## 8. Automatyczne boty offline (tryb DEMO)
Po opublikowaniu nowego wątku w trybie DEMO trzy fikcyjne konta odpowiadają automatycznie:
- pierwszy bot po 5 sekundach,
- drugi po 10 sekundach,
- trzeci po 15 sekundach.
Każdy ma własny wygenerowany lokalnie awatar i dodaje małą grafikę reakcji SVG.
Teksty mają lekko uszczypliwy, gamingowy ton. Boty nie podszywają się pod prawdziwych użytkowników.
Wszystko zapisuje się w localStorage na tym urządzeniu. Działa bez internetu po lokalnym uruchomieniu
strony, ale tylko gdy strona jest otwarta — po zamknięciu przeglądarki JavaScript nie wykonuje timerów.
Ta symulacja działa wyłącznie bez Supabase (tryb DEMO); nie publikuje niczego na prawdziwym forum.
