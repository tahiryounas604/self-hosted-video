import { deleteVideo, formatDuration, statusLabel } from '../api';

export default function VideoLibrary({ videos, onSelect, onDeleted }) {
  async function handleDelete(video) {
    if (!window.confirm(`Delete “${video.title}” permanently?`)) return;
    try {
      await deleteVideo(video.id);
      onDeleted?.(video.id);
    } catch (err) {
      alert(err.message);
    }
  }

  if (videos.length === 0) {
    return <p className="muted">No videos yet — upload one above.</p>;
  }

  return (
    <ul className="library">
      {videos.map((video) => (
        <li key={video.id} className="card">
          <strong>{video.title}</strong>
          <span className="muted">
            {formatDuration(video.duration_seconds)} · {statusLabel(video.status)}
            {video.error ? ` — ${video.error}` : ''}
          </span>
          <span className="muted small">{new Date(video.created_at).toLocaleString()}</span>
          <div className="row">
            <button disabled={video.status !== 'ready'} onClick={() => onSelect(video)}>
              ▶ Play
            </button>
            <button className="danger" onClick={() => handleDelete(video)}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
