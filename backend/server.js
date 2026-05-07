/**
 * MoviezDB — Node.js Backend
 * Bridges the Python moviebox-api CLI to the frontend via REST API.
 *
 * Architecture:
 *   POST /api/stream/resolve   → runs `moviebox` CLI, returns direct video URL
 *   GET  /api/stream/proxy     → optional byte-range proxy for CORS-locked URLs
 *   GET  /api/health           → uptime check
 *
 * Prerequisites:
 *   pip install "moviebox-api[cli]"   (Python 3.9+)
 *   node server.js
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { spawn }  = require('child_process');
const https      = require('https');
const http       = require('http');
const path       = require('path');
const os         = require('os');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── CORS ─────────────────────────────────────────────────────────────────── */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}));
app.use(express.json({ limit: '16kb' }));

/* ── RATE LIMITING ────────────────────────────────────────────────────────── */
const resolveLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 15,               // 15 resolve calls per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

/* ── UTILITIES ────────────────────────────────────────────────────────────── */

/**
 * Run the moviebox CLI and capture JSON/text output.
 * Returns a Promise<{ stdout, stderr }>.
 */
function runMoviebox(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    // Detect the CLI command: prefer `moviebox`, fall back to `python -m moviebox_api`
    const cmd  = process.platform === 'win32' ? 'moviebox.exe' : 'moviebox';
    const proc = spawn(cmd, args, {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', err => {
      // Try python -m fallback
      if (err.code === 'ENOENT') {
        const fallback = spawn('python', ['-m', 'moviebox_api', ...args], {
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
          timeout: timeoutMs,
        });
        let fo = '', fe = '';
        fallback.stdout.on('data', d => { fo += d.toString(); });
        fallback.stderr.on('data', d => { fe += d.toString(); });
        fallback.on('close', code => {
          if (code !== 0) return reject(new Error(fe || `CLI exited ${code}`));
          resolve({ stdout: fo, stderr: fe });
        });
        fallback.on('error', e => reject(new Error(`CLI not found. Install with: pip install "moviebox-api[cli]" — ${e.message}`)));
      } else {
        reject(err);
      }
    });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `CLI exited with code ${code}`));
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Parse the video URL out of moviebox CLI output.
 * The CLI prints a JSON block or a plain URL line.
 */
function extractVideoUrl(output) {
  // Try to find a JSON block first
  const jsonMatch = output.match(/\{[\s\S]*"url"\s*:\s*"([^"]+)"[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[1];

  // Fall back: find the first https line that looks like a video URL
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('https://') && (
      line.includes('.mp4') || line.includes('.m3u8') ||
      line.includes('stream') || line.includes('video')
    )) return line;
  }
  return null;
}

/**
 * Build the CLI args for movie resolution.
 * Uses moviebox v2 (most reliable provider).
 */
function buildArgs(type, title, season, episode, quality) {
  const baseQuality = quality || '1080p';
  if (type === 'movie') {
    return ['v2', 'download-movie', title,
      '--quality', baseQuality,
      '--auto-mode', '--output', '-',   // output to stdout = dry-run / URL-only
      '--url-only',
    ];
  } else {
    return ['v2', 'download-series', title,
      '-s', String(season || 1),
      '-e', String(episode || 1),
      '--quality', baseQuality,
      '--auto-mode', '--url-only',
    ];
  }
}

/* ── ROUTES ───────────────────────────────────────────────────────────────── */

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/**
 * POST /api/stream/resolve
 * Body: { type, title, tmdbId, season?, episode?, quality? }
 * Returns: { success, url, quality, provider }
 */
app.post('/api/stream/resolve', resolveLimiter, async (req, res) => {
  const { type, title, season, episode, quality } = req.body;

  if (!type || !title) {
    return res.status(400).json({ success: false, error: 'Missing required fields: type, title' });
  }
  if (!['movie', 'tv'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be "movie" or "tv"' });
  }
  if (type === 'tv' && (!season || !episode)) {
    return res.status(400).json({ success: false, error: 'season and episode are required for tv type' });
  }

  try {
    const args = buildArgs(type, title, season, episode, quality);
    console.log(`[resolve] Spawning: moviebox ${args.join(' ')}`);

    const { stdout } = await runMoviebox(args, 90_000);
    const url = extractVideoUrl(stdout);

    if (!url) {
      console.warn('[resolve] No URL found in output:\n', stdout);
      return res.status(404).json({
        success: false,
        error: 'Could not find a stream URL for this title. The title may not be available.',
      });
    }

    console.log(`[resolve] Found URL: ${url.slice(0, 80)}…`);
    res.json({
      success:  true,
      url,
      quality:  quality || '1080p',
      provider: 'moviebox-v2',
    });
  } catch (err) {
    console.error('[resolve] Error:', err.message);
    const isNotFound = err.message.toLowerCase().includes('not found') ||
                       err.message.toLowerCase().includes('no result');
    res.status(isNotFound ? 404 : 500).json({
      success: false,
      error: isNotFound
        ? 'Title not found on MovieBox.'
        : `Stream resolution failed: ${err.message}`,
    });
  }
});

/**
 * GET /api/stream/proxy?url=<encoded-video-url>
 * Byte-range aware proxy — used when the video CDN blocks browser CORS.
 * Only proxies whitelisted CDN hostnames to prevent abuse.
 */
const ALLOWED_PROXY_HOSTS = new Set([
  'aoneroom.com', 'h5.aoneroom.com',
  'moviebox.ph', 'api.moviebox.ph',
  'vod.moviebox.ph', 'cdn.moviebox.ph',
  // add others as needed
]);

app.get('/api/stream/proxy', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url parameter' });

  let parsedUrl;
  try { parsedUrl = new URL(rawUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const hostname = parsedUrl.hostname;
  const isAllowed = [...ALLOWED_PROXY_HOSTS].some(h => hostname === h || hostname.endsWith('.' + h));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Proxy not allowed for this host' });
  }

  const proto = parsedUrl.protocol === 'https:' ? https : http;
  const upstreamReq = proto.get(rawUrl, {
    headers: {
      'Range':       req.headers['range'] || '',
      'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':     `https://${hostname}/`,
    },
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode, {
      'Content-Type':   upstreamRes.headers['content-type']  || 'video/mp4',
      'Content-Length': upstreamRes.headers['content-length'] || '',
      'Content-Range':  upstreamRes.headers['content-range']  || '',
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'no-cache',
    });
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: 'Proxy upstream error' });
    console.error('[proxy] Upstream error:', err.message);
  });
  req.on('close', () => upstreamReq.destroy());
});

/* ── STATIC FRONTEND (optional: serve frontend from same origin) ─────────── */
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
if (require('fs').existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
}

/* ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

/* ── START ────────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n🎬  MoviezDB backend running on http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/api/health`);
  console.log(`    Stream: POST http://localhost:${PORT}/api/stream/resolve\n`);
});

module.exports = app;
