# MoviezDB

A full-stack movie & TV discovery app powered by TMDB, with streaming and download
capabilities via the **moviebox-api** Python CLI bridged through a Node.js backend.

---

## Project Structure

```
MoviezDB/
├── frontend/               ← Static HTML/CSS/JS (open in browser or serve statically)
│   ├── index.html          — Trending Movies
│   ├── series.html         — TV Series
│   ├── details.html        — Movie / Series detail + Watch Now
│   ├── genre.html          — Browse by genre
│   ├── person.html         — Actor / crew profile
│   ├── search.html         — Full search results
│   ├── watchlist.html      — Saved watchlist & favourites
│   ├── shared.css          — Design system (dark + light theme, all components)
│   ├── shared.js           — Shared modules: Nav, Search, Profile, Theme,
│   │                         Language switcher, Stream player, Toasts
│   ├── favicon.svg         — Brand favicon (film reel + play icon)
│   └── assets/             — Fallback thumbnails
│
└── backend/                ← Node.js + Express API server
    ├── server.js           — Main server: stream resolve + proxy endpoints
    ├── package.json
    └── .env.example        — Environment variable template
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| Python | ≥ 3.9 | https://python.org |
| moviebox-api | latest | `pip install "moviebox-api[cli]"` |

---

## Setup

### 1 — Install moviebox-api (Python)

```bash
pip install "moviebox-api[cli]"

# Verify the CLI is available:
moviebox --version
# or: python -m moviebox_api --version
```

### 2 — Install backend dependencies

```bash
cd backend
npm install
```

### 3 — Configure environment

```bash
cp .env.example .env
# Edit .env if you need to change PORT or ALLOWED_ORIGINS
```

### 4 — Start the backend

```bash
# Production:
npm start          # runs on http://localhost:3001

# Development (auto-restarts on change):
npm run dev
```

### 5 — Open the frontend

Use any static file server pointed at the `frontend/` folder:

```bash
# VS Code: Install "Live Server" extension → right-click index.html → Open with Live Server
# or:
npx serve frontend   # serves on http://localhost:3000
# or:
python -m http.server 5500 --directory frontend
```

> **Important:** The frontend's `App.Stream` module sends requests to
> `http://localhost:3001` by default. To change this, set
> `window.MOVIEZDB_BACKEND = 'https://your-backend.com'` before `shared.js` loads,
> or edit the `BACKEND_URL` constant at the top of `shared.js`.

---

## Features

### Frontend
| Feature | Description |
|---------|-------------|
| **Dark / Light mode** | Smooth animated toggle, persisted in `localStorage` |
| **Language switcher** | 12 languages — English, French, Spanish, German, Portuguese, Italian, Japanese, Korean, Chinese, Arabic, Hindi, Russian. Changes TMDB API content language site-wide. |
| **Search** | Live multi-type search (movies + TV + people) with keyboard navigation (`⌘K` / `/`). Full results page with type filter tabs. |
| **Profile card** | Display name (editable), watchlist & favourites counters, quick links |
| **Watchlist / Favourites** | Persisted in `localStorage`. ♥ and 🔖 buttons on every card. Dedicated management page. |
| **Watch Now** | Stream any movie or TV episode directly in-browser via the backend |
| **Episode picker** | Season + episode dropdowns appear for TV series |
| **Similar content** | "More Like This" horizontal scroll row on every details page |
| **Favicon** | SVG film-reel icon in brand gold |
| **Responsive** | Mobile hamburger menu, adaptive grids, touch-friendly |

### Backend API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Uptime check → `{ status: "ok" }` |
| `/api/stream/resolve` | POST | Resolve a stream URL via moviebox CLI |
| `/api/stream/proxy` | GET | Byte-range proxy for CORS-locked CDN URLs |

#### `POST /api/stream/resolve`

**Request body:**
```json
{
  "type":    "movie",        // "movie" or "tv"
  "title":   "Inception",   // title as it would appear in MovieBox
  "season":  1,             // TV only
  "episode": 1,             // TV only
  "quality": "1080p"        // "480p" | "720p" | "1080p"
}
```

**Success response:**
```json
{
  "success":  true,
  "url":      "https://cdn.moviebox.ph/...",
  "quality":  "1080p",
  "provider": "moviebox-v2"
}
```

**Error response:**
```json
{
  "success": false,
  "error":   "Title not found on MovieBox."
}
```

---

## Architecture: How Streaming Works

```
Browser                   Node.js (localhost:3001)         Python CLI
  │                               │                              │
  │── POST /api/stream/resolve ──►│                              │
  │      { type, title, ... }     │── spawn: moviebox v2 ───────►│
  │                               │   download-movie "Inception" │
  │                               │   --url-only                 │
  │                               │◄─ stdout: https://cdn.../... │
  │◄── { success:true, url } ─────│                              │
  │                               │
  │── <video src="url"> ──────────────────────────────────────►(CDN)
  │   (direct browser ↔ CDN)
  │
  │── GET /api/stream/proxy?url=  (only if CDN blocks CORS)
  │◄── piped video bytes ─────────────────────────────────────►(CDN)
```

The Node.js server spawns `moviebox` (or `python -m moviebox_api` as fallback),
captures the direct MP4/HLS URL from stdout, and returns it to the browser.
The browser's `<video>` element then connects directly to the CDN — the backend
only proxies if the CDN enforces CORS restrictions.

---

## Deployment

### Backend — Render.com (free tier)

1. Push `backend/` to a GitHub repo
2. Create a new **Web Service** on Render → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables: `PORT`, `ALLOWED_ORIGINS`
6. **Important:** Also install Python + moviebox-api in the build step:
   ```
   pip install "moviebox-api[cli]" && npm install
   ```

### Frontend — Netlify / Vercel / GitHub Pages

Drag-and-drop the `frontend/` folder to Netlify, or push to GitHub and enable
GitHub Pages. Set `window.MOVIEZDB_BACKEND` in each HTML file to point to your
deployed backend URL before `shared.js` loads.

---

## Rate Limiting

The `/api/stream/resolve` endpoint is rate-limited to **15 requests per minute per IP**
to prevent abuse. Adjust `max` in `server.js` if needed.

---

## Legal Note

`moviebox-api` accesses content from third-party services. Ensure you comply with
the terms of service of those services and your local copyright laws before use.
This project is intended for educational and personal use only.
