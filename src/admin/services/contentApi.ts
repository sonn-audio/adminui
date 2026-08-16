import { API_BASE } from '../config/apiConfig';
import type { TtsConfig } from '../types/config';
import { requestJson, requestOk } from './http';

export type ContentUpdatePayload = {
  radio?: {
    tuneInUsername?: string | null;
    radioParadise?: { enabled?: boolean };
  };
  spotify?: {
    clientId?: string | null;
    cacheEnabled?: boolean;
    cacheSizeMb?: number;
  };
  library?: {
    enabled?: boolean;
    autoScan?: boolean;
  };
  tts?: TtsConfig;
  /** DLNA/UPnP MediaServer that exposes browsable content to other devices. */
  mediaServer?: {
    enabled?: boolean;
    friendlyName?: string;
  };
  /** WebDAV share over the music folder, mountable as a network drive. */
  webdav?: {
    enabled?: boolean;
  };
};

/** Server-wide input settings. Receivers are per player (see zonesApi), not here. */
export type InputsUpdatePayload = {
  lineIn?: { inputs?: Array<Record<string, unknown>> | null };
};

export async function updateContentConfig(payload: ContentUpdatePayload): Promise<void> {
  await requestOk(`${API_BASE}/config/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to update content settings',
  });
}

export async function updateInputsConfig(payload: InputsUpdatePayload): Promise<void> {
  await requestOk(`${API_BASE}/config/inputs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to update input settings',
  });
}

export type LibraryStatusResponse = {
  status: number;
  trackCount?: number | null;
  albumCount?: number | null;
  artistCount?: number | null;
};

export type LibraryCoverSample = {
  id: string;
  album: string;
  artist: string;
  coverurl: string;
};

export type LibraryStorageStatusResponse = {
  trackCount?: number | null;
  albumCount?: number | null;
  artistCount?: number | null;
};

export async function fetchLibraryStatus(): Promise<LibraryStatusResponse> {
  return requestJson(`${API_BASE}/content/library/status`, {
    errorMessage: 'Failed to fetch library status',
  });
}

export async function fetchLibraryCovers(limit = 8): Promise<{ covers?: LibraryCoverSample[] }> {
  return requestJson(`${API_BASE}/content/library/covers?limit=${encodeURIComponent(String(limit))}`, {
    errorMessage: 'Failed to fetch library covers',
  });
}

export async function fetchLibraryStorageStatus(storageId: string): Promise<LibraryStorageStatusResponse> {
  return requestJson(`${API_BASE}/content/library/storages/${encodeURIComponent(storageId)}/status`, {
    errorMessage: 'Failed to fetch library share status',
  });
}

export async function fetchLibraryStorageCovers(
  storageId: string,
  limit = 8,
): Promise<{ covers?: LibraryCoverSample[] }> {
  return requestJson(
    `${API_BASE}/content/library/storages/${encodeURIComponent(storageId)}/covers?limit=${encodeURIComponent(
      String(limit),
    )}`,
    {
      errorMessage: 'Failed to fetch library share covers',
    },
  );
}

export type LibraryBrowseKind = 'albums' | 'artists' | 'tracks';

export type LibraryBrowseItem = {
  id: string;
  name: string;
  kind?: string;
  coverurl?: string;
  /** Track count for an album/artist row. */
  items?: number;
  /** Present on tracks — the id the track delete endpoint takes. */
  audiopath?: string;
  artist?: string;
  album?: string;
  duration?: number;
};

export type LibraryBrowseResponse = {
  kind: LibraryBrowseKind;
  storageId: string;
  query: string;
  items: LibraryBrowseItem[];
  offset: number;
  limit: number;
  total: number;
  /** Set when a search hit the server's per-type cap, so more matches exist. */
  truncated: boolean;
};

