# WaitWell

A companion app for people stuck on an NHS waiting list. It turns a long, silent wait into something you can track and prepare for, instead of something that just happens to you.

**Live app: [waitwell.netlify.app](https://waitwell.netlify.app)**

> WaitWell is an independent project. It is not affiliated with or endorsed by the NHS. It provides information and self-tracking tools, never medical advice.

---

## What it does

**Track the wait.** Daily logging for pain, mobility, mood and sleep, drawn as trends over weeks rather than a single number on a single day.

**Prepare for the appointment.** An AI coach reads your own logs and writes a summary you can print or show a clinician, so the ten minutes you finally get are spent on the right things.

**Understand the post.** Photograph a hospital letter and get it explained in plain English, with the jargon unpacked.

**Stay pointed at official guidance.** Links go to verified NHS sources rather than forums.

**Installs like an app.** A progressive web app, so it adds to the home screen from the browser with nothing to download and works on a weak connection.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Progressive web app |
| Backend and auth | Supabase (PostgreSQL, row level security) |
| Serverless logic | Supabase Edge Functions |
| Language model | Google Gemini |
| Payments | Stripe, freemium |
| Hosting | Netlify |

---

## Running it locally

```bash
git clone https://github.com/YOUR-USERNAME/waitwell.git
cd waitwell
npm install
cp .env.example .env    # then fill in your own keys
npm run dev
```

### Environment variables

Copy `.env.example` to `.env` and provide your own values. Never commit `.env`.

| Variable | What it is |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key (safe in the client, protected by row level security) |
| `GEMINI_API_KEY` | Gemini key — **server side only**, set as a Supabase Edge Function secret, never as a `VITE_` variable |
| `STRIPE_SECRET_KEY` | Stripe secret key — **server side only** |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key, safe in the client |

Anything prefixed `VITE_` is compiled into the JavaScript bundle and is readable by anyone who opens the app. Keys that must stay secret belong in Edge Function secrets, not in the frontend.

---

## Roadmap

- [ ] Export a full history as PDF for an appointment
- [ ] Reminders ahead of a logged appointment date
- [ ] Wider condition coverage in the guidance links
- [ ] Accessibility pass against WCAG 2.2 AA

---

## Licence

MIT. See [LICENSE](LICENSE).

---

Built by [Damon Dynamics](https://damondynamics.co.uk) · ceo@damondynamics.co.uk
