import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchSoloistStatus,
  saveSoloistSettings,
  uploadSoloistBinary,
  type SoloistStatus,
} from '../services/contentApi';

/** Days left before a build stops working at which the screen starts saying so. */
const EXPIRY_WARN_DAYS = 21;

/**
 * How often the rooms re-read whether they have been signed in.
 *
 * It has to arrive on its own: pairing happens on a phone, in the Spotify app, while someone is
 * standing in front of this screen waiting for the room to say it is ready. Nothing here can be
 * told about it either — Soloist is handed its credentials directly and all the server ever sees is
 * the profile it leaves behind — so asking again is the only way to find out.
 */
const REFRESH_MS = 4000;

/**
 * Where the program comes from — the downloads page itself, not the tutorial around it.
 *
 * Linked rather than fetched, and that is Spotify's own instruction: the archives may not be
 * redistributed, so pointing at this page is the only thing this screen is allowed to do. It is
 * also where a replacement comes from every ninety days, which is the trip most people will make.
 */
const SOLOIST_DOWNLOAD_URL =
  'https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates';

/** Where a key is made. Premium account required, and it is made per person, not per install. */
const SOLOIST_KEY_URL = 'https://developer.spotify.com/dashboard/soloist';

/**
 * When the server last looked for a new build, in the reader's own words.
 *
 * A clock time is enough: this is reassurance that something is watching, not a figure anyone needs
 * to the minute. Today shows the time, anything older shows the date it was.
 */
function formatWhen(at: number): string {
  const when = new Date(at);
  const today = new Date().toDateString() === when.toDateString();
  return today
    ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString();
}

/**
 * What Spotify playback needs: the program, a key, and an account signed in.
 *
 * Not a choice any more. There used to be two clients here and this screen picked between them;
 * the built-in one could no longer get audio keys for accounts made after Nov 2025, so for a
 * growing share of users it played nothing at all. What is left is one client that does play, and
 * the price of it — a key that is personal, a program Spotify will not let anyone redistribute,
 * and a build that stops working after ninety days.
 */
