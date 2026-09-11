import { API_BASE } from '../config/apiConfig';
import { requestJson } from './http';
import type { StatusResponse } from '../types/api';


export type LatestVersions = {
  core: string | null;
  corePrerelease: string | null;
  ui: string | null;
  player: string | null;
  /**
   * Newest prerelease of each web bundle, for an install on the beta channel. Absent on
   * servers older than this field, which is why every read below tolerates undefined.
   */
  uiPrerelease: string | null;
  playerPrerelease: string | null;
  /** The `minCore` those releases state, so a bundle out of reach can be shown as such
   *  rather than discovered by pressing the button and collecting a 409. */
  uiMinCore: string | null;
  uiPrereleaseMinCore: string | null;
  playerMinCore: string | null;
  playerPrereleaseMinCore: string | null;
  /** Newest published build of the client the speakers run. */
  sonnClient: string | null;
  components: Record<string, string>;
  componentDescriptions: Record<string, string>;
};

export const EMPTY_LATEST: LatestVersions = {
  core: null,
  corePrerelease: null,
  ui: null,
  player: null,
  uiPrerelease: null,
  playerPrerelease: null,
  uiMinCore: null,
  uiPrereleaseMinCore: null,
  playerMinCore: null,
  playerPrereleaseMinCore: null,
  sonnClient: null,
  components: {},
  componentDescriptions: {},
};

// The cached result seeds instant display on load; freshness is governed by the
// backend (which caches the upstream GitHub/npm queries) and the shell's poll.
const CACHE_KEY = 'lox.admin.updateCheck';

export function normalizeTag(tag: string | null | undefined): string {
  return (tag ?? '').trim().replace(/^v/i, '');
}

export function normalizeVersion(input: string): { parts: number[]; prerelease: string | null } | null {
  const trimmed = input.trim().replace(/^v/i, '');
  if (!trimmed) return null;
  const [withoutBuild] = trimmed.split('+', 1);
  const [core, pre] = withoutBuild.split('-', 2);
  const parts = (core ?? '').split('.').map((part) => Number.parseInt(part.replace(/\D+.*$/, ''), 10));
  if (parts.some((part) => Number.isNaN(part))) return null;
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease: pre ? pre.trim() : null };
}

export function comparePrerelease(a: string | null, b: string | null): -1 | 0 | 1 {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aIds = a.split('.');
  const bIds = b.split('.');
  const max = Math.max(aIds.length, bIds.length);

  for (let i = 0; i < max; i += 1) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aiIsNum = /^\d+$/.test(ai);
    const biIsNum = /^\d+$/.test(bi);
    if (aiIsNum && biIsNum) {
      const aNum = Number(ai);
      const bNum = Number(bi);
      if (aNum < bNum) return -1;
      if (aNum > bNum) return 1;
      continue;
    }
    if (aiIsNum && !biIsNum) return -1;
    if (!aiIsNum && biIsNum) return 1;
    return ai < bi ? -1 : 1;
  }

  return 0;
}

