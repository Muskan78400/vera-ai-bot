# Vera AI Bot — React + Node + MongoDB

Full stack: **Express** backend, **MongoDB** for persistence (optional — falls back to
in-memory automatically if not configured), **React** (Vite) dashboard frontend.

## What changed from the original starter

- `src/db.js` + `src/models/Context.js` + `src/models/Conversation.js` — MongoDB (Mongoose)
  layer. If `MONGODB_URI` is set in `.env`, all context and conversation data persists to
  MongoDB. If it's left empty, the server automatically falls back to an in-memory store —
  same behavior, just no persistence across restarts. Nothing else changes either way.
- `src/store.js` — rewritten as fully async, backend-agnostic (Mongo or in-memory).
- `src/server.js` — all routes updated to `await` the store; connects to MongoDB on boot;
  serves the built React app from `client/dist`.
- `client/` — a full React (Vite) app replacing the old plain HTML/JS dashboard. Same
  functionality (metrics, live activity console, composition sandbox), now as React
  components with proper state management.

## Additional features (round 2)

- **Deterministic fallback composer** (`src/services/deterministicFallback.js`) — when the
  Gemini/OpenAI call fails (timeout, bad key, malformed response), the bot no longer falls
  back to a single generic placeholder ("Just checking in..."). Instead it has a dedicated,
  category-aware template per trigger kind that pulls real facts (offers, slots, digest
  citations, performance deltas) straight out of the contexts — same principle as the main
  LLM composer, just rule-based. Keeps specificity reasonable even when the LLM path fails.
- **Digest item resolution by ID** (`src/services/composer.js`) — instead of handing the LLM
  the entire category digest array and hoping it cites the right item, the composer now
  resolves the exact digest item the trigger refers to (checking `top_item_id`,
  `digest_item_id`, `item_id` payload keys) *before* building the prompt, and sends only
  that one item as `relevantDigestItem`. Removes the "cited the wrong research paper" risk.
- **Conversation Viewer** (`client/src/components/ConversationViewer.jsx` +
  `GET /api/conversations/:id`) — a dashboard panel showing the full turn-by-turn thread for
  any conversation as chat bubbles, instead of only raw activity logs.
- **Trigger Builder** (`client/src/components/TriggerBuilder.jsx` +
  `POST /api/manual-custom-trigger`) — a dashboard panel with a JSON textarea where you can
  hand-write a custom trigger (any kind, any payload) and compose against it directly for a
  selected merchant, without needing `judge_simulator.py` or a trigger that already exists
  in the store. Useful for testing edge cases (missing fields, unusual kinds).
- **Rate limiting** (`express-rate-limit` on all `/v1/*` routes) — 40 requests/sec per IP,
  a 4x buffer above the judge's documented 10 req/sec, so real traffic is never throttled
  but the endpoints are protected from runaway/abusive traffic. Verified: a 60-request burst
  in <1s gets exactly 40 through and 20 rejected with `429`.

## Additional features (round 3)

- **One-Click Warmup** (green button in the header + `POST /api/warmup`) — reads the bundled
  `dataset/` folder straight off disk on the server and pushes every category, merchant,
  customer, and trigger into the store in one call. No need to run `judge_simulator.py` or
  any external script just to get the dashboard populated — click the button, counts update
  immediately. Uses a timestamp as the context version, so pressing it again always succeeds
  (never rejected as a stale/duplicate push).
- **Message Quality Checker** (`client/src/utils/qualityCheck.js` +
  `client/src/components/QualityBadges.jsx`) — after any successful compose (in both the
  Sandbox and the Trigger Builder), the composed message is automatically checked against
  the challenge's hard constraints and shown as pass/fail badges: no URLs, single-CTA
  heuristic (question-mark count), no taboo/hype vocabulary (`guaranteed`, `100% safe`,
  `miracle`, etc.), non-empty/substantive length, and no self-reintroduction phrasing. This
  is a fast client-side sanity check while iterating — not a substitute for the real judge,
  but catches the most common constraint violations instantly.

## Additional demo merchants (round 4)

Added 2 more merchants to `dataset/merchants_seed.json` (+ matching customers/triggers in
`customers_seed.json` / `triggers_seed.json`) for a bigger, more recognizable demo pool:

- **Myntra Style Studio** (`m_011_myntra_salon_bangalore`) — salon category, Koramangala,
  Bangalore. Composes with the salons voice (warm, practical).
- **Amazon Xpress Pharmacy** (`m_012_amazon_pharmacy_mumbai`) — pharmacy category, Powai,
  Mumbai. Composes with the pharmacies voice (trustworthy, molecule-focused), leaning on
  Amazon's fast-delivery reputation for the offer framing.

