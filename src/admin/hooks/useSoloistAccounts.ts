import React from 'react';
import {
  cancelSoloistPairing,
  fetchSoloistStatus,
  startSoloistPairing,
  type SoloistAccountStatus,
  type SoloistStatus,
} from '../services/contentApi';

/** While somebody is being asked to pick a device, the answer changes without us doing anything. */
const WAITING_POLL_MS = 2_000;
/** Otherwise this only has to notice a key or a program appearing, which is a rare event. */
const IDLE_POLL_MS = 15_000;

export type SoloistAccounts = {
  /** Per account id: whether it can play, and whether somebody is signing it in right now. */
  byId: Map<string, SoloistAccountStatus>;
  /**
   * Whether an account can be signed in at all.
   *
   * Signing in runs the player, so it needs the program and the key first. Offering the button
   * without them gives an error that says nothing about what to go and do.
   */
  canSignIn: boolean;
  /** What is missing, when it cannot: the screen turns this into a sentence. */
  blocked: 'no-key' | 'no-program' | null;
  /**
   * The account the server is currently advertising for, so its row can say so.
   *
   * The server's answer and nothing else. It used to fall back to a local flag set when the button
   * was pressed, and that flag was only ever cleared on failure — so a pairing that *succeeded*
   * left the row saying "waiting" for ever, which is exactly the moment the screen has something
   * good to report.
   */
  signingIn: string | null;
  signIn: (accountId: string) => Promise<void>;
  stop: (accountId: string) => Promise<void>;
  error: string | null;
};

/**
 * Whether each Spotify account can actually play, and the one action that changes it.
 *
 * Lives here rather than in the playback-engine screen because it is a fact about an account, not
 * about the engine: an account that cannot play is the thing a listener notices, and they look for
 * it where the account is. The engine screen owns the program, the key and the quality; this owns
 * "can music come out of this account".
 */
export function useSoloistAccounts(enabled: boolean): SoloistAccounts {
  const [status, setStatus] = React.useState<SoloistStatus | null>(null);
  /** A request of ours is in flight; the buttons wait for it, nothing else reads it. */
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setStatus(await fetchSoloistStatus());
    } catch {
      // A failed refresh leaves the last answer standing: repeating itself every few seconds would
      // replace a working screen with an error.
    }
  }, []);

  const waiting = React.useMemo(
    () => (status?.accounts ?? []).some((account) => account.pairing?.state === 'pairing'),
    [status],
  );

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    void load();
    const timer = window.setInterval(() => void load(), waiting ? WAITING_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, waiting, load]);

  const act = React.useCallback(
    async (accountId: string, what: 'start' | 'stop') => {
      setError(null);
      setPending(true);
      try {
        await (what === 'start' ? startSoloistPairing(accountId) : cancelSoloistPairing(accountId));
        // Read straight back, so the row switches to what the server says rather than to something
        // this side guessed and would then have to remember to undo.
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [load],
  );

  const byId = React.useMemo(() => {
    const map = new Map<string, SoloistAccountStatus>();
    for (const account of status?.accounts ?? []) {
      map.set(account.id, account);
    }
    return map;
  }, [status]);

  const blocked: SoloistAccounts['blocked'] = !status
    ? null
    : !status.hasApiKey
      ? 'no-key'
      : !status.binary.present
        ? 'no-program'
        : null;

  return {
    byId,
    canSignIn: Boolean(status) && blocked === null && !pending,
    blocked,
    // Whatever the server is advertising for, which also survives this screen being reopened.
    signingIn: (status?.accounts ?? []).find((a) => a.pairing?.state === 'pairing')?.id ?? null,
    signIn: (accountId) => act(accountId, 'start'),
    stop: (accountId) => act(accountId, 'stop'),
    error,
  };
}
