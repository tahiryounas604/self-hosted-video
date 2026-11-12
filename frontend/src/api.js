// Tiny API client for the self-hosted-video backend.
// The token is kept in localStorage (single-user, self-hosted v0.1).
const TOKEN_KEY = 'shv-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function headers() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function handle(res) {
  if (res.status === 401) throw new Error('Unauthorized — check your token');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export async function listVideos() {
  return handle(await fetch('/api/videos', { headers: headers() }));
}

export async function getVideo(id) {
  return handle(await fetch(`/api/videos/${id}`, { headers: headers() }));
}

export async function uploadVideo(file, title, onProgress) {
  const form = new FormData();
  form.append('title', title || file.name);
  form.append('video', file);
  // fetch() has no upload progress; the spinner in the UI covers it.
  void onProgress;
  return handle(await fetch('/api/videos', { method: 'POST', headers: headers(), body: form }));
}

export async function deleteVideo(id) {
  return handle(await fetch(`/api/videos/${id}`, { method: 'DELETE', headers: headers() }));
}

export function streamUrl(video) {
  if (!video.master_playlist_url) return null;
  return `${video.master_playlist_url}?token=${encodeURIComponent(getToken())}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function statusLabel(status) {
  return { uploaded: 'Queued', processing: 'Transcoding…', ready: 'Ready', failed: 'Failed' }[status] || status;
}
