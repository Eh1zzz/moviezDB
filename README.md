# MoviezDB

A fast, **fully static** movie & TV discovery app powered by [TMDB](https://www.themoviedb.org/).
Browse trending movies & series, search across movies/TV/people, view rich detail
pages, **play official trailers**, see **where to watch** (legal streaming
providers via JustWatch), and keep a personal **watchlist & favourites** — all in
the browser, no server required.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Trending movies & TV** | Sortable feeds (Trending, Popular, Top Rated, Now Playing / On Air…) with infinite "Load more" |
| **Search** | Live multi-search (movies + TV + people) with keyboard nav (`/` or `⌘K`) + a full results page |
| **Detail pages** | Hero, cast & crew, stats (budget/revenue/profit, ratings…), similar titles |
| **▶ Play Trailer** | Plays the official YouTube trailer in a fullscreen modal |
| **Where to Watch** | Real streaming/rent/buy availability for the viewer's region (TMDB + JustWatch) with deep links |
| **Watchlist & Favourites** | ♥ / 🔖 on every card, saved in `localStorage`, with a management page |
| **Dark / Light theme** | Animated toggle, persisted, no flash on load |
| **12 languages** | Switches TMDB content language site-wide |
| **Responsive** | Mobile hamburger nav, full-width mobile search, adaptive grids |

---

## 🚀 Setup

### 1 — Add your TMDB API key
The app needs a **free** TMDB API key (v3).

1. Create an account → https://www.themoviedb.org/signup
2. Request an API key → https://www.themoviedb.org/settings/api  (free, instant)
3. Copy `frontend/config.example.js` to `frontend/config.js`
4. Paste your key:

   ```js
   // frontend/config.js
   window.MOVIEZDB_CONFIG = {
     TMDB_KEY: 'paste-your-key-here',
     DEFAULT_LANG: 'en',
   };
   ```

> `config.js` is **gitignored** — your key never gets committed. The whole app
> reads the key from this one file. (TMDB v3 keys are visible in the browser's
> network requests by design; if you ever need it hidden, put a tiny serverless
> proxy in front — but it's optional and not required.)

### 2 — Run it
It's just static files — serve the `frontend/` folder with anything:

```bash
npm start                         # → http://localhost:3000 (uses `serve`)
# or
python -m http.server 8000 --directory frontend
# or: VS Code "Live Server" → right-click frontend/index.html → Open with Live Server
```

> Open it through a server (not `file://`) so the config + fetches work.

---

## 📦 Deploy (free static hosting)

Point any static host at the **`frontend/`** folder and add your `config.js`:

- **Netlify / Vercel:** set the publish/output directory to `frontend`. Add a
  `config.js` (or generate it from an env var at build time).
- **GitHub Pages / Cloudflare Pages:** publish the `frontend/` directory.

There is **no backend** — nothing to provision, scale, or pay for.

---

## 🗂 Project structure

```
moviezDB/
├── frontend/
│   ├── index.html         — Trending / popular movies
│   ├── series.html        — TV series
│   ├── details.html       — Movie / series detail + Play Trailer + Where to Watch
│   ├── genre.html         — Browse by genre
│   ├── person.html        — Actor / crew profile
│   ├── search.html        — Full search results
│   ├── watchlist.html     — Watchlist & favourites
│   ├── shared.css         — Design system (dark + light, all shared components)
│   ├── shared.js          — window.App: Nav, Search, Profile, Theme, Lang,
│   │                        Trailer player, Toasts, Store (watchlist/favourites)
│   ├── config.example.js  — Copy → config.js, add your TMDB key
│   └── favicon.svg
├── package.json           — convenience `npm start` (static server)
└── README.md
```

---

## ⚖️ Attribution & legal

- This product uses the **TMDB API** but is not endorsed or certified by TMDB.
  Per TMDB's terms, attribute them in your footer/about when deploying publicly.
- "Where to Watch" availability is provided by **JustWatch** (via TMDB) — keep
  the on-page JustWatch attribution.
- Trailers are embedded from **YouTube**.
