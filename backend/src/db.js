// SQLite metadata store for self-hosted-video.
// Uses Node's built-in node:sqlite (Node >= 22.5). No external dependencies.
import { DatabaseSync } from 'node:sqlite';

export const STATUSES = ['uploaded', 'processing', 'ready', 'failed'];

export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      duration_seconds REAL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos (status);
    CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created_at);
  `);
  return db;
}

export function insertVideo(db, video) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO videos (id, title, original_filename, duration_seconds, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(video.id, video.title, video.original_filename, video.duration_seconds ?? null, video.status ?? 'uploaded', now, now);
  return getVideo(db, video.id);
}

export function getVideo(db, id) {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  return row ? toPublic(row) : null;
}

export function listVideos(db) {
  return db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all().map(toPublic);
}

export function updateVideo(db, id, patch) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    if (['title', 'duration_seconds', 'status', 'error'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return getVideo(db, id);
  fields.push('updated_at = ?');
  values.push(new Date().toISOString(), id);
  db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getVideo(db, id);
}

export function deleteVideo(db, id) {
  const info = db.prepare('DELETE FROM videos WHERE id = ?').run(id);
  return info.changes > 0;
}

function toPublic(row) {
  return {
    id: row.id,
    title: row.title,
    original_filename: row.original_filename,
    duration_seconds: row.duration_seconds,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    master_playlist_url: row.status === 'ready' ? `/hls/${row.id}/master.m3u8` : null,
  };
}
