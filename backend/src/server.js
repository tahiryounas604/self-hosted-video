// Self-hosted video platform backend — HTTP server + REST API.
// Zero external dependencies: node:http, node:sqlite, ffmpeg via child_process.
//
// API (all routes except GET /api/health require the token):
//   GET    /api/health                 -> { ok: true }
//   POST   /api/videos                 multipart: title (optional), video (file)
//   GET    /api/videos                 list all videos
//   GET    /api/videos/:id             one video
//   DELETE /api/videos/:id             delete video + files
//   GET    /hls/:id/master.m3u8        HLS master playlist
//   GET    /hls/:id/:rendition/:file   HLS variant playlist / .ts segment
//
// Auth: `Authorization: Bearer <token>` header, or `?token=<token>` query
// (needed by <video>/hls.js, which cannot set custom headers on segment fetches).
// Token comes from the VIDEO_TOKEN env var, or is generated at startup.
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, insertVideo, getVideo, listVideos, updateVideo, deleteVideo } from './db.js';
import { parseMultipart } from './multipart.js';
import { TranscodeQueue } from './transcode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/MP2T',
  '.mp4': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function resolveToken(configToken) {
  if (configToken) return configToken;
  if (process.env.VIDEO_TOKEN) return process.env.VIDEO_TOKEN;
  return randomBytes(24).toString('hex');
}

function safeExt(filename) {
  const ext = path.extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(ext) ? ext : '.mp4';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dbPath = options.dbPath || path.join(dataDir, 'videos.sqlite');
  const token = resolveToken(options.token);
  const uploadsDir = path.join(dataDir, 'uploads');
  const hlsDir = path.join(dataDir, 'hls');
  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');

  // The data directory must exist before SQLite can create the database file.
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(dbPath);

  const queue = new TranscodeQueue({
    onJobStart: (videoId) => updateVideo(db, videoId, { status: 'processing' }),
    onJobDone: (videoId, result) => {
      if (result.ok) {
        updateVideo(db, videoId, { status: 'ready', duration_seconds: result.duration, error: null });
      } else {
        updateVideo(db, videoId, { status: 'failed', error: result.error });
      }
    },
  });

  function isAuthorized(req, url) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      return timingSafeEqual(header.slice(7), token);
    }
    const queryToken = url.searchParams.get('token');
    if (queryToken) return timingSafeEqual(queryToken, token);
    return false;
  }

  function timingSafeEqual(a, b) {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return ha.equals(hb);
  }

  async function handleUpload(req, res) {
    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      return sendJson(res, err.code === 'TOO_LARGE' ? 413 : 400, { error: err.message });
    }
    const file = parsed.files.find((f) => f.fieldName === 'video');
    if (!file || file.data.length === 0) {
      return sendJson(res, 400, { error: 'No video file uploaded (field name "video" required)' });
    }
    const title = (parsed.fields.title || '').trim() || file.filename || 'Untitled video';
    const id = randomUUID();
    const ext = safeExt(file.filename);
    const videoDir = path.join(uploadsDir, id);
    const originalPath = path.join(videoDir, `original${ext}`);
    await fs.mkdir(videoDir, { recursive: true });
    await fs.writeFile(originalPath, file.data);

    const video = insertVideo(db, {
      id,
      title,
      original_filename: file.filename,
      duration_seconds: null,
      status: 'uploaded',
    });
    queue.enqueue({ videoId: id, inputPath: originalPath, hlsDir: path.join(hlsDir, id) });
    return sendJson(res, 201, video);
  }

  async function handleDelete(req, res, id) {
    const video = getVideo(db, id);
    if (!video) return sendJson(res, 404, { error: 'Video not found' });
    deleteVideo(db, id);
    await fs.rm(path.join(uploadsDir, id), { recursive: true, force: true });
    await fs.rm(path.join(hlsDir, id), { recursive: true, force: true });
    res.writeHead(204);
    res.end();
  }

  async function serveHls(req, res, url) {
    // /hls/:id/master.m3u8 or /hls/:id/:rendition/<file>
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'hls') return sendJson(res, 404, { error: 'Not found' });
    const id = parts[1];
    const rest = parts.slice(2);
    if (rest.some((p) => p === '..' || p.includes('/') || p.includes('\\'))) {
      return sendJson(res, 400, { error: 'Invalid path' });
    }
    const filePath = path.resolve(hlsDir, id, ...rest);
    if (!filePath.startsWith(path.resolve(hlsDir, id) + path.sep)) {
      return sendJson(res, 400, { error: 'Invalid path' });
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600',
      });
      (await fs.open(filePath)).createReadStream().pipe(res);
    } catch {
      return sendJson(res, 404, { error: 'Not found' });
    }
  }

  async function serveFrontend(req, res, url) {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    if (rel.includes('..')) return sendJson(res, 400, { error: 'Invalid path' });
    const filePath = path.join(frontendDist, rel);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Content-Length': stat.size });
      (await fs.open(filePath)).createReadStream().pipe(res);
    } catch {
      // SPA fallback: unknown paths serve index.html if it exists.
      try {
        const indexPath = path.join(frontendDist, 'index.html');
        const stat = await fs.stat(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': stat.size });
        (await fs.open(indexPath)).createReadStream().pipe(res);
      } catch {
        return sendJson(res, 200, { ok: true, service: 'self-hosted-video', version: '0.1.0', frontend: 'not built — run `npm run build` in frontend/' });
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, service: 'self-hosted-video', version: '0.1.0' });
      }

      // Everything else (API + HLS) requires the token.
      if (pathname.startsWith('/api/') || pathname.startsWith('/hls/')) {
        if (!isAuthorized(req, url)) {
          return sendJson(res, 401, { error: 'Unauthorized: valid Bearer token required' });
        }
      }

      if (pathname === '/api/videos' && req.method === 'POST') return handleUpload(req, res);
      if (pathname === '/api/videos' && req.method === 'GET') return sendJson(res, 200, listVideos(db));

      const videoMatch = pathname.match(/^\/api\/videos\/([A-Za-z0-9-]+)$/);
      if (videoMatch) {
        if (req.method === 'GET') {
          const video = getVideo(db, videoMatch[1]);
          return video ? sendJson(res, 200, video) : sendJson(res, 404, { error: 'Video not found' });
        }
        if (req.method === 'DELETE') return handleDelete(req, res, videoMatch[1]);
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (pathname.startsWith('/hls/') && req.method === 'GET') return serveHls(req, res, url);

      if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api/'))) {
        return serveFrontend(req, res, url);
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  async function start(port = Number(process.env.PORT || 3000)) {
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(hlsDir, { recursive: true });
    await new Promise((resolve) => server.listen(port, resolve));
    return server.address().port;
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => {
        db.close();
        resolve();
      });
    });
  }

  return { server, db, queue, token, dataDir, start, close };
}

// CLI entry point: `node src/server.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.start(port).then((actualPort) => {
    console.log(`self-hosted-video v0.1.0 listening on http://localhost:${actualPort}`);
    console.log(`Data dir: ${app.dataDir}`);
    if (!process.env.VIDEO_TOKEN) {
      console.log(`VIDEO_TOKEN was not set — generated token: ${app.token}`);
      console.log('Set VIDEO_TOKEN env var to use a fixed token.');
    }
  });
}
