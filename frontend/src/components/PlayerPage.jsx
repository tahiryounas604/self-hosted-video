import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getVideo, streamUrl, formatDuration, statusLabel } from '../api';

// Player page: plays the HLS master playlist with hls.js, falling back to
// native HLS (Safari) when available. The token is passed as a ?token= query
// parameter because <video> fetches cannot set Authorization headers.
export default function PlayerPage({ videoId, onBack }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getVideo(videoId);
        if (!cancelled) setVideo(v);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [videoId]);

  useEffect(() => {
    if (!video || video.status !== 'ready') return;
    const url = streamUrl(video);
    const el = videoRef.current;
    if (!url || !el) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(el);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(`Playback error: ${data.details}`);
      });
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url;
    } else {
      setError('This browser cannot play HLS streams.');
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [video]);

  if (error) return <div className="card"><p className="error">{error}</p><button onClick={onBack}>← Back to library</button></div>;
  if (!video) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <button onClick={onBack}>← Back to library</button>
      <h2>{video.title}</h2>
      <p className="muted">{formatDuration(video.duration_seconds)} · {statusLabel(video.status)}</p>
      {video.status === 'ready' ? (
        <video ref={videoRef} controls autoPlay playsInline className="player" />
      ) : (
        <p className="muted">
          {video.status === 'failed'
            ? `Transcoding failed: ${video.error || 'unknown error'}`
            : 'This video is still transcoding — refresh in a moment.'}
        </p>
      )}
    </div>
  );
}
