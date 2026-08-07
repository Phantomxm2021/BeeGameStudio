# Bee Game Studio landing page

The Bee Game Studio landing page is a Vite + React app with four localized
experiences (简体中文, English, 日本語, 한국어) and an optional Supabase-backed
waitlist form.

## Prerequisites

- Node.js `>=22.13.0`

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
3. Run `supabase/waitlist.sql` in the Supabase SQL Editor.
4. Install dependencies and start Vite:

   ```bash
   npm install
   npm run dev
   ```

The browser receives only the Supabase anonymous key. Never put a Supabase
service-role key in a Vite environment variable, `.env.local`, or any other
client-side file.

Before deployment, replace the `/images/idea-becomes-playable.jpg` value in
`index.html` with an absolute URL on the final production domain so social
crawlers can resolve the Open Graph image.

## Commands

- `npm install`: install dependencies
- `npm run dev`: start the local development server
- `npm test`: run the Vitest suite once
- `npm run build`: type-check and create a production build
- `npm run preview`: preview the production build locally

## Project structure

- `src/` contains the React app, localized messages, styles, and tests
- `public/` contains the favicon, social preview, and narrative images
- `supabase/waitlist.sql` contains the waitlist table and row-level security
- `vite.config.ts` configures Vite and Vitest
