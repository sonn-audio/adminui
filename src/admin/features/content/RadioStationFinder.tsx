import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  canPreviewRadioStream,
  radioPreviewSrc,
  searchRadioStations,
  type RadioStationHit,
} from '../../services/contentApi';
import './RadioStationFinder.css';

/**
 * Listening to a stream url without leaving the form.
 *
 * The element is built in memory rather than rendered: it is never seen, and keeping it out
 * of the tree means the audio survives re-renders while a station is playing. Only one plays
 * at a time — starting another replaces it, which is also what releases the decoder the
 * server spawned for the first one.
 */
export function useStreamPreview(): {
  playing: string | null;
  loading: string | null;
  failed: string | null;
  toggle: (url: string) => void;
  stop: () => void;
} {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  const stop = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Dropping the source is what actually closes the request, and closing the request is
      // what stops the decoder on the server. Pausing alone leaves both running.
      audio.removeAttribute('src');
      audio.load();
    }
    setPlaying(null);
    setLoading(null);
  }, []);

  const toggle = React.useCallback(
    (url: string) => {
      if (playing === url || loading === url) {
        stop();
        return;
      }
      stop();
      setFailed(null);
      setLoading(url);
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = radioPreviewSrc(url);
      audio.onplaying = () => {
        setLoading(null);
        setPlaying(url);
      };
      audio.onerror = () => {
        setLoading(null);
        setPlaying(null);
        setFailed(url);
      };
      void audio.play().catch(() => {
        setLoading(null);
        setPlaying(null);
        setFailed(url);
      });
    },
    [loading, playing, stop],
  );

  // A form left open must not keep playing in the background.
  React.useEffect(() => stop, [stop]);

  return { playing, loading, failed, toggle, stop };
}

export function PreviewButton({
  url,
  preview,
  compact,
}: {
  url: string;
  preview: ReturnType<typeof useStreamPreview>;
  compact?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (!canPreviewRadioStream()) {
    return null;
  }
  const isLoading = preview.loading === url;
  const isPlaying = preview.playing === url;
  const label = isPlaying
    ? t('content.radio.custom.find.stop')
    : isLoading
      ? t('content.radio.custom.find.opening')
      : t('content.radio.custom.find.listen');
  return (
    <button
      type="button"
      className={['content-btn', 'radio-find__listen', compact ? 'is-compact' : '']
        .filter(Boolean)
        .join(' ')}
      onClick={() => preview.toggle(url)}
      disabled={!url.trim()}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{isPlaying ? '■' : isLoading ? '…' : '▶'}</span>
      {compact ? null : <span>{label}</span>}
    </button>
  );
}

type Props = {
  /** Fills the form from a station the searcher picked. */
  onPick: (hit: RadioStationHit) => void;
  preview: ReturnType<typeof useStreamPreview>;
};

/**
 * Search the public radio index from inside the custom-stream form.
 *
 * Deliberately a way to *fill in the form*, not a second way to add a station: what it finds
 * lands in the same three fields a url is typed into, and stays editable. Not knowing a
 * stream url should not be what stops someone adding a station — knowing one should still be
 * the fastest way.
 */
export default function RadioStationFinder({ onPick, preview }: Props): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<RadioStationHit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Logos the index lists that no longer exist. Tracked rather than hidden with a style on
  // the element itself: React owns that attribute and puts the broken icon back on the next
  // render, which is exactly when a row is re-measured.
  const [deadArt, setDeadArt] = React.useState<Set<string>>(() => new Set());

  const run = async (): Promise<void> => {
    const trimmed = query.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDeadArt(new Set());
      setResults(await searchRadioStations(trimmed));
    } catch {
      // The index is somebody else's server; unreachable is an ordinary outcome and the
      // form has to keep working without it.
      setError(t('content.radio.custom.find.unreachable'));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="radio-find">
      <label className="inline-form__field-label" htmlFor="radio-find-query">
        {t('content.radio.custom.find.label')}
      </label>
      <div className="radio-find__bar">
        <input
          id="radio-find-query"
          className="inline-form__input"
          type="text"
          placeholder={t('content.radio.custom.find.placeholder')}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return;
            }
            // Enter here means "search", not "save the station I have not picked yet".
            event.preventDefault();
            void run();
          }}
        />
        <button
          type="button"
          className="content-btn"
          onClick={() => void run()}
          disabled={busy || !query.trim()}
        >
          {busy ? t('content.radio.custom.find.searching') : t('content.radio.custom.find.search')}
        </button>
      </div>
      <p className="inline-form__help">{t('content.radio.custom.find.help')}</p>

      {error ? <p className="radio-find__error">{error}</p> : null}
      {results && results.length === 0 ? (
        <p className="radio-find__empty">{t('content.radio.custom.find.none', { query })}</p>
      ) : null}
      {results && results.length > 0 ? (
        <ul className="radio-find__results">
          {results.map((hit) => (
            <li key={hit.id} className="radio-find__row">
              <span className="radio-find__art" aria-hidden="true">
                {hit.coverurl && !deadArt.has(hit.coverurl) ? (
                  <img
                    src={hit.coverurl}
                    alt=""
                    loading="lazy"
                    onError={() =>
                      setDeadArt((prev) => new Set(prev).add(hit.coverurl as string))
                    }
                  />
                ) : null}
              </span>
              <span className="radio-find__text">
                <span className="radio-find__name">{hit.name}</span>
                <span className="radio-find__meta">{describe(hit, t)}</span>
              </span>
              <PreviewButton url={hit.stream} preview={preview} compact />
              <button
                type="button"
                className="content-btn content-btn--primary radio-find__use"
                onClick={() => onPick(hit)}
              >
                {t('content.radio.custom.find.use')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {preview.failed ? (
        <p className="radio-find__error">{t('content.radio.custom.find.previewFailed')}</p>
      ) : null}
    </div>
  );
}

/** The handful of facts that separate two listings of the same station. */
function describe(hit: RadioStationHit, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const parts: string[] = [];
  // The code, not the name: the index spells the country out in full ("The United States Of
  // America"), which pushes the format and the vote count off the end of the row.
  if (hit.countryCode || hit.country) {
    parts.push(hit.countryCode ?? (hit.country as string));
  }
  if (hit.codec) {
    parts.push(hit.bitrate ? `${hit.codec} ${hit.bitrate} kbps` : hit.codec);
  }
  if (hit.votes > 0) {
    parts.push(t('content.radio.custom.find.votes', { count: hit.votes }));
  }
  return parts.join(' · ');
}