**Worth knowing**: magicpin's Vera product is built around *local, physical-storefront*
merchants — dentists, salons, restaurants, gyms, pharmacies — each with a Google Business
Profile, a locality, and a fixed category voice/offer catalog. Amazon and Myntra are
national e-commerce platforms without that local-storefront shape, so these two entries are
demo-only placeholder names slotted into the two closest-fitting existing categories (salon
for Myntra's fashion/styling angle, pharmacy for Amazon's delivery-speed reputation) — not a
literal representation of how those companies would actually appear on magicpin. Verified
both compose correctly end-to-end (`/v1/tick`, sandbox, and the manual trigger builder all
tested against them).

## Setup (first time)

### 1. Install Node.js
[nodejs.org](https://nodejs.org) — LTS version, if you don't have it already.

### 2. Get a Gemini API key
1. Go to [aistudio.google.com](https://aistudio.google.com/)
2. Log in with Google → **Get API key** → **Create API Key**
3. Copy the key (looks like `AIzaSyB...`)

### 3. (Optional) Set up MongoDB
You can skip this — the app works fine without it (in-memory storage). If you want real
persistence:
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) → create a free
   cluster (M0 tier, no credit card needed)
2. **Database Access** → add a user with a password
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere, fine for a challenge/dev setup)
4. **Connect** → **Drivers** → copy the connection string, looks like:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/vera_bot`

### 4. Configure `.env`
Open `.env` in the project root:
```
PORT=8080
MONGODB_URI=                          <- paste your Atlas string here, or leave empty
GEMINI_API_KEY=                       <- paste your Gemini key here
LLM_PROVIDER=gemini
```

### 5. Install everything and build the dashboard
```bash
npm run setup
```
This runs: `npm install` (backend deps) → installs client deps → builds the React app into
`client/dist`. One command, does everything.

*(If you'd rather do it manually: `npm install`, then `npm run client:install`, then
`npm run client:build`.)*

### 6. Start the server
```bash
npm start
```
Wait for: `Server listening on port 8080`

### 7. Open the dashboard
Visit **http://localhost:8080** — you'll see the Vera Operator Dashboard (React app).
Metrics start at 0 until you push context data (via the judge simulator or manually).

## Running the scoring test

In a **second terminal**:
```bash
$env:GEMINI_API_KEY="your_actual_key_here"    # PowerShell
python judge_simulator.py
```
Open `judge_simulator.py` first and check/set `LLM_PROVIDER`, `LLM_API_KEY`, and `BOT_URL`
at the top if needed (see the file's own header comments).

Refresh the dashboard afterward — the metrics should show real numbers, and the **Activity
Console** panel will show a live feed of what happened.

## Developing the frontend (optional)

If you want to edit the React dashboard and see changes live without rebuilding each time:
```bash
npm run client:dev
```
This starts Vite's dev server on **http://localhost:5173** with API calls proxied to your
Express server on 8080 (`client/vite.config.js` handles this). Once you're done, run
`npm run client:build` again to produce the production build the Express server actually
serves.

## Deploying (for a public URL)

The Express server needs to be reachable publicly. Any Node hosting works — Render,
Railway, Fly.io, etc. Steps:
1. Push this whole folder to a git repo
2. On your hosting platform: connect the repo, set the build command to
   `npm run setup` and the start command to `npm start`
3. Set environment variables in the platform's dashboard: `GEMINI_API_KEY`, `MONGODB_URI`
   (if using Atlas), `LLM_PROVIDER=gemini`
4. Deploy, then confirm `https://<your-app>/v1/healthz` returns `200 OK`

## File structure

```
.
├── .env                    # your local config (API keys, Mongo URI) — not committed
├── .env.example             # template
├── package.json             # backend deps + setup/build scripts
├── src/
│   ├── server.js            # Express app, all 6 endpoints + dashboard API + rate limiting
│   ├── config.js            # env var loading
│   ├── db.js                 # MongoDB connect (with in-memory fallback)
│   ├── store.js              # async context/conversation store (Mongo or in-memory)
│   ├── models/
│   │   ├── Context.js        # Mongoose schema
│   │   └── Conversation.js   # Mongoose schema
│   └── services/
│       ├── composer.js       # message composition (LLM-driven, digest-ID resolution)
│       ├── deterministicFallback.js  # category-aware fallback when the LLM call fails
│       ├── llm.js             # Gemini/OpenAI client wrapper
│       └── replier.js         # multi-turn reply handling (auto-reply/opt-out/commitment)
├── client/                  # React (Vite) dashboard
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx           # dashboard shell — metrics, activity console, tabs
│   │   ├── components/
│   │   │   ├── ConversationViewer.jsx  # turn-by-turn chat thread viewer
│   │   │   └── TriggerBuilder.jsx      # custom trigger JSON composer
│   │   └── styles.css
│   ├── dist/                 # production build (pre-built, but rebuild after any edits)
│   └── vite.config.js
├── public/                  # legacy static fallback (kept for reference, not used once client/dist exists)
├── dataset/                  # challenge dataset (categories, merchant/customer/trigger seeds)
├── judge_simulator.py        # local scoring harness
├── challenge-brief.md
└── challenge-testing-brief.md
```

