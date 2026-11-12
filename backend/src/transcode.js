// ffmpeg transcode queue: source file -> HLS with 720p + 480p renditions.
// Runs jobs one at a time (FIFO). Uses ffprobe for duration and ffmpeg
// (libx264 + aac) for the renditions. No mocks: real ffmpeg invocations.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const RENDITIONS = [
  { name: '720p', height: 720, videoBitrate: '2500k', audioBitrate: '128k' },
  { name: '480p', height: 480, videoBitrate: '1000k', audioBitrate: '96k' },
];

export function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export async function probeDuration(inputPath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe could not read a duration from ${inputPath}`);
  }
  return duration;
}

async function transcodeRendition(inputPath, outDir, rendition) {
  await fs.mkdir(outDir, { recursive: true });
  await runCommand('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', `scale=-2:${rendition.height}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-b:v', rendition.videoBitrate,
    '-c:a', 'aac', '-b:a', rendition.audioBitrate,
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', path.join(outDir, 'seg%03d.ts'),
    path.join(outDir, 'playlist.m3u8'),
  ]);
}

// Estimate average bandwidth (bits/s) from the segments on disk.
async function renditionBandwidth(outDir, durationSeconds) {
  const entries = await fs.readdir(outDir);
  let bytes = 0;
  for (const entry of entries) {
    if (entry.endsWith('.ts')) bytes += (await fs.stat(path.join(outDir, entry))).size;
  }
  return Math.max(1, Math.round((bytes * 8) / Math.max(durationSeconds, 0.1)));
}

export async function buildMasterPlaylist(hlsDir, durationSeconds) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const rendition of RENDITIONS) {
    const bandwidth = await renditionBandwidth(path.join(hlsDir, rendition.name), durationSeconds);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rendition.height === 720 ? '1280x720' : '854x480'}`,
      `${rendition.name}/playlist.m3u8`,
    );
  }
  const master = `${lines.join('\n')}\n`;
  await fs.writeFile(path.join(hlsDir, 'master.m3u8'), master);
  return master;
}

export async function transcodeVideo(inputPath, hlsDir) {
  const duration = await probeDuration(inputPath);
  await fs.mkdir(hlsDir, { recursive: true });
  for (const rendition of RENDITIONS) {
    await transcodeRendition(inputPath, path.join(hlsDir, rendition.name), rendition);
  }
  const master = await buildMasterPlaylist(hlsDir, duration);
  return { duration, master };
}

// Sequential FIFO job queue. `onDone(videoId, result|error)` is called
// after each job finishes so the server can update the video's status.
export class TranscodeQueue {
  constructor({ onJobDone, onJobStart }) {
    this.jobs = [];
    this.running = false;
    this.onJobDone = onJobDone;
    this.onJobStart = onJobStart;
  }

  enqueue(job) {
    this.jobs.push(job);
    void this.pump();
  }

  async pump() {
    if (this.running) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.running = true;
    try {
      this.onJobStart?.(job.videoId);
      const result = await transcodeVideo(job.inputPath, job.hlsDir);
      this.onJobDone(job.videoId, { ok: true, ...result });
    } catch (err) {
      this.onJobDone(job.videoId, { ok: false, error: err.message });
    } finally {
      this.running = false;
      void this.pump();
    }
  }
}
