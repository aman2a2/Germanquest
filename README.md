# wortweise — German vocabulary trainer

A mobile-first React + TypeScript vocabulary app starter with CSV import, multiple-choice quizzes, flashcards, daily practice stats, and optional Supabase email-link authentication/cloud sync.

## Requirements

- Node.js 20+ recommended
- A Supabase project for cloud accounts/sync (optional for local preview)

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL on your computer or phone on the same Wi-Fi network. Without Supabase environment variables, the app runs in local preview mode and saves data in the current browser's local storage.

## Enable cloud sync

1. Create a project at https://supabase.com.
2. In Supabase → SQL Editor, run `supabase/schema.sql`.
3. In Supabase → Authentication → URL Configuration, set the Site URL to your deployed app URL. Add local and production URLs to Redirect URLs as needed.
4. Copy `.env.example` to `.env.local` and fill in the project URL and anon/publishable key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

5. Restart `npm run dev`. Sign in using the email link on the Account & cloud sync panel.

Use only the Supabase anon/publishable key in this frontend. Never put a service-role key in a client app. Review and adapt RLS policies before production use.

## Import vocabulary

In the Vocabulary screen, click **CSV template** to download a sample. CSV headers supported:

- Required: `german`, `english` (also recognizes `word`/`deutsch` and `translation`/`meaning`)
- Optional: `topic`, `type`, `plural`, `example`, `exampleTranslation`

German and English are required. Existing German terms are skipped as duplicates. Export creates a full CSV backup.

## Learning behavior in this MVP

- Multiple-choice quiz records each answer.
- Flashcards let you mark a word as known or needing practice.
- Review intervals grow after correct recalls (1, 3, 7, 14, then 30 days); incorrect recalls become due again immediately.
- A word is counted as mastered after four consecutive correct ratings in the current review counter.
- Daily goal and learning history are stored in the browser in this starter. Vocabulary and per-word review state have Supabase table support.

## Important MVP limitations

- This is a starter scaffold, not a deployed service. You need to configure Supabase and deploy the frontend yourself.
- Daily stats, streaks, and goal settings are currently device-local. Cloud sync currently covers vocabulary and word review records; a production-ready version should add cloud-backed daily activity and conflict-safe synchronization.
- The included starter set is a curated subset of terms and example sentences from the supplied OCR text, not a guaranteed complete or corrected transcription of the entire source. Check the book against the imported list, especially plural forms and OCR-sensitive entries.
- The app is designed as a responsive web app; installable PWA/offline service-worker support can be added next.
