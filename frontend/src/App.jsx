import { useCallback, useEffect, useState } from 'react';
import UploadForm from './components/UploadForm.jsx';
import VideoLibrary from './components/VideoLibrary.jsx';
import PlayerPage from './components/PlayerPage.jsx';
import { getToken, listVideos, setToken } from './api';

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const [tokenInput, setTokenInput] = useState('');
  const [videos, setVideos] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    setError('');
    try {
      setVideos(await listVideos());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, token]);

  // Poll while any video is still transcoding so statuses update live.
  useEffect(() => {
    if (!videos.some((v) => v.status === 'uploaded' || v.status === 'processing')) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [videos, refresh]);

  function saveToken(e) {
    e.preventDefault();
    setToken(tokenInput.trim());
    setTokenState(tokenInput.trim());
  }

  if (!token) {
    return (
      <main className="container">
        <h1>Self-Hosted Video</h1>
        <form onSubmit={saveToken} className="card">
          <h2>Sign in</h2>
          <p className="muted">Enter the token from the server (<code>VIDEO_TOKEN</code>). It is stored only in this browser.</p>
          <label>
            Access token
            <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="paste token" />
          </label>
          <button type="submit" disabled={!tokenInput.trim()}>Continue</button>
        </form>
      </main>
    );
  }

  return (
    <main className="container">
      <header className="header">
        <h1>Self-Hosted Video</h1>
        <button className="secondary" onClick={() => { setToken(''); setTokenState(''); setVideos([]); }}>Sign out</button>
      </header>

      {playingId ? (
        <PlayerPage videoId={playingId} onBack={() => { setPlayingId(null); void refresh(); }} />
      ) : (
        <>
          <UploadForm onUploaded={() => void refresh()} />
          <section>
            <div className="row between">
              <h2>Library</h2>
              <button className="secondary" onClick={() => void refresh()} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            <VideoLibrary
              videos={videos}
              onSelect={(v) => setPlayingId(v.id)}
              onDeleted={(id) => setVideos((vs) => vs.filter((v) => v.id !== id))}
            />
          </section>
        </>
      )}
    </main>
  );
}
