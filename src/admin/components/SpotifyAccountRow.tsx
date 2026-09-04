import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SoloistAccounts } from '../hooks/useSoloistAccounts';

type Props = {
  accountKey: string;
  label: string;
  email?: string;
  playback: SoloistAccounts;
  removing: boolean;
  onRemove: () => void;
};

/**
 * One linked Spotify account: what it can do, and the one thing that might be missing.
 *
 * An account has two halves and only one of them comes from linking it. Linking lets this server
 * browse the account — its playlists, its library, search. Playing in a room needs a second thing:
 * the account has to be signed in to the player, once, by picking it in a Spotify app. Nothing
 * about a linked account says whether that happened, which is why the row says it out loud rather
 * than leaving someone to find a switched-off room and go looking.
 */
export function SpotifyAccountRow(props: Props): React.ReactElement {
  const { t } = useTranslation();
  const { accountKey, label, email, playback, removing, onRemove } = props;
  const status = playback.byId.get(accountKey);
  const waiting = playback.signingIn === accountKey;
  const ready = status?.paired === true;
  const failed = status?.pairing?.state === 'failed';
  /** Just signed in. Reported for a couple of minutes, then the row settles into `ready`. */
  const justSignedIn = status?.pairing?.state === 'paired';

  /** The row's own sentence: what this account can do right now, in a listener's terms. */
  const state = ((): { text: string; tone: 'ok' | 'warn' | 'wait' } => {
    if (waiting) {
      return {
        text: t('content.spotify.playback.waiting', {
          device: status?.pairing?.deviceName ?? t('content.spotify.playback.thisServer'),
        }),
        tone: 'wait',
      };
    }
    if (failed) {
      return {
        text:
          status?.pairing?.error === 'wrong_account'
            ? t('content.spotify.playback.wrongAccount', { user: status?.pairing?.username ?? '' })
            : t('content.spotify.playback.notPicked'),
        tone: 'warn',
      };
    }
    // What the player is missing comes before what the account has: a signed-in account still
    // cannot play if there is no key or no program, and saying it can would be a plain lie.
    if (playback.blocked === 'no-key') {
      return { text: t('content.spotify.playback.needsKey'), tone: 'warn' };
    }
    if (playback.blocked === 'no-program') {
      return { text: t('content.spotify.playback.needsProgram'), tone: 'warn' };
    }
    // Confirmation of the thing somebody just did, before the row settles into its steady state:
    // "it can play" is true either way, but it does not say that the sign-in worked.
    if (justSignedIn && ready) {
      return { text: t('content.spotify.playback.justSignedIn'), tone: 'ok' };
    }
    if (ready) {
      return { text: t('content.spotify.playback.ready'), tone: 'ok' };
    }
    return { text: t('content.spotify.playback.browseOnly'), tone: 'warn' };
  })();

  return (
    <div className="content-list-row">
      <div className="content-list-row__main">
        <div className="content-list-row__title">{label}</div>
        {email && email !== label ? (
          <div className="content-list-row__meta">{email}</div>
        ) : null}
        <div
          className={`content-list-row__sub${
            state.tone === 'ok' ? ' is-ok' : state.tone === 'wait' ? ' is-wait' : ' is-warn'
          }`}
        >
          {state.text}
        </div>
      </div>
      <div className="content-list-row__actions">
        {waiting ? (
          <button type="button" className="content-btn" onClick={() => void playback.stop(accountKey)}>
            {t('content.spotify.playback.stopWaiting')}
          </button>
        ) : (
          <button
            type="button"
            className={`content-btn${ready ? '' : ' content-btn--primary'}`}
            // Only one account can be signed in at a time: the player advertises one device, and
            // two people picking at once would each get the other's.
            disabled={!playback.canSignIn || playback.signingIn !== null}
            onClick={() => void playback.signIn(accountKey)}
          >
            {ready
              ? t('content.spotify.playback.signInAgain')
              : t('content.spotify.playback.signIn')}
          </button>
        )}
        <button
          type="button"
          className="content-btn content-btn--danger"
          onClick={onRemove}
          disabled={removing}
        >
          {removing ? t('content.spotify.removingAccount') : t('content.spotify.removeAccount')}
        </button>
      </div>
    </div>
  );
}