export function compareSemver(current: string, latest: string): -1 | 0 | 1 {
  const currentNorm = normalizeVersion(current);
  const latestNorm = normalizeVersion(latest);
  if (!currentNorm || !latestNorm) return 0;
  const length = Math.max(currentNorm.parts.length, latestNorm.parts.length);
  for (let i = 0; i < length; i += 1) {
    const a = currentNorm.parts[i] ?? 0;
    const b = latestNorm.parts[i] ?? 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return comparePrerelease(currentNorm.prerelease, latestNorm.prerelease);
}

/**
 * Whether a core is at least a stated minimum.
 *
 * Open on both unknowns, matching the server exactly: a bundle that states no minimum made
 * no claim and installs, and a core whose version cannot be ordered (`dev`, a working copy)
 * is never gated out of its own build. Disagreeing with the server here would be worse than
 * not checking at all — the console would grey out a button the server would happily honour,
 * or promise one it will refuse.
 */
export function satisfiesMin(running: string | null, minimum: string | null | undefined): boolean {
  const min = (minimum ?? '').trim();
  const have = (running ?? '').trim();
  if (!min || !have) return true;
  if (!normalizeVersion(min) || !normalizeVersion(have)) return true;
  return compareSemver(have, min) >= 0;
}

/** What the console shows for one web bundle: what it can offer, and what stops it. */
export type WebAppTrack = {
  /** The release this install would actually receive, or the newest one if none fits. */
  latest: string | null;
  outdated: boolean;
  /** The core a newer bundle needs, when that is what is standing in the way. */
  blockedBy: string | null;
};

/**
 * Which release of a bundle this install is offered, mirroring what the server will do.
 *
 * Two rules, both the server's. The channel comes from the **core**, not from the bundle: a
 * beta core is offered beta bundles, with stables still eligible behind them, because these
 * repos may publish no prereleases at all and a beta install must then get the stable one.
 * Then compatibility: the newest candidate this core satisfies wins, so an install on an
 * older core is offered the last bundle built for it rather than a button that fails.
 *
 * When nothing fits, the newest is still named — with the core it needs. A card that simply
 * says "up to date" while a newer bundle exists is the version of this that helps nobody.
 */
export function webAppTrack(opts: {
  installed: string | null;
  coreVersion: string;
  stable: string | null;
  stableMinCore: string | null;
  prerelease: string | null;
  prereleaseMinCore: string | null;
}): WebAppTrack {
  // From the parsed version, not from a substring search: a stable core carrying a build
  // stamp (`4.0.0+dev-20260911`) contains a dash too, and reading that as a prerelease would
  // offer a stable install the beta bundles.
  const coreIsPrerelease = Boolean(normalizeVersion(opts.coreVersion)?.prerelease);
  const candidates: Array<{ version: string; minCore: string | null }> = [];
  if (coreIsPrerelease && opts.prerelease) {
    candidates.push({ version: opts.prerelease, minCore: opts.prereleaseMinCore });
  }
  if (opts.stable) {
    candidates.push({ version: opts.stable, minCore: opts.stableMinCore });
  }

  const fits = candidates.find((c) => satisfiesMin(opts.coreVersion, c.minCore));
  const chosen = fits ?? candidates[0] ?? null;
  if (!chosen) {
    return { latest: null, outdated: false, blockedBy: null };
  }
  const outdated = opts.installed
    ? compareSemver(opts.installed, chosen.version) === -1
    : // Nothing installed at all — the player before it was ever fetched — is behind by
      // definition, and the card's job is to offer the install.
      true;
  return {
    latest: chosen.version,
    outdated,
    blockedBy: fits ? null : (chosen.minCore ?? null),
  };
}

/** Fetches the latest available versions from our own backend, which polls
 *  GitHub + npm once and caches the result server-side. This keeps every admin
 *  browser/tab behind one IP from independently hammering the upstream APIs
 *  (GitHub allows only 60 req/h per IP unauthenticated). */
export async function fetchLatestVersions(
  signal?: AbortSignal,
  opts?: { force?: boolean },
): Promise<LatestVersions> {
  const data = await requestJson<{ latest?: Partial<LatestVersions>; checkedAt?: string }>(
    `${API_BASE}/updates/check${opts?.force ? '?force=1' : ''}`,
    { signal, includeBodyInError: false, errorMessage: 'Failed to check for updates' },
  );
  return { ...EMPTY_LATEST, ...data.latest };
}

/**
 * The add-on packages this install tracks, taken from the backend rather than a
 * hardcoded list. The server derives them from core's package.json (every
 * `@sonn-audio/node-*` dependency), reporting installed/declared under
 * `status.packages` and the latest npm version under `latest.components` — so a
 * newly added package appears here automatically, with no second list to keep in
 * sync. Union of both key sets, so a package still shows if one side has not
 * answered yet.
 */
export function componentPackageNames(
  status: StatusResponse | null,
  latest: LatestVersions,
): string[] {
  const names = new Set<string>([
    ...Object.keys(status?.packages ?? {}),
    ...Object.keys(latest.components ?? {}),
  ]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Rolls up whether any tracked artifact (core, admin UI, player, speakers, component)
 *  is behind its latest known release, given the running install's versions. */
export function computeHasUpdates(
  status: StatusResponse | null,
  latest: LatestVersions,
  appVersion: string,
): boolean {
  const version = status?.version ?? status?.apiVersion ?? '';
  const coreIsPrerelease = version.includes('-');
  const coreComparison = latest.core && version ? compareSemver(version, latest.core) : null;
  const corePrereleaseComparison =
    coreIsPrerelease && latest.corePrerelease && version
      ? compareSemver(version, latest.corePrerelease)
      : null;
  const coreOutdated = coreComparison === -1 || corePrereleaseComparison === -1;
  // A bundle that cannot be installed until the core moves is not an update anyone can act
  // on, and counting it here would leave the chip in the shell permanently lit for a button
  // that refuses. The core's own row is already telling that story.
  const uiTrack = webAppTrack({
    installed: status?.adminUi?.installed ?? appVersion,
    coreVersion: version,
    stable: latest.ui,
    stableMinCore: latest.uiMinCore,
    prerelease: latest.uiPrerelease,
    prereleaseMinCore: latest.uiPrereleaseMinCore,
  });
  const uiOutdated = uiTrack.outdated && !uiTrack.blockedBy;
  const playerInstalled = status?.player?.installed ?? null;
  const playerTrack = webAppTrack({
    installed: playerInstalled,
    coreVersion: version,
    stable: latest.player,
    stableMinCore: latest.playerMinCore,
    prerelease: latest.playerPrerelease,
    prereleaseMinCore: latest.playerPrereleaseMinCore,
  });
  // A player that was never fetched is not "behind" for the purposes of the shell's chip:
  // plenty of installs never want one, and lighting it forever would train people to
  // ignore it. The card below still offers the install.
  const playerOutdated = Boolean(playerInstalled) && playerTrack.outdated && !playerTrack.blockedBy;
  const sonnClientInstalled = status?.sonnClient?.installed ?? null;
  const sonnClientOutdated = Boolean(
    sonnClientInstalled &&
      latest.sonnClient &&
      compareSemver(sonnClientInstalled, latest.sonnClient) === -1,
  );
  const componentOutdated = componentPackageNames(status, latest).some((name) => {
    const current = status?.packages?.[name]?.installed;
    const latestVer = latest.components[name];
    return current && latestVer ? compareSemver(current, latestVer) === -1 : false;
  });
  return Boolean(
    coreOutdated || uiOutdated || playerOutdated || sonnClientOutdated || componentOutdated,
  );
}

export type CachedCheck = { latest: LatestVersions; checkedAt: string };

export function readCachedCheck(): CachedCheck | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCheck>;
    if (!parsed || typeof parsed.checkedAt !== 'string' || !parsed.latest) return null;
    return { latest: { ...EMPTY_LATEST, ...parsed.latest }, checkedAt: parsed.checkedAt };
  } catch {
    return null;
  }
}

export function writeCachedCheck(latest: LatestVersions, checkedAt: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ latest, checkedAt }));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}