export function SpotifyPlayers(): React.ReactElement {
  const { t } = useTranslation();
  /** Which card's setup is showing. The choice itself is `status.enabled`. */
  const [status, setStatus] = React.useState<SoloistStatus | null>(null);
  const [apiKey, setApiKey] = React.useState('');
  const [editingKey, setEditingKey] = React.useState(false);
  /** Opened by hand, for a setup that is finished and folded away. */
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  /** Bumped by every action, so an answer already on its way cannot undo what one just did. */
  const generation = React.useRef(0);

  const load = React.useCallback(async (silent = false) => {
    const at = generation.current;
    try {
      const next = await fetchSoloistStatus();
      if (generation.current === at) {
        setStatus(next);
      }
    } catch (err) {
      // A refresh that failed leaves the last answer standing: repeating itself every few seconds
      // would replace a working screen with an error, and overwrite what an action just said.
      if (!silent) {
        setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<SoloistStatus>, okText?: string): Promise<void> => {
    generation.current += 1;
    setBusy(true);
    setMessage(null);
    try {
      setStatus(await action());
      if (okText) {
        setMessage({ kind: 'ok', text: okText });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      // Again on the way out, so a refresh that overlapped this action is dropped as well rather
      // than putting the state it read before the change back on screen.
      generation.current += 1;
      setBusy(false);
    }
  };

  // Having a key is the same question as playing Spotify at all: it is personal and Premium-only,
  // so nobody has one by accident, and clearing it is how this gets turned off.
  const hasKey = status?.hasApiKey === true;
  // Read from the build stamp, so it is known as soon as the file is there rather than only
  // after something has played. Falls back to what a running Soloist reported about itself.
  const expiresInDays = status?.binary.expiresInDays ?? status?.expiry?.daysAtCheck;
  const expired = typeof expiresInDays === 'number' && expiresInDays <= 0;
  const expiringSoon = typeof expiresInDays === 'number' && !expired && expiresInDays <= EXPIRY_WARN_DAYS;
  // The server fetches the program itself wherever Spotify publishes one for this machine, so the
  // 90 days stopped being anybody's problem — only a machine it has no build for still asks.
  const selfUpdating = status?.autoUpdates === true;
  const lookedAt = status?.build?.checkedAt;

  // Only while it is switched on: what changes on its own is the program, which is only fetched
  // and only matters then.
  React.useEffect(() => {
    if (!hasKey) {
      return;
    }
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasKey, load]);

  /**
   * Nothing to attend to: a key is saved and a working program is installed.
   *
   * Then this whole section folds down to a line. It is a step you take once — the program keeps
   * itself up to date — so leaving it open would mean scrolling past finished setup every time
   * somebody comes back for the accounts, which is the only part of this screen anybody revisits.
   */
  const settled =
    Boolean(status) &&
    hasKey &&
    !editingKey &&
    status?.binary.present === true &&
    status?.binary.executable === true &&
    !expired;

  if (settled && !expanded) {
    return (
      <div className="spotify-players">
        <div className="spotify-configured-strip">
          <span className="spotify-configured-strip__chip" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="spotify-configured-strip__text">
            <div className="spotify-configured-strip__title">{t('content.players.readyTitle')}</div>
            <div className="spotify-configured-strip__sub">
              {t('content.players.readySub', {
                version: status?.binary.version ?? '?',
                days: expiresInDays ?? 0,
              })}
            </div>
          </div>
          <button
            type="button"
            className="content-btn content-btn--sm"
            onClick={() => setExpanded(true)}
          >
            {t('content.spotify.edit')}
          </button>
        </div>
        {expiringSoon ? (
          <p className="source-card__action-reason is-error">
            {t('content.soloist.binary.expiring')}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="spotify-players">
      {/* Says what this is, because "Soloist" means nothing to somebody who has not gone looking
          for it yet — and by the time it is folded away nobody has to read it again. */}
      <p className="spotify-players__intro">{t('content.players.intro')}</p>

      <div className="spotify-players__panel">
          <div className="content-toggle-card">
            <div className="content-toggle-card__info">
              <h3 className="content-toggle-card__title">{t('content.soloist.key.title')}</h3>
              <p className="content-toggle-card__desc">
                {status?.hasApiKey && !editingKey
                  ? t('content.soloist.key.saved')
                  : t('content.soloist.key.desc')}{' '}
                {status?.hasApiKey && !editingKey ? null : (
                  <a
                    className="content-link"
                    href={SOLOIST_KEY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('content.soloist.key.getIt')}
                  </a>
                )}
              </p>
              {status?.hasApiKey && !editingKey ? null : (
                <div className="spotify-players__field-row">
                  <div className="content-input" style={{ flex: 1 }}>
                    <input
                      type="password"
                      value={apiKey}
                      placeholder={t('content.soloist.key.placeholder')}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="content-btn content-btn--primary"
                    disabled={busy || apiKey.trim().length === 0}
                    onClick={() =>
                      void run(() => saveSoloistSettings({ apiKey: apiKey.trim() })).then(() => {
                        setApiKey('');
                        setEditingKey(false);
                      })
                    }
                  >
                    {t('content.soloist.key.save')}
                  </button>
                  {status?.hasApiKey ? (
                    <button
                      type="button"
                      className="content-btn"
                      onClick={() => {
                        setApiKey('');
                        setEditingKey(false);
                      }}
                    >
                      {t('content.spotify.cancel')}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            {status?.hasApiKey && !editingKey ? (
              <div className="content-toggle-card__group">
                <button type="button" className="content-btn" onClick={() => setEditingKey(true)}>
                  {t('content.soloist.key.replace')}
                </button>
              </div>
            ) : null}
          </div>
          {/* Neither the program nor the key may be shipped, so both steps say who has to do it. */}
          <div className="content-toggle-card">
            <div className="content-toggle-card__info">
              <h3 className="content-toggle-card__title">{t('content.soloist.binary.title')}</h3>
              <p className="content-toggle-card__desc">
                {status?.binary.present
                  ? t('content.soloist.binary.present', {
                      version: status.binary.version ?? '?',
                      arch: status.hostArch,
                    })
                  : selfUpdating
                    ? t('content.soloist.binary.fetching')
                    : t('content.soloist.binary.missing')}
                {status?.binary.present && typeof expiresInDays === 'number' && !selfUpdating ? (
                  <>
                    {' '}
                    <span className={expiringSoon || expired ? 'content-warn' : undefined}>
                      {expired
                        ? t('content.soloist.binary.expired')
                        : t('content.soloist.binary.expiresIn', { days: expiresInDays })}
                    </span>
                  </>
                ) : null}
              </p>
              {selfUpdating ? (
                <p className="content-toggle-card__desc">
                  {t('content.soloist.binary.fetched')}
                  {lookedAt
                    ? ` ${t('content.soloist.binary.checkedAt', { when: formatWhen(lookedAt) })}`
                    : ''}
                </p>
              ) : (
                <>
                  <p className="content-toggle-card__desc">
                    {t('content.soloist.binary.manualOnly', { arch: status?.hostArch ?? '' })}
                  </p>
                  {expiringSoon || expired ? (
                    <p className="source-card__action-reason is-error">
                      {t('content.soloist.binary.expiring')}
                    </p>
                  ) : null}
                  <p className="content-toggle-card__desc">
                    {t('content.soloist.binary.accepts')}
                  </p>
                  <p className="content-toggle-card__desc">
                    <a
                      className="content-link"
                      href={SOLOIST_DOWNLOAD_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('content.soloist.binary.getIt')}
                    </a>
                  </p>
                </>
              )}
            </div>
            <div className="content-toggle-card__group">
              {/* No accept filter on purpose: the unpacked program has no extension, so any
                  filter that let the .tar.gz through would grey the other one out. */}
              <input
                ref={fileInput}
                type="file"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    void run(() => uploadSoloistBinary(file), t('content.soloist.binary.stored'));
                  }
                }}
              />
              <button
                type="button"
                className="content-btn"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {selfUpdating
                  ? t('content.soloist.binary.uploadInstead')
                  : status?.binary.present
                    ? t('content.soloist.binary.replace')
                    : t('content.soloist.binary.upload')}
              </button>
            </div>
          </div>

          {/* Set per room in the Spotify app otherwise, one room at a time, in a screen most
              people never open — so it is asked for here instead. */}
          <div className="content-toggle-card">
            <div className="content-toggle-card__info">
              <h3 className="content-toggle-card__title">{t('content.soloist.lossless.title')}</h3>
              <p className="content-toggle-card__desc">{t('content.soloist.lossless.desc')}</p>
            </div>
            <button
              type="button"
              className={`content-toggle${status?.lossless !== false ? ' is-on' : ''}`}
              aria-label={t('content.soloist.lossless.title')}
              disabled={busy || !status}
              onClick={() =>
                void run(() => saveSoloistSettings({ lossless: status?.lossless === false }))
              }
            />
          </div>

          {/* A tile like the two above it: the key is a thing you have or have not, not a form
              standing loose under a heading. */}
      </div>

      {message ? (
        <p className={`source-card__action-reason${message.kind === 'error' ? ' is-error' : ''}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
