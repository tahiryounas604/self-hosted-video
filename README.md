# Self-Hosted Video

A self-hosted video platform. Upload a video, it is transcoded to HLS
(720p + 480p) with ffmpeg, and you watch it in the browser with hls.js.
Metadata lives in SQLite. One shared token protects the API and the streams.

Part of the [Tytechlabs](https://www.linkedin.com/in/tahiryounas604) open-source
line. License: GPL-3.0.

## Features

- **Upload** — multipart upload endpoint (title + video file), max 1 GiB in v0.1
- **Transcode queue** — sequential FIFO ffmpeg jobs; source → HLS with two
  renditions (720p @ 2500k, 480p @ 1000k), 4-second segments, VOD playlists
- **Metadata** — SQLite (`videos` table: title, original filename, duration,
  status `uploaded → processing → ready | failed`, error, timestamps)
- **REST API** — `POST /api/videos`, `GET /api/videos`, `GET /api/videos/:id`,
  `DELETE /api/videos/:id`, `GET /api/health`
- **HLS serving** — `GET /hls/:id/master.m3u8` plus variant playlists and
  `.ts` segments, with path-traversal protection
- **Token auth** — `Authorization: Bearer <token>` on API routes;
  `?token=` query parameter on HLS URLs (video players cannot set headers)
- **React frontend** — token sign-in, upload form, video library with live
  transcode status, player page using hls.js (native HLS fallback on Safari).
  The backend serves the built frontend from `/` when `frontend/dist` exists.

## Requirements

- Node.js 24+ (uses the built-in `node:sqlite` — no database dependency)
- ffmpeg + ffprobe on `PATH`
- The backend has **zero npm dependencies**; the frontend needs `npm install`
  (React 18, Vite 6, hls.js).

## Install

```bash
git clone <this-repo>
cd self-hosted-video

# Backend — nothing to install (zero dependencies)
# Frontend
cd frontend && npm install && npm run build && cd ..
```

## Usage

```bash
# Start the backend (serves API + HLS + the built frontend on :3000)
VIDEO_TOKEN='choose-a-long-random-token' PORT=3000 DATA_DIR=./data \
  node backend/src/server.js
```

If `VIDEO_TOKEN` is not set, a random token is generated and printed at
startup. Open http://localhost:3000, paste the token, upload a video, and
play it once its status turns **Ready**.

### API examples

```bash
TOKEN='your-token'
BASE=http://localhost:3000

# Upload
curl -X POST $BASE/api/videos -H "Authorization: Bearer $TOKEN" \
  -F "title=My video" -F "video=@movie.mp4;type=video/mp4"

# List / status / delete
curl $BASE/api/videos -H "Authorization: Bearer $TOKEN"
curl $BASE/api/videos/<id> -H "Authorization: Bearer $TOKEN"
curl -X DELETE $BASE/api/videos/<id> -H "Authorization: Bearer $TOKEN"

# Stream (token as query param — required by video players)
curl "$BASE/hls/<id>/master.m3u8?token=$TOKEN"
```

### Development

```bash
# Frontend dev server (proxies /api and /hls to the backend on :3000)
cd frontend && npm run dev   # http://localhost:5173

# Backend tests
cd backend && npm test
```

## Data layout

```
data/
  videos.sqlite        # SQLite metadata
  uploads/<id>/original.<ext>
  hls/<id>/master.m3u8
  hls/<id>/720p/{playlist.m3u8, segNNN.ts}
  hls/<id>/480p/{playlist.m3u8, segNNN.ts}
```

## Tests

Backend tests (`backend/test/server.test.js`, Node's built-in test runner)
boot the real server, upload a real ffmpeg-generated 2-second sample video,
and verify the whole flow against real ffmpeg output:

- health endpoint, auth enforcement (no token / wrong token → 401 on every
  route, `?token=` accepted for HLS), upload validation (400/404)
- upload flow (201 + metadata), transcode to `ready` with real duration (~2 s)
- HLS correctness (master lists both renditions with bandwidth/resolution,
  variant playlists are VOD with `#EXT-X-ENDLIST`, every listed segment
  exists, is non-empty, and serves as `video/MP2T`)
- path-traversal rejection, list + delete (files removed from disk),
  non-video upload → `failed` with an error message

```bash
cd backend && npm test   # 11 tests
```

## Honest limits (v0.1)

- **Single shared token, no users or roles.** Anyone with the token can upload,
  list, and delete. Fine for personal self-hosting; not multi-user.
- **One transcode worker, no resume.** Jobs run one at a time in-process;
  restarting the server drops queued jobs (videos stuck in `uploaded` /
  `processing` are not re-queued automatically).
- **Uploads are buffered in memory** (1 GiB cap) — very large files need the
  cap raised or a streaming upload implementation.
- **No thumbnails, no search, no subtitles, no comments, no adaptive
  bitrate beyond the two fixed renditions.** No view counts or analytics.
- **HLS only.** No DASH, no direct MP4 progressive playback, no download
  endpoint (the original file is kept on disk under `uploads/`).
- **No HTTPS/TLS built in** — run behind a reverse proxy (Caddy/nginx) for
  public use.
- **React UI was built and served, but not exercised in a real browser here**
  (no browser available in this environment). The build (`vite build`) passes
  and the backend serves it; playback in a real browser is untested.
- **The frontend bundle is ~750 kB** (hls.js) — Vite warns about the chunk
  size; code-splitting is a future improvement.
- **SQLite + local disk only** — no object storage, no clustering, no CDN.

## License

GPL-3.0 — see [LICENSE](LICENSE).

Built by Tahir Younas — Penetration Tester & Application Security Engineer — https://www.linkedin.com/in/tahiryounas604 | Tytechlabs
