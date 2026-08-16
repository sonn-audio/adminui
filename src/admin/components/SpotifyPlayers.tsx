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

type Props = {
  /** Linked Spotify accounts, for the built-in player's playback credentials. */
  accounts: Array<{ key: string; label: string }>;
  pairingAccountId: string | null;
  onPairAccount: (accountKey: string) => void;
  cacheEnabled: boolean;
  cacheSizeMb: number;
  onCacheChange: (patch: { cacheEnabled?: boolean; cacheSizeMb?: number }) => void;
  onSaveCache: () => void;
  cacheDirty: boolean;
  cacheSaving: boolean;
};

/**
 * Which player handles Spotify, and what each one needs.
 *
 * Presented as a choice between two rather than a list of settings, because that is what it is:
 * the built-in player is there and costs nothing, Soloist plays lossless and reaches accounts the
 * built-in one cannot but has to be installed and kept current by hand. Rooms are assigned
 * individually underneath, so one can be moved without committing the rest.
 */
export function SpotifyPlayers(props: Props): React.ReactElement {
  const { t } = useTranslation();
  /** Which card's setup is showing. The choice itself is `status.enabled`. */
  const [viewing, setViewing] = React.useState<'builtin' | 'soloist' | null>(null);
  const [status, setStatus] = React.useState<SoloistStatus | null>(null);
  const [apiKey, setApiKey] = React.useState('');
  const [editingKey, setEditingKey] = React.useState(false);
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

  const zones = status?.zones ?? [];
  const usingSoloist = status?.enabled === true;
  const selected = viewing ?? (usingSoloist ? 'soloist' : 'builtin');
  // Read from the build stamp, so it is known as soon as the file is there rather than only
  // after something has played. Falls back to what a running Soloist reported about itself.
  const expiresInDays = status?.binary.expiresInDays ?? status?.expiry?.daysAtCheck;
  const expired = typeof expiresInDays === 'number' && expiresInDays <= 0;
  const expiringSoon = typeof expiresInDays === 'number' && !expired && expiresInDays <= EXPIRY_WARN_DAYS;
  // The server fetches the program itself wherever Spotify publishes one for this machine, so the
  // 90 days stopped being anybody's problem — only a machine it has no build for still asks.
  const selfUpdating = status?.autoUpdates === true;
  const lookedAt = status?.build?.checkedAt;

  // Only while Soloist is the chosen player, which is the only time the rooms are listed.
  React.useEffect(() => {
    if (!usingSoloist) {
      return;
    }
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [usingSoloist, load]);

  return (
    <div className="spotify-players">
      <h3 className="spotify-players__heading">{t('content.players.heading')}</h3>

      <div className="spotify-players__choice">
        <button
          type="button"
          className={`player-card${!usingSoloist ? ' is-in-use' : ''}${selected === 'builtin' ? ' is-viewing' : ''}`}
          onClick={() => {
            setViewing('builtin');
            if (usingSoloist) {
              void run(() => saveSoloistSettings({ enabled: false }));
            }
          }}
        >
          <span className="player-card__name">
            {t('content.players.builtin.name')}
            {!usingSoloist ? (
              <span className="player-card__badge">{t('content.players.inUse')}</span>
            ) : null}
          </span>
          <span className="player-card__desc">{t('content.players.builtin.desc')}</span>
        </button>
        <button
          type="button"
          className={`player-card${usingSoloist ? ' is-in-use' : ''}${selected === 'soloist' ? ' is-viewing' : ''}`}
          onClick={() => {
            setViewing('soloist');
            if (!usingSoloist) {
              void run(() => saveSoloistSettings({ enabled: true }));
            }
          }}
        >
          <span className="player-card__name">
            {t('content.players.soloist.name')}
            <span className="player-card__tag">{t('content.soloist.experimental')}</span>
            {usingSoloist ? (
              <span className="player-card__badge">{t('content.players.inUse')}</span>
            ) : null}
          </span>
          <span className="player-card__desc">{t('content.players.soloist.desc')}</span>
        </button>
      </div>

      {selected === 'builtin' ? (
        <div className="spotify-players__panel">
          <div className="content-toggle-card">
            <div className="content-toggle-card__info">
              <h3 className="content-toggle-card__title">{t('content.spotify.cache.title')}</h3>
              <p className="content-toggle-card__desc">{t('content.spotify.cache.desc')}</p>
            </div>
            <div className="content-toggle-card__group">
              <span className="content-toggle-card__group-label">
                {t('content.spotify.cache.size')}
              </span>
              <div className="content-input content-input--inline" style={{ width: 120 }}>
                <input
                  type="number"
                  value={props.cacheSizeMb}
                  onChange={(event) =>
                    props.onCacheChange({ cacheSizeMb: Number(event.target.value) || 0 })
                  }
                />
                <span className="content-input__suffix">MB</span>
              </div>
            </div>
            <button
              type="button"
              className={`content-toggle${props.cacheEnabled ? ' is-on' : ''}`}
              aria-label={t('content.spotify.cache.title')}
              onClick={() => props.onCacheChange({ cacheEnabled: !props.cacheEnabled })}
            />
          </div>
          {/* Only this player needs it. Spotify stopped accepting the logins the server can mint
              for itself, so the built-in player has to be handed credentials from the Spotify app
              once per account. Soloist has its own login and never sees this. */}
          <div className="spotify-players__tile">
            <div>
              <h3 className="content-toggle-card__title">
                {t('content.players.builtin.credentials')}
              </h3>
              <p className="content-toggle-card__desc">
                {t('content.players.builtin.credentialsDesc')}
              </p>
            </div>
            <div className="content-list">
              {props.accounts.map((account) => (
                <div key={account.key} className="content-list-row">
                  <div className="content-list-row__main">
                    <div className="content-list-row__title">{account.label || account.key}</div>
                  </div>
                  <div className="content-list-row__actions">
                    <button
                      type="button"
                      className="content-btn"
                      disabled={Boolean(props.pairingAccountId)}
                      onClick={() => props.onPairAccount(account.key)}
                    >
                      {props.pairingAccountId === account.key
                        ? t('content.spotify.pair.pairing')
                        : t('content.spotify.pair.action')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {props.cacheDirty ? (
            <div className="source-card__save-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="content-btn content-btn--primary"
                onClick={props.onSaveCache}
                disabled={props.cacheSaving}
              >
                {props.cacheSaving ? t('content.spotify.saving') : t('content.spotify.cache.save')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
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
      )}

      {usingSoloist ? (
        <div className="spotify-players__tile">
          {/* Not an action: a zone's Soloist advertises itself over Zeroconf and waits, so what
              is missing is someone connecting to it once in the Spotify app — which is what
              hands it the credentials it then keeps. Saying that is the whole of it. */}
          <div>
            <h3 className="content-toggle-card__title">{t('content.players.roomsTitle')}</h3>
            <p className="content-toggle-card__desc">{t('content.players.roomsDesc')}</p>
          </div>
          <div className="content-list">
            {zones.map((zone) => (
              <div key={zone.zoneId} className="content-list-row">
                <div className="content-list-row__main">
                  <div className="content-list-row__title">{zone.name ?? `#${zone.zoneId}`}</div>
                </div>
                <div className="content-list-row__actions">
                  <span className={zone.paired ? 'content-ok' : 'content-warn'}>
                    {zone.paired ? t('content.players.roomReady') : t('content.players.roomWaiting')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`source-card__action-reason${message.kind === 'error' ? ' is-error' : ''}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
