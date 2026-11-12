import { useState } from 'react';
import { uploadVideo } from '../api';

export default function UploadForm({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) {
      setError('Choose a video file first.');
      return;
    }
    setBusy(true);
    setError('');
    setDone('');
    try {
      const video = await uploadVideo(file, title.trim());
      setDone(`“${video.title}” uploaded — transcoding started.`);
      setFile(null);
      setTitle('');
      e.target.reset();
      onUploaded?.(video);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Upload a video</h2>
      <label>
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My video (optional)" />
      </label>
      <label>
        Video file
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      {file && <p className="muted">Selected: {file.name} ({Math.round(file.size / 1024 / 1024)} MB)</p>}
      <button type="submit" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload & transcode'}</button>
      {error && <p className="error">{error}</p>}
      {done && <p className="ok">{done}</p>}
      <p className="muted">Transcodes to HLS (720p + 480p) in the background. Max upload 1 GiB in v0.1.</p>
    </form>
  );
}