export async function fetchLibraryBrowse(params: {
  kind: LibraryBrowseKind;
  storageId?: string;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<LibraryBrowseResponse> {
  const search = new URLSearchParams({ kind: params.kind });
  if (params.storageId) search.set('storageId', params.storageId);
  if (params.query) search.set('q', params.query);
  if (params.offset) search.set('offset', String(params.offset));
  if (params.limit) search.set('limit', String(params.limit));
  return requestJson(`${API_BASE}/content/library/browse?${search.toString()}`, {
    errorMessage: 'Failed to browse the library',
  });
}

/**
 * Streams one file into the library.
 *
 * Sends the file as the raw request body rather than base64 in JSON: no ~33%
 * size inflation, no whole-file buffering in memory, and no practical size cap.
 * It writes through the same server-side path as the network drive, so a folder
 * dropped here lands on disk exactly as one copied over WebDAV — names intact.
 */
export async function uploadLibraryFile(
  file: File,
  relativePath: string,
  signal?: AbortSignal,
): Promise<void> {
  // Encode each segment so spaces and non-ASCII survive the URL, while the
  // separators stay real separators.
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  await requestOk(`${API_BASE}/content/library/files/${encoded}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    signal,
    errorMessage: 'Failed to upload audio',
  });
}

export async function triggerLibraryRescan(): Promise<void> {
  await requestOk(`${API_BASE}/content/library/rescan`, {
    method: 'POST',
    errorMessage: 'Failed to trigger library rescan',
  });
}

export type LibraryDeleteResponse = {
  result?: {
    deletedTracks?: number;
    deletedFiles?: number;
    missingFiles?: number;
  };
};

export async function deleteLibraryTrack(audiopath: string): Promise<LibraryDeleteResponse> {
  return requestJson(`${API_BASE}/content/library/tracks`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audiopath }),
    errorMessage: 'Failed to remove track',
  });
}

export async function deleteLibraryAlbum(id: string): Promise<LibraryDeleteResponse> {
  return requestJson(`${API_BASE}/content/library/albums`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    errorMessage: 'Failed to remove album',
  });
}

export async function deleteLibraryArtist(id: string): Promise<LibraryDeleteResponse> {
  return requestJson(`${API_BASE}/content/library/artists`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    errorMessage: 'Failed to remove artist',
  });
}

export async function fetchSpotifyAuthLink(): Promise<{ link?: string }> {
  return requestJson(`${API_BASE}/spotify/accounts/link`, {
    errorMessage: 'Failed to build Spotify auth link',
  });
}

export async function deleteSpotifyAccount(accountId: string): Promise<void> {
  await requestOk(`${API_BASE}/spotify/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to remove Spotify account',
  });
}

export type SpotifyPairingStatus = {
  state: 'idle' | 'pairing' | 'paired' | 'failed';
  deviceName?: string;
  expiresAt?: number;
  username?: string;
  error?: string;
};

/**
 * Ask the server to show up in the Spotify app as a device to pick.
 *
 * Returns as soon as it is advertising — the handshake only completes once someone
 * selects it, so the caller polls {@link fetchSpotifyPairingStatus} from there.
 */
export async function startSpotifyPairing(
  accountId: string,
  deviceName?: string,
): Promise<SpotifyPairingStatus> {
  return requestJson(`${API_BASE}/spotify/librespot/zeroconf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, deviceName }),
    errorMessage: 'Failed to start Spotify pairing',
  });
}

export async function fetchSpotifyPairingStatus(accountId: string): Promise<SpotifyPairingStatus> {
  return requestJson(
    `${API_BASE}/spotify/librespot/zeroconf?accountId=${encodeURIComponent(accountId)}`,
    { errorMessage: 'Failed to read Spotify pairing status' },
  );
}

/**
 * Spotify Soloist — the opt-in second playback backend.
 *
 * Everything here is per installation: the API key is personal to whoever generated it and the
 * program itself is downloaded by the user, because Spotify allows neither to be shipped.
 */
export type SoloistZoneStatus = {
  zoneId: number;
  name?: string;
  backend: 'librespot' | 'soloist';
  paired: boolean;
};

export type SoloistStatus = {
  enabled: boolean;
  hasApiKey: boolean;
  /** Whether zones ask Spotify for lossless rather than letting it pick a bitrate. */
  lossless: boolean;
  hostArch: string;
  expiry: { daysAtCheck: number; checkedAt: number } | null;
  /** Whether Spotify publishes a build for this machine, which is what makes it self-updating. */
  autoUpdates: boolean;
  /** What this server fetched and when it last looked. Null when it has never fetched one. */
  build: { signature?: string; digest?: string; checkedAt?: number; installedAt?: number } | null;
  binary: {
    present: boolean;
    executable: boolean;
    version?: string;
    /** Days until this build stops working, from its own build stamp. Can be negative. */
    expiresInDays?: number;
    expiresAt?: number;
    error?: string;
  };
  zones: SoloistZoneStatus[];
};

export async function fetchSoloistStatus(): Promise<SoloistStatus> {
  return requestJson(`${API_BASE}/spotify/soloist/status`, {
    errorMessage: 'Failed to read Soloist status',
  });
}

export async function saveSoloistSettings(payload: {
  enabled?: boolean;
  apiKey?: string;
  lossless?: boolean;
}): Promise<SoloistStatus> {
  return requestJson(`${API_BASE}/spotify/soloist/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to save Soloist settings',
  });
}