## Visual polish (round 5)

Design pass on the dashboard — no functionality changed, purely visual:

- **Icons throughout** (`lucide-react`) — metric cards, panel headers, buttons, and quality
  badges now use meaningful icons instead of plain colored shapes or unicode characters.
- **Colored metric cards** — each of the 4 metric cards (Categories, Merchants, Customers,
  Triggers) has its own accent color and icon, with a subtle top gradient bar and staggered
  fade-up entrance animation.
- **Live indicators** — the header logo has a slow breathing glow signaling an active agent;
  the "Live Feed" badge has a pulsing dot.
- **Monospace upgrade** — code/data displays (diagnostics JSON, trigger builder textarea)
  now use IBM Plex Mono instead of the generic Courier New fallback.
- **Chat avatars** — the Conversation Viewer's message bubbles now show a small avatar
  circle (Vera gets a gradient-filled circle, merchant/customer get a neutral one).
- **Animated tab switcher, spinners on all async buttons** (warmup, simulate, compose) so
  loading states are visually obvious instead of just disabled text.
- **Better empty states** — "no logs yet" now explains what to do next instead of a bare
  placeholder line.
- **Respects `prefers-reduced-motion`** — all animations are disabled automatically for
  users with that OS-level accessibility setting.

Verified visually with a real headless-browser screenshot pass (warmup → merchant select →
simulate composition → quality badges all render correctly end-to-end).

## Brand color pass (round 6)

Switched the dashboard's accent palette from a generic purple/cyan AI-console theme to
magicpin's actual brand colors:

| Token | Old | New | Where it shows |
|---|---|---|---|
| `--primary-glow` | `#6c5ce7` | `#5B2CE0` (magicpin purple) | Logo, borders, badges, brand elements |
| `--pink` | `#ef5777` | `#EC1279` (magicpin magenta) | Primary action buttons (mirrors magicpin.in's "Sign In/Up" button, which is pink on a purple nav bar) |
| `--cyan` | `#00d2d3` | `#14B8A6` (teal) | Secondary accent (categories metric card, chat elements) |

Primary CTA buttons (Simulate Composition, Compose, active tab) now use a purple→magenta
gradient, matching the real magicpin.in convention of a solid pink CTA button against a
purple background, rather than a generic single-purple AI-tool look. Verified by pixel-
sampling an actual rendered screenshot after the change (not just checking the CSS source).

## Light mode / day mode (round 7)

Flipped the dashboard from a dark glassmorphism theme to a light theme matching magicpin.in's
actual look — white/lavender background, dark indigo text, purple + magenta accents.

| Token | Dark mode value | Light mode value |
|---|---|---|
| Page background | `#090a15` → `#14162e` gradient | `#F4F1FF` → `#EDEAFB` gradient (light lavender) |
| Card background | `rgba(20,24,53,0.45)` translucent dark | `#FFFFFF` solid white |
| Main text | `#f1f2f6` (near-white) | `#1E1B3A` (deep indigo, not pure black) |
| Success/warning/danger | Bright pastel (`#2ed573`/`#ffa502`/`#ff4757`) | Darker, more saturated (`#16A34A`/`#D97706`/`#DC2626`) for adequate contrast against white |

**What this required, beyond just flipping the root variables**: every hardcoded
`rgba(255,255,255,...)` / `rgba(0,0,0,...)` overlay in the stylesheet had to be individually
re-checked — those were tuned for "lighten on dark" / "shadow on dark" and would either be
invisible or backwards on a light background. ~15 such spots were found and fixed (header
bar, card hover borders, scrollbars, log entry backgrounds, dropdowns, textareas, chat
bubbles). One real bug caught in the process: the metric card numbers (`.metric-val`) were
hardcoded to white text, which would have been invisible on the new white card background —
fixed to `var(--text-main)`.

Verified by pixel-sampling an actual rendered screenshot (not just reading the CSS): average
RGB across the page moved from the dark-mode range (~20–40) to (242, 239, 247), confirming a
true light background, with zero JS console errors on load.