/** The program is uploaded, never fetched — Spotify does not allow it to be redistributed. */
export async function uploadSoloistBinary(file: File): Promise<SoloistStatus> {
  return requestJson(`${API_BASE}/spotify/soloist/binary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    errorMessage: 'Failed to upload the Soloist program',
  });
}

export type SpotifyBridgeConfig = {
  id: string;
  label: string;
  provider: string;
  enabled?: boolean;
  host?: string;
  port?: number;
  apiKey?: string;
  developerToken?: string;
  userToken?: string;
  ytmusicCookie?: string;
  deezerArl?: string;
  tidalAccessToken?: string;
  tidalCountryCode?: string;
  youtubeApiKey?: string;
  soundcloudOauthToken?: string;
  registerAll?: boolean;
  mode?: 'source' | 'sink';
};

export type CreateSpotifyBridgePayload = {
  id?: string;
  label?: string;
  provider: string;
  host?: string;
  port?: number;
  apiKey?: string;
  developerToken?: string;
  userToken?: string;
  ytmusicCookie?: string;
  deezerArl?: string;
  tidalAccessToken?: string;
  tidalCountryCode?: string;
  youtubeApiKey?: string;
  soundcloudOauthToken?: string;
  registerAll?: boolean;
  mode?: 'source' | 'sink';
};

// Non-Spotify services are first-class streaming accounts, not "Spotify
// bridges" — that framing is a Loxone-adapter detail. The server exposes them
// under the neutral /content/services route (the /spotify/bridges alias still
// works, but new clients use the neutral one).
export async function createSpotifyBridge(payload: CreateSpotifyBridgePayload): Promise<{ bridge: SpotifyBridgeConfig }> {
  return requestJson(`${API_BASE}/content/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to add streaming service',
  });
}

export async function deleteSpotifyBridge(id: string): Promise<void> {
  await requestOk(`${API_BASE}/content/services/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to remove streaming service',
  });
}

export type CustomRadioEntry = {
  id: string;
  name: string;
  stream: string;
  coverurl?: string;
};

type CustomRadioListResponse = {
  stations?: CustomRadioEntry[];
};

export async function fetchCustomRadioStations(): Promise<CustomRadioListResponse> {
  return requestJson(`${API_BASE}/content/radio/custom`, {
    errorMessage: 'Failed to load custom stations',
  });
}

export async function createCustomRadioStation(payload: {
  name: string;
  stream: string;
  coverurl?: string;
}): Promise<CustomRadioEntry> {
  const data = await requestJson<{ station: CustomRadioEntry }>(`${API_BASE}/content/radio/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to add custom station',
  });
  return data.station;
}

export async function deleteCustomRadioStation(id: string): Promise<void> {
  await requestOk(`${API_BASE}/content/radio/custom/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to remove custom station',
  });
}

export type TuneInValidationResponse = {
  valid: boolean;
  presetCount?: number;
  error?: string;
  message?: string;
};

export async function validateTuneInUsername(username: string): Promise<TuneInValidationResponse> {
  return requestJson(`${API_BASE}/content/radio/tunein/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    errorMessage: 'Failed to validate TuneIn username',
  });
}

export type LibraryStorage = {
  id: string;
  name: string;
  server: string;
  folder: string;
  type: string;
  username?: string;
  password?: string;
  guest?: boolean;
  options?: string;
};

type LibraryStorageListResponse = {
  storages?: LibraryStorage[];
};

export async function fetchLibraryStorages(): Promise<LibraryStorageListResponse> {
  return requestJson(`${API_BASE}/content/library/storages`, {
    errorMessage: 'Failed to load library shares',
  });
}

export type CreateLibraryStoragePayload = {
  name: string;
  server: string;
  folder: string;
  type: string;
  username?: string;
  password?: string;
  guest?: boolean;
  options?: string;
  id?: string;
};

type CreateLibraryStorageResponse = {
  storage: LibraryStorage;
};

export async function createLibraryStorage(
  payload: CreateLibraryStoragePayload,
): Promise<CreateLibraryStorageResponse> {
  return requestJson(`${API_BASE}/content/library/storages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    errorMessage: 'Failed to add library share',
  });
}

export async function deleteLibraryStorage(storageId: string): Promise<void> {
  await requestOk(`${API_BASE}/content/library/storages/${encodeURIComponent(storageId)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to remove library share',
  });
}

export type YtDlpStatusResponse = {
  version: string | null;
  source: string;
  managed: boolean;
  latest: string | null;
  updateAvailable: boolean | null;
  previous?: string | null;
};

/**
 * The yt-dlp behind every YouTube and YouTube Music service — one binary, one state,
 * so this is deliberately not scoped to the account whose modal happens to show it.
 */
export async function fetchYtDlpStatus(): Promise<YtDlpStatusResponse> {
  return requestJson(`${API_BASE}/ytdlp/status`, {
    errorMessage: 'Failed to read the yt-dlp version',
  });
}

export async function updateYtDlp(): Promise<YtDlpStatusResponse> {
  return requestJson(`${API_BASE}/ytdlp/update`, {
    method: 'POST',
    errorMessage: 'Failed to update yt-dlp',
  });
}
