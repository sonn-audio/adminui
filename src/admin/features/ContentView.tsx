import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import './ContentView.css';
import { getConfig } from '../services/setupApi';
import { API_BASE, authHeaders, credentialsMode } from '../config/apiConfig';
import {
  updateContentConfig,
  fetchLibraryStatus,
  fetchLibraryStorageCovers,
  fetchLibraryStorageStatus,
  uploadLibraryFile,
  triggerLibraryRescan,
  deleteLibraryAlbum,
  deleteSpotifyAccount,
  fetchSpotifyAuthLink,
  fetchSpotifyPairingStatus,
  startSpotifyPairing,
  fetchLibraryStorages,
  createLibraryStorage,
  deleteLibraryStorage,
  fetchCustomRadioStations,
  createCustomRadioStation,
  deleteCustomRadioStation,
  validateTuneInUsername,
  createSpotifyBridge,
  deleteSpotifyBridge,
  updateInputsConfig,
  fetchYtDlpStatus,
  updateYtDlp,
} from '../services/contentApi';
import type {
  YtDlpStatusResponse,
  LibraryStorage,
  CustomRadioEntry,
  LibraryCoverSample,
  SpotifyBridgeConfig,
  CreateSpotifyBridgePayload,
} from '../services/contentApi';
import {
  fetchAppleMusicWidevineStatus,
  uploadAppleMusicWidevineClientId,
  uploadAppleMusicWidevinePrivateKey,
  type AppleMusicWidevineStatus,
} from '../services/appleMusicWidevineApi';
import { useGlobalAlert } from '../components/GlobalAlert';
import { useConfirm } from '../components/ConfirmDialog';
import InlineState from '../components/InlineState';
import { SpotifyPlayers } from '../components/SpotifyPlayers';
import { InlineForm, InlineFormField } from '../components/InlineForm';
import LibraryBrowser from './content/LibraryBrowser';
import SubTabs from '../components/SubTabs';
import { SubPanel, useSubPanelTransition } from '../components/SubPanel';
import Row from '../components/Row';
import { emitAuthReset } from '../services/http';
import { discoverSendspinSources, type SendspinClient } from '../services/transportsApi';
import type { RootConfig } from '../types/config';
import ContentHero from './content/ContentHero';
import type { ContentFilterKey } from './content/types';
import Modal from '../components/Modal';

type ContentConfigResponse = {
  config?: RootConfig;
};

type SpotifyAccountConfig = {
  id?: string;
  displayName?: string;
  name?: string;
  user?: string;
  email?: string;
  product?: string;
};

type ScanStatus = 0 | 1 | 2;

type StorageLibraryStats = {
  tracks: number;
  albums: number;
  artists: number;
};

type LineInInputConfig = {
  id?: string;
  name?: string;
  iconType?: LineInIconType;
  metadataEnabled?: boolean;
  controllable?: boolean;
  autoPlayZoneId?: number;
  source?: {
    type?: LineInSourceType;
    [key: string]: unknown;
  } | null;
};

type ZoneOption = {
  id: number;
  name: string;
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav']);

type StorageFormState = {
  name: string;
  server: string;
  folder: string;
  type: string;
  username: string;
  password: string;
  guest: boolean;
  options: string;
};

type CustomRadioFormState = {
  name: string;
  stream: string;
  coverurl: string;
};

type BridgeFormState = {
  provider: 'musicassistant' | 'applemusic' | 'ytmusic' | 'deezer' | 'tidal' | 'youtube' | 'soundcloud';
  label: string;
  host: string;
  port: number;
  apiKey: string;
  userToken: string;
  ytmusicCookie: string;
  deezerArl: string;
  tidalAccessToken: string;
  tidalCountryCode: string;
  youtubeApiKey: string;
  soundcloudOauthToken: string;
  mode: 'source' | 'sink';
};

type LineInFormState = {
  name: string;
  iconType: LineInIconType;
  sourceType: LineInSourceType;
  metadataEnabled: boolean;
  controllable: boolean;
  autoPlayZoneId: string;
  draftId: string;
  sendspinClientId: string;
  ingestSampleRate: string;
  ingestChannels: string;
  ingestBitDepth: string;
  ingestCodec: string;
  vadThresholdDb: string;
  vadHoldMs: string;
};

enum LineInIconType {
  LineIn = 0,
  CdPlayer = 1,
  Computer = 2,
  IMac = 3,
  IPod = 4,
  Mobile = 5,
  Radio = 6,
  Screen = 7,
  TurnTable = 8,
}

const LINEIN_ICON_OPTIONS: Array<{ value: LineInIconType; labelKey: string }> = [
  { value: LineInIconType.LineIn, labelKey: 'content.linein.iconOptions.lineIn' },
  { value: LineInIconType.CdPlayer, labelKey: 'content.linein.iconOptions.cdPlayer' },
  { value: LineInIconType.IMac, labelKey: 'content.linein.iconOptions.imac' },
  { value: LineInIconType.IPod, labelKey: 'content.linein.iconOptions.ipod' },
  { value: LineInIconType.Mobile, labelKey: 'content.linein.iconOptions.mobile' },
  { value: LineInIconType.Radio, labelKey: 'content.linein.iconOptions.radio' },
  { value: LineInIconType.Screen, labelKey: 'content.linein.iconOptions.screen' },
  { value: LineInIconType.TurnTable, labelKey: 'content.linein.iconOptions.turntable' },
];

type LineInSourceType = 'ingest' | 'sendspin';

function describeLineInIcon(iconType: LineInIconType): string {
  switch (iconType) {
    case LineInIconType.LineIn:
      return 'Line in';
    case LineInIconType.CdPlayer:
      return 'CD player';
    case LineInIconType.Computer:
      return 'Computer';
    case LineInIconType.IMac:
      return 'iMac';
    case LineInIconType.IPod:
      return 'iPod';
    case LineInIconType.Mobile:
      return 'Mobile';
    case LineInIconType.Radio:
      return 'Radio';
    case LineInIconType.Screen:
      return 'Screen';
    case LineInIconType.TurnTable:
      return 'Turntable';
    default:
      return 'Line in';
  }
}

function describeLineInSource(sourceType: LineInSourceType): string {
  if (sourceType === 'ingest') return 'Ingest (streamed input)';
  if (sourceType === 'sendspin') return 'Sendspin';
  return sourceType;
}

const SENDSPIN_STATUS_POLL_MS = 5000;
function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildLibraryFallbackCover(album?: string, artist?: string): string {
  const a = (album ?? '').trim();
  const b = (artist ?? '').trim();
  const seed = `${a}::${b}` || 'library';
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const hue2 = (hue + 42) % 360;
  const cx = 18 + (hash % 36);
  const cy = 20 + ((hash >> 4) % 30);
  const r = 8 + ((hash >> 8) % 8);
  const svg = [
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'>`,
    `<defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>`,
    `<stop offset='0%' stop-color='hsl(${hue} 58% 32%)'/>`,
    `<stop offset='100%' stop-color='hsl(${hue2} 62% 18%)'/>`,
    `</linearGradient></defs>`,
    `<rect width='72' height='72' rx='10' fill='url(#g)'/>`,
    `<circle cx='${cx}' cy='${cy}' r='${r}' fill='rgba(255,255,255,0.2)'/>`,
    `<rect x='16' y='44' width='40' height='4' rx='2' fill='rgba(255,255,255,0.35)'/>`,
    `<rect x='22' y='52' width='28' height='3' rx='1.5' fill='rgba(255,255,255,0.25)'/>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumberOrDefault(value: string, fallback: number): number {
  const parsed = parseOptionalNumber(value);
  return typeof parsed === 'number' ? parsed : fallback;
}

function parseNumberOrNull(value: string): number | null {
  const parsed = parseOptionalNumber(value);
  return typeof parsed === 'number' ? parsed : null;
}

function resolveLineInIconUrl(iconType: LineInIconType): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const toUrl = (file: string) => `${prefix}linein/${file}`;
  switch (iconType) {
    case LineInIconType.LineIn:
      return toUrl('line-in.svg');
    case LineInIconType.CdPlayer:
      return toUrl('cd-player.svg');
    case LineInIconType.Computer:
      return toUrl('computer.svg');
    case LineInIconType.IMac:
      return toUrl('imac.svg');
    case LineInIconType.IPod:
      return toUrl('ipod.svg');
    case LineInIconType.Mobile:
      return toUrl('mobile.svg');
    case LineInIconType.Radio:
      return toUrl('radio-1.svg');
    case LineInIconType.Screen:
      return toUrl('screen.svg');
    case LineInIconType.TurnTable:
      return toUrl('turntable.svg');
    default:
      return toUrl('line-in.svg');
  }
}

function createLineInId(): string {
  return `linein-${Date.now().toString(36)}`;
}

function getLineInIngestBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://<audioserver-host>';
  return window.location.origin || 'http://<audioserver-host>';
}

function getLineInIngestWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return baseUrl.replace('https://', 'wss://');
  if (baseUrl.startsWith('http://')) return baseUrl.replace('http://', 'ws://');
  return baseUrl;
}

function getLineInIngestTcpHost(): string {
  if (typeof window === 'undefined') return '<audioserver-host>';
  return window.location.hostname || '<audioserver-host>';
}

type FileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
};

type FileSystemFileEntry = FileSystemEntry & {
  file: (success: (file: File) => void, error?: () => void) => void;
};

type FileSystemDirectoryEntry = FileSystemEntry & {
  createReader: () => FileSystemDirectoryReader;
};

type FileSystemDirectoryReader = {
  readEntries: (success: (entries: FileSystemEntry[]) => void, error?: () => void) => void;
};

type DroppedUpload = {
  file: File;
  relativePath?: string;
};
function formatScanStatus(status: ScanStatus | null): { label: string; tone: 'idle' | 'active' | 'error' } {
  if (status === 1) return { label: 'Scanning', tone: 'active' };
  if (status === 2) return { label: 'Error', tone: 'error' };
  return { label: 'Idle', tone: 'idle' };
}

function isAudioFilename(name: string): boolean {
  const parts = name.toLowerCase().split('.');
  if (parts.length < 2) return false;
  return AUDIO_EXTENSIONS.has(`.${parts.pop()}`);
}

/**
 * Cleans a dropped path without renaming anything.
 *
 * Folder and file names are kept verbatim — accents, spaces and non-Latin
 * scripts included — so an album dropped here lands on disk under the same name
 * it has locally, matching what the network drive produces. Only traversal
 * segments are dropped; the server validates the path again on arrival.
 */
function normalizeRelativePath(pathValue: string | undefined | null): string | undefined {
  if (!pathValue) return undefined;
  const cleaned = pathValue.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..');
  if (parts.length === 0) return undefined;
  return parts.join('/');
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  return new Promise((resolve) => {
    const readBatch = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        () => resolve(entries),
      );
    };
    readBatch();
  });
}

async function collectFilesFromEntry(entry: FileSystemEntry | null, out: DroppedUpload[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (value) => resolve(value),
        () => resolve(null),
      );
    });
    if (file) {
      const relativePath = normalizeRelativePath(entry.fullPath);
      out.push({ file, relativePath });
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      await collectFilesFromEntry(child, out);
    }
  }
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<DroppedUpload[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const files: DroppedUpload[] = [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = (item as any).webkitGetAsEntry?.() as FileSystemEntry | null;
      if (entry) {
        await collectFilesFromEntry(entry, files);
      } else {
        const file = item.getAsFile();
        if (file) files.push({ file, relativePath: normalizeRelativePath(file.webkitRelativePath) });
      }
    }
  }
  if (files.length === 0) {
    files.push(
      ...Array.from(dataTransfer.files ?? []).map((file) => ({
        file,
        relativePath: normalizeRelativePath(file.webkitRelativePath),
      })),
    );
  }
  return files;
}

function resolveAccountKey(account: SpotifyAccountConfig | undefined | null): string | null {
  if (!account) return null;
  return account.id ?? account.user ?? account.email ?? account.displayName ?? account.name ?? null;
}

const createEmptyStorageForm = (): StorageFormState => ({
  name: '',
  server: '',
  folder: '',
  type: 'cifs',
  username: '',
  password: '',
  guest: false,
  options: 'rw,file_mode=0644,dir_mode=0755,iocharset=utf8',
});

function splitCifsOptions(input: string): string[] {
  return input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildReservedCifsOptions(form: StorageFormState): string[] {
  const reserved = ['rw', 'file_mode=0644', 'dir_mode=0755', 'iocharset=utf8'];
  const username = form.username.trim();
  if (form.guest) {
    reserved.push('guest');
  } else if (username) {
    reserved.push(`username=${username}`);
  }
  return reserved;
}

function extractExtraCifsOptions(input: string, form: StorageFormState): string[] {
  const reserved = new Set(buildReservedCifsOptions(form));
  return splitCifsOptions(input).filter((option) => {
    if (reserved.has(option)) return false;
    if (/^username=/i.test(option)) return false;
    if (/^password=/i.test(option)) return false;
    if (/^credentials=/i.test(option)) return false;
    if (/^guest$/i.test(option)) return false;
    return true;
  });
}

function buildEffectiveCifsOptionsLine(form: StorageFormState): string {
  return [...buildReservedCifsOptions(form), ...extractExtraCifsOptions(form.options, form)].join(',');
}

const createEmptyCustomRadioForm = (): CustomRadioFormState => ({
  name: '',
  stream: '',
  coverurl: '',
});

const createEmptyBridgeForm = (): BridgeFormState => ({
  provider: 'applemusic',
  label: '',
  host: '127.0.0.1',
  port: 8095,
  apiKey: '',
  userToken: '',
  ytmusicCookie: '',
  deezerArl: '',
  tidalAccessToken: '',
  tidalCountryCode: 'US',
  youtubeApiKey: '',
  soundcloudOauthToken: '',
  mode: 'source',
});

const createEmptyLineInForm = (): LineInFormState => ({
  name: '',
  iconType: LineInIconType.CdPlayer,
  sourceType: 'ingest',
  metadataEnabled: true,
  controllable: false,
  autoPlayZoneId: '',
  draftId: createLineInId(),
  sendspinClientId: '',
  ingestSampleRate: '',
  ingestChannels: '',
  ingestBitDepth: '',
  ingestCodec: '',
  vadThresholdDb: '-45',
  vadHoldMs: '2000',
});

const normalizeLineInInputs = (inputs: LineInInputConfig[]): LineInInputConfig[] => {
  return inputs.map((entry, index) => ({
    id: entry.id ?? `linein-${index}-${entry.name ?? 'input'}`,
    name: entry.name,
    iconType: typeof entry.iconType === 'number' ? entry.iconType : LineInIconType.CdPlayer,
    metadataEnabled: typeof entry.metadataEnabled === 'boolean' ? entry.metadataEnabled : true,
    controllable: Boolean(entry.controllable),
    autoPlayZoneId:
      typeof entry.autoPlayZoneId === 'number' && Number.isFinite(entry.autoPlayZoneId)
        ? Math.floor(entry.autoPlayZoneId)
        : undefined,
    source: {
      type: entry.source?.type ?? 'ingest',
      ...(entry.source ?? {}),
    },
  }));
};

const normalizeZones = (zones: unknown[] | undefined): ZoneOption[] => {
  if (!Array.isArray(zones)) return [];
  return zones
    .map((zone) => {
      if (!zone || typeof zone !== 'object') return null;
      const record = zone as Record<string, unknown>;
      const idRaw = record.id;
      const nameRaw = record.name;
      const id = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : NaN;
      if (!Number.isFinite(id) || id <= 0) return null;
      return {
        id: Math.floor(id),
        name: typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : `Zone ${Math.floor(id)}`,
      };
    })
    .filter((zone): zone is ZoneOption => Boolean(zone))
    .sort((a, b) => a.name.localeCompare(b.name));
};

function normalizeBridge(bridge: SpotifyBridgeConfig): SpotifyBridgeConfig {
  const provider = (bridge.provider || '').toLowerCase();
  if (provider === 'musicassistant') {
    return { ...bridge, provider: 'musicassistant' };
  }
  return bridge;
}

function resolveBridgeLogoUrl(provider?: string | null): string | null {
  const normalized = provider?.toLowerCase();
  const base = import.meta.env.BASE_URL || '/';
  const p = (name: string) => `${base}${name.replace(/^\//, '')}`;
  switch (normalized) {
    case 'musicassistant':
      return p('providers/music-assistant.png');
    case 'applemusic':
      return p('providers/apple-music.svg');
    case 'ytmusic':
      return p('providers/youtube-music.svg');
    case 'youtube':
      return p('providers/youtube.svg');
    case 'deezer':
      return p('providers/deezer.svg');
    case 'soundcloud':
      return p('providers/soundcloud.svg');
    case 'tidal':
      return p('providers/tidal.svg');
    default:
      return null;
  }
}

function sortStorages(entries: LibraryStorage[]): LibraryStorage[] {
  return [...entries].sort((a, b) => {
    const left = (a.name || `${a.server}/${a.folder}` || '').toLowerCase();
    const right = (b.name || `${b.server}/${b.folder}` || '').toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

type FeedbackMessage = { type: 'success' | 'error'; message: string };

type RadioState = {
  username: string;
  initialUsername: string;
  saving: boolean;
  feedback: FeedbackMessage | null;
  presetCount: number | null;
  validationMessage: string | null;
  validationStatus: 'idle' | 'checking' | 'valid' | 'invalid' | 'error';
};

type RadioAction = {
  type: 'update';
  payload: Partial<RadioState> | ((prev: RadioState) => Partial<RadioState>);
};

const initialRadioState: RadioState = {
  username: '',
  initialUsername: '',
  saving: false,
  feedback: null,
  presetCount: null,
  validationMessage: null,
  validationStatus: 'idle',
};

function radioReducer(state: RadioState, action: RadioAction): RadioState {
  if (action.type === 'update') {
    const patch = typeof action.payload === 'function' ? action.payload(state) : action.payload;
    return { ...state, ...patch };
  }
  return state;
}

type SpotifyState = {
  clientId: string;
  initialClientId: string;
  cacheEnabled: boolean;
  initialCacheEnabled: boolean;
  cacheSizeMb: number;
  initialCacheSizeMb: number;
  saving: boolean;
  feedback: FeedbackMessage | null;
  accounts: SpotifyAccountConfig[];
  deletingAccountId: string | null;
  addingAccount: boolean;
  pairingAccountId: string | null;
  refreshPending: boolean;
  bridges: SpotifyBridgeConfig[];
  bridgeModalOpen: boolean;
  bridgeEditingId: string | null;
  bridgeEditingLabel: string | null;
  bridgeForm: BridgeFormState;
  bridgeSubmitting: boolean;
  bridgeFeedback: FeedbackMessage | null;
  bridgeDeletingId: string | null;
};

type SpotifyAction = {
  type: 'update';
  payload: Partial<SpotifyState> | ((prev: SpotifyState) => Partial<SpotifyState>);
};

const initialSpotifyState: SpotifyState = {
  clientId: '',
  initialClientId: '',
  cacheEnabled: true,
  initialCacheEnabled: true,
  cacheSizeMb: 1024,
  initialCacheSizeMb: 1024,
  saving: false,
  feedback: null,
  accounts: [],
  deletingAccountId: null,
  addingAccount: false,
  pairingAccountId: null,
  refreshPending: false,
  bridges: [],
  bridgeModalOpen: false,
  bridgeEditingId: null,
  bridgeEditingLabel: null,
  bridgeForm: createEmptyBridgeForm(),
  bridgeSubmitting: false,
  bridgeFeedback: null,
  bridgeDeletingId: null,
};

function spotifyReducer(state: SpotifyState, action: SpotifyAction): SpotifyState {
  if (action.type === 'update') {
    const patch = typeof action.payload === 'function' ? action.payload(state) : action.payload;
    return { ...state, ...patch };
  }
  return state;
}

/**
 * The yt-dlp behind YouTube playback: which version is in use, and a way to move it on.
 *
 * It sits in the account modal because that is where someone lands when YouTube Music
 * misbehaves, but the binary is the server's rather than the account's — hence the note.
 * Only mounted while the panel is open, so nothing polls GitHub in the background.
 */
function YtDlpPanel(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<YtDlpStatusResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetchYtDlpStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);

  const runUpdate = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      const next = await updateYtDlp();
      setStatus(next);
      setNote({ kind: 'ok', text: t('content.bridge.ytdlp.updated', { version: next.version ?? '' }) });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setNote({ kind: 'error', text: t('content.bridge.ytdlp.failed', { error: text }) });
    } finally {
      setBusy(false);
    }
  };

  // Never call an unknown "up to date": failing to reach the release feed must not read
  // as good news, so that case gets its own sentence rather than the reassuring one.
  const state = !status || !status.version
    ? { text: t('content.bridge.ytdlp.missing'), warn: true }
    : status.updateAvailable === true
      ? { text: t('content.bridge.ytdlp.updateAvailable', { version: status.latest ?? '' }), warn: true }
      : status.updateAvailable === false
        ? { text: t('content.bridge.ytdlp.upToDate'), warn: false }
        : { text: t('content.bridge.ytdlp.unknown'), warn: false };

  return (
    <div className="content-toggle-card">
      <div className="content-toggle-card__info">
        <h3 className="content-toggle-card__title">{t('content.bridge.ytdlp.title')}</h3>
        <p className="content-toggle-card__desc">
          {status?.version ? t('content.bridge.ytdlp.installed', { version: status.version }) : null}{' '}
          <span className={state.warn ? 'content-warn' : undefined}>{state.text}</span>
        </p>
        <p className="content-toggle-card__desc">{t('content.bridge.ytdlp.desc')}</p>
        <p className="content-toggle-card__desc">{t('content.bridge.ytdlp.shared')}</p>
        {note ? (
          <p className={note.kind === 'error' ? 'source-card__action-reason is-error' : 'content-toggle-card__desc'}>
            {note.text}
          </p>
        ) : null}
      </div>
      <div className="content-toggle-card__group">
        <button type="button" className="content-btn" onClick={() => void runUpdate()} disabled={busy}>
          {busy ? t('content.bridge.ytdlp.updating') : t('content.bridge.ytdlp.update')}
        </button>
      </div>
    </div>
  );
}

export default function ContentView(): JSX.Element {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [addPickerOpen, setAddPickerOpen] = React.useState(false);
  const [spotifySetupOpen, setSpotifySetupOpen] = React.useState(false);
  /** The Spotify screen answers two unrelated questions; they get a tab each. */
  const [spotifyTab, setSpotifyTab] = React.useState<'accounts' | 'engine'>('accounts');
  // The "+ Add service" picker already chose the provider, so the wizard skips
  // its own provider step (no redundant, Spotify-less second provider screen).
  const [bridgeProviderLocked, setBridgeProviderLocked] = React.useState(false);
  // Radio providers, managed like streaming services: a picker + provider list.
  const [radioPickerOpen, setRadioPickerOpen] = React.useState(false);
  const [tuneInModalOpen, setTuneInModalOpen] = React.useState(false);
  const [radioParadiseEnabled, setRadioParadiseEnabled] = React.useState(true);
  const [appleAuthOpen, setAppleAuthOpen] = React.useState(false);
  const [appleAuthHeight, setAppleAuthHeight] = React.useState(180);
  const [appleMusicWidevineStatus, setAppleMusicWidevineStatus] = React.useState<AppleMusicWidevineStatus | null>(null);
  const [appleMusicWidevineLoading, setAppleMusicWidevineLoading] = React.useState(false);
  const [appleMusicPrivateKeyFile, setAppleMusicPrivateKeyFile] = React.useState<File | null>(null);
  const [appleMusicClientIdFile, setAppleMusicClientIdFile] = React.useState<File | null>(null);
  const [appleMusicWidevineUploading, setAppleMusicWidevineUploading] = React.useState(false);
  const [appleMusicWidevineUploadedAt, setAppleMusicWidevineUploadedAt] = React.useState<{ privateKey: number; clientId: number }>({
    privateKey: 0,
    clientId: 0,
  });

  const [radioState, dispatchRadio] = React.useReducer(radioReducer, initialRadioState);
  const [spotifyState, dispatchSpotify] = React.useReducer(spotifyReducer, initialSpotifyState);
  const setRadioState = React.useCallback((payload: RadioAction['payload']) => {
    dispatchRadio({ type: 'update', payload });
  }, []);
  const setSpotifyState = React.useCallback((payload: SpotifyAction['payload']) => {
    dispatchSpotify({ type: 'update', payload });
  }, []);

  const refreshAppleMusicWidevine = React.useCallback(async (): Promise<void> => {
    setAppleMusicWidevineLoading(true);
    try {
      const payload = await fetchAppleMusicWidevineStatus();
      setAppleMusicWidevineStatus(payload);
    } catch (err) {
      setAppleMusicWidevineStatus({ ok: false, status: 'error', details: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setAppleMusicWidevineLoading(false);
    }
  }, []);
  const {
    username: radioUsername,
    initialUsername: initialRadioUsername,
    saving: radioSaving,
    feedback: radioFeedback,
    presetCount: radioPresetCount,
    validationMessage: radioValidationMessage,
    validationStatus: radioValidationStatus,
  } = radioState;
  const {
    clientId: spotifyClientId,
    initialClientId: initialSpotifyClientId,
    cacheEnabled: spotifyCacheEnabled,
    initialCacheEnabled: spotifyInitialCacheEnabled,
    cacheSizeMb: spotifyCacheSizeMb,
    initialCacheSizeMb: spotifyInitialCacheSizeMb,
    saving: spotifySaving,
    feedback: spotifyFeedback,
    accounts: spotifyAccounts,
    deletingAccountId,
    addingAccount: addingSpotifyAccount,
    pairingAccountId,
    refreshPending: spotifyRefreshPending,
    bridges: spotifyBridges,
    bridgeModalOpen,
    bridgeEditingId,
    bridgeEditingLabel,
    bridgeForm,
    bridgeSubmitting,
    bridgeFeedback,
    bridgeDeletingId,
  } = spotifyState;

  const [libraryStatus, setLibraryStatus] = React.useState<ScanStatus | null>(null);
  const [libraryTrackCount, setLibraryTrackCount] = React.useState<number | null>(null);
  const [libraryAlbumCount, setLibraryAlbumCount] = React.useState<number | null>(null);
  const [libraryArtistCount, setLibraryArtistCount] = React.useState<number | null>(null);
  const [libraryLoading, setLibraryLoading] = React.useState(true);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [libraryMessage, setLibraryMessage] = React.useState<string | null>(null);
  const [libraryActionPending, setLibraryActionPending] = React.useState(false);
  const [libraryCovers, setLibraryCovers] = React.useState<LibraryCoverSample[]>([]);
  const [libraryCoversLoading, setLibraryCoversLoading] = React.useState(true);
  const [libraryCoversError, setLibraryCoversError] = React.useState<string | null>(null);
  const libraryStatusRef = React.useRef<ScanStatus | null>(null);
  const [libraryUploading, setLibraryUploading] = React.useState(false);
  const [libraryUploadFeedback, setLibraryUploadFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [libraryDeleteFeedback, setLibraryDeleteFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [libraryDeletingAlbumId, setLibraryDeletingAlbumId] = React.useState<string | null>(null);
  const [libraryDragActive, setLibraryDragActive] = React.useState(false);
  const libraryFileInputRef = React.useRef<HTMLInputElement | null>(null);
  // Bumped whenever the indexed content changes (scan, upload, delete) so the
  // library browser refetches its current page.
  const [libraryBrowseToken, setLibraryBrowseToken] = React.useState(0);
  /** Which library source the browser below is showing ('local' or a share id). */
  const [librarySourceId, setLibrarySourceId] = React.useState('local');
  const [libraryStorages, setLibraryStorages] = React.useState<LibraryStorage[]>([]);
  const [libraryStorageStats, setLibraryStorageStats] = React.useState<Record<string, StorageLibraryStats>>({});
  const [libraryStorageCovers, setLibraryStorageCovers] = React.useState<Record<string, LibraryCoverSample[]>>({});
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const [deletingStorageId, setDeletingStorageId] = React.useState<string | null>(null);
  const [storageFeedback, setStorageFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [storageSubmitting, setStorageSubmitting] = React.useState(false);
  const [storageForm, setStorageForm] = React.useState<StorageFormState>(() => createEmptyStorageForm());
  const [storageModalOpen, setStorageModalOpen] = React.useState(false);
  const [storageAdvancedOpen, setStorageAdvancedOpen] = React.useState(false);
  const [spotifyClientIdEditing, setSpotifyClientIdEditing] = React.useState(false);
  const [storageEditingId, setStorageEditingId] = React.useState<string | null>(null);
  const [lineInInputs, setLineInInputs] = React.useState<LineInInputConfig[]>([]);
  const [zoneOptions, setZoneOptions] = React.useState<ZoneOption[]>([]);
  const [bridgeWizStep, setBridgeWizStep] = React.useState(1);
  const [lineInModalOpen, setLineInModalOpen] = React.useState(false);
  const lineInNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const [lineInSubmitting, setLineInSubmitting] = React.useState(false);
  const [lineInEditingId, setLineInEditingId] = React.useState<string | null>(null);
  const [lineInForm, setLineInForm] = React.useState<LineInFormState>(() => createEmptyLineInForm());
  const [audioServerIp, setAudioServerIp] = React.useState<string>('');
  const [sendspinClients, setSendspinClients] = React.useState<SendspinClient[]>([]);
  const [sendspinLoading, setSendspinLoading] = React.useState(false);
  const [sendspinError, setSendspinError] = React.useState<string | null>(null);
  const [customRadios, setCustomRadios] = React.useState<CustomRadioEntry[]>([]);
  const [customRadioLoading, setCustomRadioLoading] = React.useState(true);
  const [customRadioError, setCustomRadioError] = React.useState<string | null>(null);
  const [customRadioSubmitting, setCustomRadioSubmitting] = React.useState(false);
  const [customRadioFeedback, setCustomRadioFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [customRadioForm, setCustomRadioForm] = React.useState<CustomRadioFormState>(() => createEmptyCustomRadioForm());
  const [customRadioModalOpen, setCustomRadioModalOpen] = React.useState(false);
  const [contentFilter, setContentFilter] = React.useState<ContentFilterKey>(() => {
    if (typeof window === 'undefined') return 'radio';
    const stored = window.localStorage.getItem('admin-content-filter');
    if (!stored) return 'radio';
    // The former 'spotify' and 'custom' tabs merged into one 'streaming' tab.
    if (stored === 'spotify' || stored === 'custom') return 'streaming';
    const allowed: ContentFilterKey[] = ['radio', 'library', 'streaming', 'linein'];
    return allowed.includes(stored as ContentFilterKey) ? (stored as ContentFilterKey) : 'radio';
  });
  const { displayed: displayedFilter, isLeaving: panelLeaving } = useSubPanelTransition(contentFilter, 200);
  const spotifyAccountBaselineRef = React.useRef(0);
  const { push: pushAlert } = useGlobalAlert();
  const { confirm } = useConfirm();
  const modalOpen = customRadioModalOpen || bridgeModalOpen || storageModalOpen || lineInModalOpen;
  const shareCoverSlots = 6;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('admin-content-filter', contentFilter);
  }, [contentFilter]);

  const radioDirty = radioUsername.trim() !== initialRadioUsername.trim();
  const spotifyDirty =
    spotifyClientId.trim() !== initialSpotifyClientId.trim() ||
    spotifyCacheEnabled !== spotifyInitialCacheEnabled ||
    spotifyCacheSizeMb !== spotifyInitialCacheSizeMb;
  const storageFormValid = React.useMemo(() => {
    return (
      storageForm.name.trim().length > 0 &&
      storageForm.server.trim().length > 0 &&
      storageForm.folder.trim().length > 0
    );
  }, [storageForm]);
  const storageEffectiveOptionsLine = React.useMemo(
    () => buildEffectiveCifsOptionsLine(storageForm),
    [storageForm],
  );
  const customRadioFormValid = React.useMemo(() => {
    return customRadioForm.name.trim().length > 0 && customRadioForm.stream.trim().length > 0;
  }, [customRadioForm]);
  const bridgeFormValid = React.useMemo(() => {
    if (!bridgeForm.provider.trim()) return false;
    if (!bridgeForm.label.trim()) return false;
    if (bridgeForm.provider === 'musicassistant') {
      return bridgeForm.host.trim().length > 0 && bridgeForm.apiKey.trim().length > 0;
    }
    if (bridgeForm.provider === 'applemusic') {
      return bridgeForm.userToken.trim().length > 0;
    }
    if (bridgeForm.provider === 'ytmusic') {
      return bridgeForm.ytmusicCookie.trim().length > 0;
    }
    if (bridgeForm.provider === 'tidal') {
      return bridgeForm.tidalAccessToken.trim().length > 0;
    }
    if (bridgeForm.provider === 'youtube') {
      return true;
    }
    if (bridgeForm.provider === 'soundcloud') {
      return bridgeForm.soundcloudOauthToken.trim().length > 0;
    }
    return true;
  }, [bridgeForm]);
  const bridgeProviderLogoUrl = React.useMemo(
    () => resolveBridgeLogoUrl(bridgeForm.provider),
    [bridgeForm.provider],
  );
  const sendspinClientMap = React.useMemo(() => {
    const map = new Map<string, SendspinClient>();
    for (const client of sendspinClients) {
      if (client.clientId) {
        map.set(client.clientId, client);
      }
    }
    return map;
  }, [sendspinClients]);
  const zoneNameById = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const zone of zoneOptions) {
      map.set(zone.id, zone.name);
    }
    return map;
  }, [zoneOptions]);
  // Named together on one line, because the accounts share a single Spotify app: listing them as
  // separate services reads as separate setups, which is the thing they aren't.
  const spotifyAccountNames = React.useMemo(
    () =>
      spotifyAccounts
        .map(
          (account) =>
            account.displayName ?? account.name ?? account.user ?? account.email ?? account.id ?? '',
        )
        .filter((label) => label.length > 0)
        .join(', '),
    [spotifyAccounts],
  );

  const validateTuneIn = React.useCallback(
    async (value: string): Promise<{ ok: boolean; message?: string }> => {
      const trimmed = value.trim();
      if (!trimmed) {
        setRadioState({
          presetCount: null,
          validationMessage: null,
          validationStatus: 'idle',
        });
        return { ok: true };
      }
      setRadioState({
        validationStatus: 'checking',
        validationMessage: null,
      });
      try {
        const result = await validateTuneInUsername(trimmed);
        if (result.valid) {
          const count = Number.isFinite(result.presetCount) ? Number(result.presetCount) : null;
          setRadioState({
            presetCount: count,
            validationStatus: 'valid',
          });
          const message =
            count !== null
              ? t('content.radio.validation.presetsFound', { count })
            : t('content.radio.validation.verifyTitle');
          setRadioState({ validationMessage: message });
          return { ok: true, message };
        }
        setRadioState({
          presetCount: null,
          validationStatus: 'invalid',
        });
        const message = result.message ?? t('content.radio.validation.notFoundMessage');
        setRadioState({ validationMessage: message });
        return { ok: false, message };
      } catch (err) {
        setRadioState({
          presetCount: null,
          validationStatus: 'error',
        });
        const message = t('content.radio.validation.verifyError');
        setRadioState({ validationMessage: message });
        return { ok: false, message };
      }
    },
    [t],
  );

  const refreshContent = React.useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const cfg = (await getConfig()) as ContentConfigResponse;
        if (signal?.aborted) return;
        const content = cfg.config?.content ?? {};
        setRadioParadiseEnabled(content.radio?.radioParadise?.enabled !== false);
        const lineIn = cfg.config?.inputs?.lineIn?.inputs ?? [];
        const currentRadio = content.radio?.tuneInUsername ?? '';
        const currentSpotify = content.spotify?.clientId ?? '';
        const currentAudioServerIp = cfg.config?.system?.audioserver?.ip ?? '';
        setRadioState({ username: currentRadio, initialUsername: currentRadio });
        const cacheEnabled = content.spotify?.cacheEnabled !== false;
        const cacheSizeMb = typeof content.spotify?.cacheSizeMb === 'number' ? content.spotify.cacheSizeMb : 1024;
        setSpotifyState({
          clientId: currentSpotify,
          initialClientId: currentSpotify,
          cacheEnabled,
          initialCacheEnabled: cacheEnabled,
          cacheSizeMb,
          initialCacheSizeMb: cacheSizeMb,
          accounts: Array.isArray(content.spotify?.accounts)
            ? (content.spotify!.accounts! as SpotifyAccountConfig[])
            : [],
          // The core migrates content.spotify.bridges → content.streamingServices
          // on load, so the neutral location is authoritative here.
          bridges: Array.isArray(content.streamingServices)
            ? content.streamingServices.map((bridge) => normalizeBridge(bridge as SpotifyBridgeConfig))
            : [],
        });
        setAudioServerIp(typeof currentAudioServerIp === 'string' ? currentAudioServerIp : '');
        setLineInInputs(Array.isArray(lineIn) ? normalizeLineInInputs(lineIn as LineInInputConfig[]) : []);
        setZoneOptions(normalizeZones(cfg.config?.zones));
        if (currentRadio.trim()) {
          void validateTuneIn(currentRadio);
        }
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : t('content.errorState.title'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [setRadioState, setSpotifyState, validateTuneIn, t],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void refreshContent(controller.signal);
    return () => controller.abort();
  }, [refreshContent]);

  const refreshSpotifyAccounts = React.useCallback(async (): Promise<number | null> => {
    try {
      const cfg = (await getConfig()) as ContentConfigResponse;
      const accounts = Array.isArray(cfg.config?.content?.spotify?.accounts)
        ? (cfg.config?.content?.spotify?.accounts as SpotifyAccountConfig[])
        : [];
      setSpotifyState({ accounts });
      return accounts.length;
    } catch {
      return null;
    }
  }, []);

  const scheduleSpotifyAccountRefresh = React.useCallback((): void => {
    spotifyAccountBaselineRef.current = spotifyAccounts.length;
    setSpotifyState({ refreshPending: true });
  }, [spotifyAccounts.length]);

  React.useEffect(() => {
    if (!spotifyRefreshPending) return undefined;
    let cancelled = false;
    let attempts = 0;
    const tick = async (): Promise<void> => {
      const count = await refreshSpotifyAccounts();
      if (cancelled) return;
      attempts += 1;
      if (count !== null && count !== spotifyAccountBaselineRef.current) {
        setSpotifyState({ refreshPending: false });
        return;
      }
      if (attempts >= 6) {
        setSpotifyState({ refreshPending: false });
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshSpotifyAccounts, spotifyRefreshPending]);

  const refreshLibraryStatus = React.useCallback(
    async (withLoading = false): Promise<void> => {
      if (withLoading) {
        setLibraryLoading(true);
        setLibraryError(null);
      }
      try {
        const [statusPayload, localPayload] = await Promise.all([
          fetchLibraryStatus(),
          fetchLibraryStorageStatus('local'),
        ]);
        setLibraryStatus((statusPayload.status ?? 0) as ScanStatus);
        setLibraryTrackCount(localPayload.trackCount ?? null);
        setLibraryAlbumCount(localPayload.albumCount ?? null);
        setLibraryArtistCount(localPayload.artistCount ?? null);
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t('content.library.feedback.albumStatusUnavailable'));
      } finally {
        setLibraryLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    void refreshLibraryStatus(true);
  }, [refreshLibraryStatus]);

  React.useEffect(() => {
    if (radioFeedback) pushAlert(radioFeedback);
  }, [pushAlert, radioFeedback]);

  React.useEffect(() => {
    if (spotifyFeedback) pushAlert(spotifyFeedback);
  }, [pushAlert, spotifyFeedback]);

  React.useEffect(() => {
    if (bridgeFeedback) pushAlert(bridgeFeedback);
  }, [bridgeFeedback, pushAlert]);

  React.useEffect(() => {
    if (libraryUploadFeedback) pushAlert(libraryUploadFeedback);
  }, [libraryUploadFeedback, pushAlert]);

  React.useEffect(() => {
    if (libraryDeleteFeedback) pushAlert(libraryDeleteFeedback);
  }, [libraryDeleteFeedback, pushAlert]);

  React.useEffect(() => {
    if (storageFeedback) pushAlert(storageFeedback);
  }, [pushAlert, storageFeedback]);

  React.useEffect(() => {
    if (customRadioFeedback) pushAlert(customRadioFeedback);
  }, [customRadioFeedback, pushAlert]);

  React.useEffect(() => {
    if (libraryMessage) pushAlert({ type: 'success', message: libraryMessage });
  }, [libraryMessage, pushAlert]);

  React.useEffect(() => {
    if (libraryError) pushAlert({ type: 'error', message: libraryError });
  }, [libraryError, pushAlert]);

  React.useEffect(() => {
    if (storageError) pushAlert({ type: 'error', message: storageError });
  }, [pushAlert, storageError]);

  React.useEffect(() => {
    if (customRadioError) pushAlert({ type: 'error', message: customRadioError });
  }, [customRadioError, pushAlert]);

  React.useEffect(() => {
    if (libraryCoversError) pushAlert({ type: 'error', message: libraryCoversError });
  }, [libraryCoversError, pushAlert]);

  React.useEffect(() => {
    if (!bridgeModalOpen) return;
    if (bridgeForm.provider !== 'applemusic') return;
    void refreshAppleMusicWidevine();
  }, [bridgeForm.provider, bridgeModalOpen, refreshAppleMusicWidevine]);

  const uploadAppleMusicWidevineFiles = React.useCallback(async (): Promise<void> => {
    if (appleMusicWidevineUploading) return;
    if (!appleMusicPrivateKeyFile && !appleMusicClientIdFile) {
      setSpotifyState({
        bridgeFeedback: { type: 'error', message: t('content.bridge.apple.uploadHint') },
      });
      return;
    }
    setAppleMusicWidevineUploading(true);
    try {
      let status: AppleMusicWidevineStatus | null = null;
      const now = Date.now();
      if (appleMusicPrivateKeyFile) {
        status = await uploadAppleMusicWidevinePrivateKey(appleMusicPrivateKeyFile);
        setAppleMusicWidevineUploadedAt((prev) => ({ ...prev, privateKey: now }));
      }
      if (appleMusicClientIdFile) {
        status = await uploadAppleMusicWidevineClientId(appleMusicClientIdFile);
        setAppleMusicWidevineUploadedAt((prev) => ({ ...prev, clientId: now }));
      }
      if (status) {
        setAppleMusicWidevineStatus(status);
      }
      // Always refresh after uploads to reflect missing/invalid remaining file(s).
      await refreshAppleMusicWidevine();
      setSpotifyState({
        bridgeFeedback: { type: 'success', message: t('content.bridge.apple.uploadedMessage') },
      });
      setAppleMusicPrivateKeyFile(null);
      setAppleMusicClientIdFile(null);
    } catch (err) {
      setSpotifyState({
        bridgeFeedback: { type: 'error', message: err instanceof Error ? err.message : t('content.bridge.apple.uploadFailed') },
      });
    } finally {
      setAppleMusicWidevineUploading(false);
    }
  }, [
    appleMusicClientIdFile,
    appleMusicPrivateKeyFile,
    appleMusicWidevineUploading,
    refreshAppleMusicWidevine,
    setSpotifyState,
    t,
  ]);

  const refreshLibraryCovers = React.useCallback(async (withLoading = false): Promise<void> => {
    if (withLoading) {
      setLibraryCoversLoading(true);
      setLibraryCoversError(null);
    }
    try {
      const payload = await fetchLibraryStorageCovers('local', 0);
      setLibraryCovers(Array.isArray(payload.covers) ? payload.covers : []);
    } catch (err) {
      setLibraryCovers([]);
      setLibraryCoversError(err instanceof Error ? err.message : t('content.library.feedback.coversFailed'));
    } finally {
      setLibraryCoversLoading(false);
    }
  }, [t]);

  const scheduleLibraryCoverRefresh = React.useCallback((): void => {
    // Small libraries can finish before the status poll notices "scanning".
    window.setTimeout(() => {
      void refreshLibraryStatus(false);
      void refreshLibraryCovers(false);
      setLibraryBrowseToken((v) => v + 1);
    }, 2500);
    window.setTimeout(() => {
      void refreshLibraryStatus(false);
      void refreshLibraryCovers(false);
      setLibraryBrowseToken((v) => v + 1);
    }, 7000);
  }, [refreshLibraryCovers, refreshLibraryStatus]);

  React.useEffect(() => {
    void refreshLibraryCovers(true);
  }, [refreshLibraryCovers]);

  const refreshLibraryStorages = React.useCallback(async (): Promise<void> => {
    setStorageLoading(true);
    setStorageError(null);
    try {
      const payload = await fetchLibraryStorages();
      setLibraryStorages(sortStorages(Array.isArray(payload.storages) ? payload.storages : []));
    } catch (err) {
      setLibraryStorages([]);
      setStorageError(err instanceof Error ? err.message : t('content.library.feedback.loadSharesFailed'));
    } finally {
      setStorageLoading(false);
    }
  }, [t]);

  const handleDeleteLibraryStorage = React.useCallback(
    async (storageId: string): Promise<void> => {
      if (!storageId || deletingStorageId) return;
      const ok = await confirm({
        title: t('content.library.feedback.removeShareTitle'),
        message: t('content.library.feedback.removeShareMessage'),
        confirmLabel: t('content.library.feedback.removeShareConfirm'),
        cancelLabel: t('content.library.feedback.deleteCancel'),
        tone: 'danger',
      });
      if (!ok) return;
      setDeletingStorageId(storageId);
      try {
        await deleteLibraryStorage(storageId);
        await refreshLibraryStorages();
      } catch (err) {
        pushAlert({
          tone: 'error',
          title: t('content.library.feedback.removalFailedTitle'),
          message: err instanceof Error ? err.message : t('content.library.feedback.removalFailedDefault'),
        });
      } finally {
        setDeletingStorageId(null);
      }
    },
    [confirm, deletingStorageId, pushAlert, refreshLibraryStorages, t],
  );

  React.useEffect(() => {
    void refreshLibraryStorages();
  }, [refreshLibraryStorages]);

  const refreshLibraryStorageDetails = React.useCallback(
    async (storages: LibraryStorage[]): Promise<void> => {
      if (storages.length === 0) {
        setLibraryStorageStats({});
        setLibraryStorageCovers({});
        return;
      }
      const statsMap: Record<string, StorageLibraryStats> = {};
      const coversMap: Record<string, LibraryCoverSample[]> = {};
      await Promise.all(
        storages.map(async (storage) => {
          try {
            const [status, covers] = await Promise.all([
              fetchLibraryStorageStatus(storage.id),
              fetchLibraryStorageCovers(storage.id, shareCoverSlots),
            ]);
            statsMap[storage.id] = {
              tracks: Number.isFinite(status.trackCount) ? Number(status.trackCount) : 0,
              albums: Number.isFinite(status.albumCount) ? Number(status.albumCount) : 0,
              artists: Number.isFinite(status.artistCount) ? Number(status.artistCount) : 0,
            };
            coversMap[storage.id] = Array.isArray(covers.covers) ? covers.covers : [];
          } catch {
            statsMap[storage.id] = { tracks: 0, albums: 0, artists: 0 };
            coversMap[storage.id] = [];
          }
        }),
      );
      setLibraryStorageStats(statsMap);
      setLibraryStorageCovers(coversMap);
    },
    [shareCoverSlots],
  );

  React.useEffect(() => {
    if (libraryStorages.length === 0) {
      setLibraryStorageStats({});
      setLibraryStorageCovers({});
      return;
    }
    void refreshLibraryStorageDetails(libraryStorages);
  }, [libraryStorages, refreshLibraryStorageDetails]);

  React.useEffect(() => {
    if (contentFilter !== 'library' || libraryStorages.length === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void refreshLibraryStorageDetails(libraryStorages);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [contentFilter, libraryStorages, refreshLibraryStorageDetails]);

  const refreshCustomRadios = React.useCallback(async (): Promise<void> => {
    setCustomRadioLoading(true);
    setCustomRadioError(null);
    try {
      const payload = await fetchCustomRadioStations();
      setCustomRadios(Array.isArray(payload.stations) ? payload.stations : []);
    } catch (err) {
      setCustomRadios([]);
      setCustomRadioError(err instanceof Error ? err.message : 'Failed to load custom streams');
    } finally {
      setCustomRadioLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshCustomRadios();
  }, [refreshCustomRadios]);

  const openStorageModal = (storage?: LibraryStorage): void => {
    if (storage) {
      setStorageEditingId(storage.id);
      setStorageForm({
        name: storage.name ?? '',
        server: storage.server ?? '',
        folder: storage.folder ?? '',
        type: storage.type ?? 'cifs',
        username: storage.guest ? '' : storage.username ?? '',
        password: storage.guest ? '' : storage.password ?? '',
        guest: storage.guest === true,
        options: [
          'rw',
          'file_mode=0644',
          'dir_mode=0755',
          'iocharset=utf8',
          ...(storage.guest ? ['guest'] : storage.username ? [`username=${storage.username}`] : []),
          ...splitCifsOptions(storage.options ?? ''),
        ].join(','),
      });
      setStorageAdvancedOpen((storage.options ?? '').trim().length > 0);
    } else {
      setStorageEditingId(null);
      setStorageForm(createEmptyStorageForm());
      setStorageAdvancedOpen(false);
    }
    setStorageModalOpen(true);
    setStorageFeedback(null);
  };

  const closeStorageModal = (resetFeedback = true): void => {
    setStorageModalOpen(false);
    if (resetFeedback) {
      setStorageFeedback(null);
    }
    setStorageEditingId(null);
    setStorageAdvancedOpen(false);
    setStorageForm(createEmptyStorageForm());
  };

  const openCustomRadioModal = (): void => {
    setCustomRadioModalOpen(true);
    setCustomRadioFeedback(null);
  };

  const closeCustomRadioModal = (resetFeedback = true): void => {
    setCustomRadioModalOpen(false);
    if (resetFeedback) {
      setCustomRadioFeedback(null);
    }
    setCustomRadioForm(createEmptyCustomRadioForm());
  };

  // Friendly default name for a provider — matches what the service is called in
  // the picker, and is what the source is pre-named so the field is never blank.
  const defaultBridgeLabel = (provider: BridgeFormState['provider']): string =>
    t(`content.bridge.providerNames.${provider}`);

  const openBridgeModal = (provider?: BridgeFormState['provider']): void => {
    const base = createEmptyBridgeForm();
    const form = provider ? { ...base, provider } : base;
    // When the picker already chose a provider, lock it and skip the wizard's
    // provider step — the config step becomes step 1 of the (filtered) flow.
    setBridgeProviderLocked(!!provider);
    setBridgeWizStep(1);
    setSpotifyState({
      bridgeModalOpen: true,
      bridgeFeedback: null,
      bridgeEditingId: null,
      bridgeEditingLabel: null,
      bridgeForm: { ...form, label: defaultBridgeLabel(form.provider) },
    });
  };

  const openLineInModal = (input?: LineInInputConfig): void => {
    if (input) {
      const rawSource = input.source ?? {};
      const sourceRecord = rawSource as Record<string, unknown>;
      const sendspinClientId = typeof sourceRecord.clientId === 'string' ? sourceRecord.clientId : '';
      const ingestCodec =
        typeof sourceRecord.codec === 'string'
          ? sourceRecord.codec
          : typeof sourceRecord.ingest_codec === 'string'
            ? sourceRecord.ingest_codec
            : '';
      const ingestChannels =
        typeof sourceRecord.channels === 'number'
          ? String(sourceRecord.channels)
          : typeof sourceRecord.channels === 'string'
            ? sourceRecord.channels
            : typeof sourceRecord.ingest_channels === 'number'
              ? String(sourceRecord.ingest_channels)
              : typeof sourceRecord.ingest_channels === 'string'
                ? sourceRecord.ingest_channels
                : '';
      const ingestBitDepth =
        typeof sourceRecord.bit_depth === 'number'
          ? String(sourceRecord.bit_depth)
          : typeof sourceRecord.bit_depth === 'string'
            ? sourceRecord.bit_depth
            : typeof sourceRecord.ingest_bit_depth === 'number'
              ? String(sourceRecord.ingest_bit_depth)
              : typeof sourceRecord.ingest_bit_depth === 'string'
                ? sourceRecord.ingest_bit_depth
                : '';
      const ingestSampleRate =
        typeof sourceRecord.sample_rate === 'number'
          ? String(sourceRecord.sample_rate)
          : typeof sourceRecord.sample_rate === 'string'
            ? sourceRecord.sample_rate
            : typeof sourceRecord.ingest_sample_rate === 'number'
              ? String(sourceRecord.ingest_sample_rate)
              : typeof sourceRecord.ingest_sample_rate === 'string'
                ? sourceRecord.ingest_sample_rate
                : '';
      const vadThresholdDb =
        typeof sourceRecord.vad_threshold_db === 'number' ? String(sourceRecord.vad_threshold_db) : '';
      const vadHoldMs =
        typeof sourceRecord.vad_hold_ms === 'number' ? String(sourceRecord.vad_hold_ms) : '';
      const autoPlayZoneId =
        typeof input.autoPlayZoneId === 'number' && Number.isFinite(input.autoPlayZoneId)
          ? String(Math.floor(input.autoPlayZoneId))
          : '';
      setLineInEditingId(input.id ?? null);
      const nextForm: LineInFormState = {
        name: input.name ?? '',
        iconType: typeof input.iconType === 'number' ? input.iconType : LineInIconType.CdPlayer,
        sourceType: input.source?.type ?? 'ingest',
        metadataEnabled: typeof input.metadataEnabled === 'boolean' ? input.metadataEnabled : true,
        controllable: Boolean(input.controllable),
        autoPlayZoneId,
        draftId: input.id ?? createLineInId(),
        sendspinClientId,
        ingestSampleRate,
        ingestChannels,
        ingestBitDepth,
        ingestCodec,
        vadThresholdDb,
        vadHoldMs,
      };
      setLineInForm(nextForm);
    } else {
      setLineInEditingId(null);
      setLineInForm(createEmptyLineInForm());
    }
    setLineInModalOpen(true);
  };

  const openBridgeEditModal = (bridge: SpotifyBridgeConfig): void => {
    setBridgeWizStep(1);
    setSpotifyState({
      bridgeEditingId: bridge.id,
      bridgeEditingLabel: bridge.label ?? bridge.id,
      bridgeForm: {
        provider: (bridge.provider?.toLowerCase() as BridgeFormState['provider']) || 'musicassistant',
        label: bridge.label ?? '',
        host: bridge.host ?? '127.0.0.1',
        port: bridge.port ?? 8095,
        apiKey: bridge.apiKey ?? '',
        userToken: bridge.userToken ?? '',
        ytmusicCookie: bridge.ytmusicCookie ?? '',
        deezerArl: bridge.deezerArl ?? '',
        tidalAccessToken: bridge.tidalAccessToken ?? '',
        tidalCountryCode: bridge.tidalCountryCode ?? 'US',
        youtubeApiKey: bridge.youtubeApiKey ?? '',
        soundcloudOauthToken: bridge.soundcloudOauthToken ?? '',
        mode: bridge.mode === 'sink' ? 'sink' : 'source',
      },
      bridgeFeedback: null,
      bridgeModalOpen: true,
    });
  };

  const closeBridgeModal = (resetFeedback = true): void => {
    setSpotifyState({
      bridgeModalOpen: false,
      bridgeFeedback: resetFeedback ? null : bridgeFeedback,
      bridgeForm: createEmptyBridgeForm(),
      bridgeEditingId: null,
      bridgeEditingLabel: null,
    });
  };

  const closeLineInModal = (): void => {
    setLineInModalOpen(false);
    setLineInEditingId(null);
    setLineInForm(createEmptyLineInForm());
  };

  React.useEffect(() => {
    if (libraryStatus !== 1) return undefined;
    const timer = window.setInterval(() => {
      void refreshLibraryStatus(false);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [libraryStatus, refreshLibraryStatus]);

  React.useEffect(() => {
    const prev = libraryStatusRef.current;
    libraryStatusRef.current = libraryStatus;
    if (prev === 1 && libraryStatus !== 1) {
      void refreshLibraryCovers(false);
    }
  }, [libraryStatus, refreshLibraryCovers]);

  // Radio Paradise as a toggleable provider (persisted like a streaming account).
  const handleToggleRadioParadise = async (enabled: boolean): Promise<void> => {
    const previous = radioParadiseEnabled;
    setRadioParadiseEnabled(enabled);
    try {
      await updateContentConfig({ radio: { radioParadise: { enabled } } });
    } catch (err) {
      setRadioParadiseEnabled(previous);
      pushAlert({ type: 'error', message: err instanceof Error ? err.message : t('content.radio.feedback.saveFailed') });
    }
  };

  // Removing TuneIn = clearing the username (it stops surfacing presets).
  const handleRemoveTuneIn = async (): Promise<void> => {
    dispatchRadio({ type: 'update', payload: { username: '' } });
    try {
      await updateContentConfig({ radio: { tuneInUsername: null } });
      setRadioState({ username: '', initialUsername: '' });
      await validateTuneIn('');
    } catch (err) {
      pushAlert({ type: 'error', message: err instanceof Error ? err.message : t('content.radio.feedback.saveFailed') });
    }
  };

  const handleSaveRadio = async (): Promise<void> => {
    if (radioSaving) return;
    setRadioState({ saving: true, feedback: null });
    try {
      const trimmed = radioUsername.trim();
      await updateContentConfig({
        radio: { tuneInUsername: trimmed || null },
      });
      setRadioState({
        username: trimmed,
        initialUsername: trimmed,
        feedback: { type: 'success', message: t('content.radio.feedback.saved') },
      });
      await validateTuneIn(trimmed);
    } catch (err) {
      setRadioState({
        feedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.radio.feedback.saveFailed'),
        },
      });
    } finally {
      setRadioState({ saving: false });
    }
  };

  const handleSaveSpotify = async (): Promise<void> => {
    if (!spotifyDirty || spotifySaving) return;
    setSpotifyState({ saving: true, feedback: null });
    try {
      await updateContentConfig({
        spotify: {
          clientId: spotifyClientId.trim() || null,
          cacheEnabled: spotifyCacheEnabled,
          cacheSizeMb: spotifyCacheSizeMb,
        },
      });
      setSpotifyState({
        initialClientId: spotifyClientId,
        initialCacheEnabled: spotifyCacheEnabled,
        initialCacheSizeMb: spotifyCacheSizeMb,
        feedback: { type: 'success', message: t('content.spotify.feedback.saved') },
      });
    } catch (err) {
      setSpotifyState({
        feedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.spotify.feedback.saveFailed'),
        },
      });
    } finally {
      setSpotifyState({ saving: false });
    }
  };

  const stickyAction = React.useMemo(() => {
    if (modalOpen) return null;
    if (contentFilter === 'radio' && radioDirty) {
      return {
        label: t('content.radio.stickySave'),
        busy: radioSaving,
        onClick: () => void handleSaveRadio(),
      };
    }
    if (contentFilter === 'streaming' && spotifyDirty) {
      return {
        label: t('content.spotify.stickySave'),
        busy: spotifySaving,
        onClick: () => void handleSaveSpotify(),
      };
    }
    return null;
  }, [contentFilter, modalOpen, radioDirty, radioSaving, spotifyDirty, spotifySaving, t]);

  const handleDeleteSpotifyAccount = async (accountKey: string): Promise<void> => {
    if (!accountKey || deletingAccountId === accountKey) return;
    setSpotifyState({ deletingAccountId: accountKey, feedback: null });
    try {
      await deleteSpotifyAccount(accountKey);
      setSpotifyState((prev) => ({
        accounts: prev.accounts.filter((account) => resolveAccountKey(account) !== accountKey),
        feedback: { type: 'success', message: t('content.spotify.feedback.removed') },
      }));
    } catch (err) {
      setSpotifyState({
        feedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.spotify.feedback.removeFailed'),
        },
      });
    } finally {
      setSpotifyState({ deletingAccountId: null });
    }
  };

  /**
   * Hand the server a set of playback credentials from the Spotify app.
   *
   * Spotify only accepts credentials that came out of a real handshake, so the server advertises
   * itself as a device and someone has to pick it. Nothing happens until they do, which is why this
   * polls rather than waiting on the request.
   */
  const handlePairSpotifyAccount = async (accountKey: string): Promise<void> => {
    if (!accountKey || pairingAccountId) return;
    setSpotifyState({ pairingAccountId: accountKey, feedback: null });
    try {
      const started = await startSpotifyPairing(accountKey);
      const deviceName = started.deviceName ?? t('content.spotify.pair.defaultDeviceName');
      setSpotifyState({
        feedback: { type: 'success', message: t('content.spotify.pair.waiting', { deviceName }) },
      });

      // Poll until the server reaches a verdict rather than counting down to `expiresAt`. When a
      // handshake was already running, that timestamp belongs to the earlier attempt and can be in
      // the past, which used to end the loop before it polled once — reporting "not picked" the
      // instant the button was pressed. The server owns the timeout; here we only need a stop.
      const giveUpAt = Date.now() + 6 * 60_000;
      while (Date.now() < giveUpAt) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const status = await fetchSpotifyPairingStatus(accountKey);
        if (status.state === 'paired') {
          setSpotifyState({
            feedback: { type: 'success', message: t('content.spotify.pair.paired') },
          });
          scheduleSpotifyAccountRefresh();
          return;
        }
        if (status.state === 'failed' || status.state === 'idle') {
          setSpotifyState({
            feedback: { type: 'error', message: t('content.spotify.pair.notPicked') },
          });
          return;
        }
      }
      setSpotifyState({
        feedback: { type: 'error', message: t('content.spotify.pair.notPicked') },
      });
    } catch (err) {
      setSpotifyState({
        feedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.spotify.pair.failed'),
        },
      });
    } finally {
      setSpotifyState({ pairingAccountId: null });
    }
  };

  const handleAddSpotifyAccount = async (): Promise<void> => {
    if (addingSpotifyAccount) return;
    setSpotifyState({ addingAccount: true, feedback: null });
    try {
      const { link } = await fetchSpotifyAuthLink();
      if (!link) {
        throw new Error(t('content.spotify.feedback.noLink'));
      }
      window.open(link, '_blank', 'noopener,noreferrer');
      setSpotifyState({
        feedback: {
          type: 'success',
          message: t('content.spotify.feedback.loginFlow'),
        },
      });
      scheduleSpotifyAccountRefresh();
    } catch (err) {
      setSpotifyState({
        feedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.spotify.feedback.loginFailed'),
        },
      });
    } finally {
      setSpotifyState({ addingAccount: false });
    }
  };

  const handleLibraryRescan = async (): Promise<void> => {
    setLibraryActionPending(true);
    setLibraryMessage(null);
    setLibraryError(null);
    try {
      await triggerLibraryRescan();
      setLibraryMessage(t('content.library.feedback.rescanStarted'));
      await refreshLibraryStatus(false);
      scheduleLibraryCoverRefresh();
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : t('content.library.feedback.rescanFailed'));
    } finally {
      setLibraryActionPending(false);
    }
  };

  const handleLibraryUploadFiles = async (files: DroppedUpload[]): Promise<void> => {
    if (libraryUploading) return;
    const audioFiles = files.filter((entry) => isAudioFilename(entry.file.name));
    if (audioFiles.length === 0) {
      setLibraryUploadFeedback({
        type: 'error',
        message: t('content.library.feedback.noSupportedFiles'),
      });
      return;
    }
    setLibraryUploading(true);
    setLibraryUploadFeedback(null);
    setLibraryError(null);
    try {
      for (const entry of audioFiles) {
        // Keep the folder structure the user dropped; fall back to the bare
        // filename for a loose file. The path is preserved verbatim server-side.
        const dropped = entry.relativePath ?? entry.file.webkitRelativePath ?? '';
        const relativePath = dropped.replace(/\\/g, '/').replace(/^\/+/, '') || entry.file.name;
        await uploadLibraryFile(entry.file, relativePath);
      }
      const skipped = files.length - audioFiles.length;
      const suffix = skipped > 0 ? t('content.library.feedback.skipped', { count: skipped }) : '';
      setLibraryUploadFeedback({
        type: 'success',
        message: t('content.library.feedback.uploaded', { count: audioFiles.length, suffix }),
      });
      void refreshLibraryStatus(true);
      scheduleLibraryCoverRefresh();
    } catch (err) {
      setLibraryUploadFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('content.library.feedback.uploadFailed'),
      });
    } finally {
      setLibraryUploading(false);
    }
  };

  const formatLibraryDeleteMessage = (
    result?: { deletedTracks?: number; deletedFiles?: number; missingFiles?: number },
  ): string => {
    const deletedTracks = Number(result?.deletedTracks ?? 0);
    const deletedFiles = Number(result?.deletedFiles ?? 0);
    const missingFiles = Number(result?.missingFiles ?? 0);
    const trackWord = deletedTracks === 1 ? 'track' : 'tracks';
    const fileWord = deletedFiles === 1 ? 'file' : 'files';
    const missing = missingFiles > 0 ? `, ${missingFiles} already missing` : '';
    return t('content.library.feedback.deleteSuccess', {
      tracks: deletedTracks,
      trackWord,
      files: deletedFiles,
      fileWord,
      missing,
    });
  };

  const handleDeleteLibraryAlbum = async (cover: LibraryCoverSample): Promise<void> => {
    if (!cover?.id || libraryDeletingAlbumId) return;
    const ok = await confirm({
      title: t('content.library.feedback.deleteTitle'),
      message: t('content.library.feedback.deleteMessage'),
      confirmLabel: t('content.library.feedback.deleteConfirm'),
      cancelLabel: t('content.library.feedback.deleteCancel'),
      tone: 'danger',
    });
    if (!ok) return;
    setLibraryDeletingAlbumId(cover.id);
    setLibraryDeleteFeedback(null);
    try {
      const payload = await deleteLibraryAlbum(cover.id);
      setLibraryDeleteFeedback({ type: 'success', message: formatLibraryDeleteMessage(payload.result) });
      await refreshLibraryStatus(false);
      await refreshLibraryCovers(false);
    } catch (err) {
      setLibraryDeleteFeedback({ type: 'error', message: err instanceof Error ? err.message : t('content.library.feedback.deleteFailed') });
    } finally {
      setLibraryDeletingAlbumId(null);
    }
  };

  const handleSaveLibraryStorage = async (): Promise<void> => {
    if (storageSubmitting || !storageFormValid) return;
    setStorageSubmitting(true);
    setStorageFeedback(null);
    const previous = storageEditingId ? libraryStorages.find((entry) => entry.id === storageEditingId) : null;
    const usernameInput = storageForm.username.trim();
    const passwordInput = storageForm.password.trim();
    const options = extractExtraCifsOptions(storageForm.options, storageForm).join(',');
    const draftPayload = {
      name: storageForm.name.trim(),
      server: storageForm.server.trim(),
      folder: storageForm.folder.trim(),
      type: 'cifs',
      guest: storageForm.guest,
      username: storageForm.guest ? undefined : usernameInput || previous?.username || undefined,
      password: storageForm.guest ? undefined : passwordInput || previous?.password || undefined,
      options: options.trim() || undefined,
    };
    try {
      const payload = storageEditingId
        ? await (async () => {
            await deleteLibraryStorage(storageEditingId);
            try {
              return await createLibraryStorage({ ...draftPayload, id: storageEditingId });
            } catch (createErr) {
              if (previous) {
                try {
                  await createLibraryStorage({
                    id: previous.id,
                    name: previous.name,
                    server: previous.server,
                    folder: previous.folder,
                    type: previous.type || 'cifs',
                    guest: previous.guest,
                    username: previous.guest ? undefined : previous.username,
                    password: previous.guest ? undefined : previous.password,
                    options: previous.options,
                  });
                } catch {
                  // Best effort rollback; if this fails we still surface the original error.
                }
              }
              throw createErr;
            }
          })()
        : await createLibraryStorage(draftPayload);
      setLibraryStorages((prev) => {
        const filtered = prev.filter((entry) => entry.id !== payload.storage.id);
        return sortStorages([...filtered, payload.storage]);
      });
      setStorageFeedback({
        type: 'success',
        message: storageEditingId ? t('content.library.feedback.shareUpdated') : t('content.library.feedback.shareAdded'),
      });
      setStorageError(null);
      closeStorageModal(false);
    } catch (err) {
      setStorageFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : storageEditingId ? t('content.library.feedback.updateFailed') : t('content.library.feedback.addFailed'),
      });
      await refreshLibraryStorages();
    } finally {
      setStorageSubmitting(false);
    }
  };

  const updateStorageForm = (patch: Partial<StorageFormState>): void => {
    setStorageForm((prev) => ({ ...prev, ...patch }));
  };
  const updateCustomRadioForm = (patch: Partial<CustomRadioFormState>): void => {
    setCustomRadioForm((prev) => ({ ...prev, ...patch }));
  };
  const updateBridgeForm = (patch: Partial<BridgeFormState>): void => {
    setSpotifyState((prev) => {
      const next = { ...prev.bridgeForm, ...patch };
      // Switching provider re-syncs the display name to that provider's default,
      // unless the user has already typed a custom name.
      if (patch.provider && patch.provider !== prev.bridgeForm.provider) {
        const prevDefault = defaultBridgeLabel(prev.bridgeForm.provider);
        if (!prev.bridgeForm.label.trim() || prev.bridgeForm.label === prevDefault) {
          next.label = defaultBridgeLabel(patch.provider);
        }
      }
      return { bridgeForm: next };
    });
  };

  // Opens the MusicKit sign-in as an in-portal modal (iframe), not a new tab.
  const handleAppleMusicSignIn = (): void => {
    setAppleAuthOpen(true);
  };

  // While the sign-in modal is open, receive the token (or a close request) the iframe posts back.
  React.useEffect(() => {
    if (!appleAuthOpen) return undefined;
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== origin) return;
      const data = event.data as { type?: string; token?: string; height?: number } | null;
      if (!data) return;
      if (data.type === 'applemusic-auth-height' && typeof data.height === 'number') {
        setAppleAuthHeight(Math.max(120, Math.min(600, Math.ceil(data.height))));
        return;
      }
      if (data.type === 'applemusic-auth-close') {
        setAppleAuthOpen(false);
        return;
      }
      if (data.type !== 'applemusic-token' || typeof data.token !== 'string' || !data.token) return;
      updateBridgeForm({ userToken: data.token });
      setSpotifyState({ bridgeFeedback: { type: 'success', message: t('content.bridge.apple.signInSuccess') } });
      setAppleAuthOpen(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appleAuthOpen]);

  const handleDropFiles = async (dataTransfer: DataTransfer): Promise<void> => {
    const files = await collectFilesFromDataTransfer(dataTransfer);
    if (files.length === 0) {
      setLibraryUploadFeedback({ type: 'error', message: t('content.library.feedback.noFilesInDrop') });
      return;
    }
    await handleLibraryUploadFiles(files);
  };

  const handleCustomRadioAdd = async (): Promise<void> => {
    if (customRadioSubmitting || !customRadioFormValid) return;
    setCustomRadioSubmitting(true);
    setCustomRadioFeedback(null);
    try {
      const station = await createCustomRadioStation({
        name: customRadioForm.name.trim(),
        stream: customRadioForm.stream.trim(),
        coverurl: customRadioForm.coverurl.trim() || undefined,
      });
      setCustomRadios((prev) => [...prev, station]);
      setCustomRadioFeedback({ type: 'success', message: 'Station added' });
      setCustomRadioForm(createEmptyCustomRadioForm());
      closeCustomRadioModal(false);
    } catch (err) {
      setCustomRadioFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to add stream',
      });
    } finally {
      setCustomRadioSubmitting(false);
    }
  };

  const handleCustomRadioDelete = async (id: string): Promise<void> => {
    if (!id) return;
    setCustomRadioFeedback(null);
    try {
      await deleteCustomRadioStation(id);
      setCustomRadios((prev) => prev.filter((station) => station.id !== id));
      setCustomRadioFeedback({ type: 'success', message: 'Station removed' });
    } catch (err) {
      setCustomRadioFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove stream',
      });
    }
  };

  const handleBridgeAdd = async (): Promise<void> => {
    if (bridgeSubmitting || !bridgeFormValid) return;
    setSpotifyState({ bridgeSubmitting: true, bridgeFeedback: null });
    const provider = bridgeForm.provider.toLowerCase() as BridgeFormState['provider'];
    const payload: CreateSpotifyBridgePayload = {
      provider,
    };
    if (bridgeEditingId) {
      payload.id = bridgeEditingId;
    }
    // Custom display name (falls back on the server to a per-provider default when blank).
    const trimmedLabel = bridgeForm.label.trim();
    if (trimmedLabel) {
      payload.label = trimmedLabel;
    } else if (bridgeEditingId && bridgeEditingLabel) {
      payload.label = bridgeEditingLabel;
    }
    if (provider === 'musicassistant') {
      payload.host = bridgeForm.host.trim() || '127.0.0.1';
      payload.port =
        typeof bridgeForm.port === 'number' && Number.isFinite(bridgeForm.port) && bridgeForm.port > 0
          ? Math.round(bridgeForm.port)
          : 8095;
      payload.apiKey = bridgeForm.apiKey.trim();
      payload.mode = bridgeForm.mode === 'sink' ? 'sink' : 'source';
    }
    if (provider === 'applemusic') {
      if (bridgeForm.userToken.trim()) payload.userToken = bridgeForm.userToken.trim();
    }
    if (provider === 'ytmusic') {
      if (bridgeForm.ytmusicCookie.trim()) payload.ytmusicCookie = bridgeForm.ytmusicCookie.trim();
    }
    if (provider === 'deezer') {
      if (bridgeForm.deezerArl.trim()) payload.deezerArl = bridgeForm.deezerArl.trim();
    }
    if (provider === 'tidal') {
      if (bridgeForm.tidalAccessToken.trim()) {
        payload.tidalAccessToken = bridgeForm.tidalAccessToken.trim();
      }
      if (bridgeForm.tidalCountryCode.trim()) {
        payload.tidalCountryCode = bridgeForm.tidalCountryCode.trim().toUpperCase();
      }
    }
    if (provider === 'youtube') {
      if (bridgeForm.youtubeApiKey.trim()) payload.youtubeApiKey = bridgeForm.youtubeApiKey.trim();
    }
    if (provider === 'soundcloud') {
      if (bridgeForm.soundcloudOauthToken.trim()) payload.soundcloudOauthToken = bridgeForm.soundcloudOauthToken.trim();
    }
    try {
      const { bridge } = await createSpotifyBridge(payload);
      const normalized = normalizeBridge(bridge);
      setSpotifyState((prev) => ({
        bridges: [
          ...prev.bridges.filter((b) => (b.id || '').toLowerCase() !== normalized.id.toLowerCase()),
          normalized,
        ],
        bridgeFeedback: {
          type: 'success',
          message: bridgeEditingId ? t('content.bridge.feedback.updated') : t('content.bridge.feedback.added'),
        },
      }));
      closeBridgeModal(false);
    } catch (err) {
      setSpotifyState({
        bridgeFeedback: {
          type: 'error',
          message: err instanceof Error ? err.message : bridgeEditingId ? t('content.bridge.feedback.updateFailed') : t('content.bridge.feedback.addFailed'),
        },
      });
    } finally {
      setSpotifyState({ bridgeSubmitting: false });
    }
  };

  const handleBridgeDelete = async (id: string): Promise<void> => {
    if (!id || bridgeDeletingId === id) return;
    setSpotifyState({ bridgeDeletingId: id, bridgeFeedback: null });
    try {
      await deleteSpotifyBridge(id);
      setSpotifyState((prev) => ({
        bridges: prev.bridges.filter((bridge) => bridge.id !== id),
        bridgeFeedback: { type: 'success', message: t('content.bridge.feedback.removed') },
      }));
    } catch (err) {
      setSpotifyState({
        bridgeFeedback: {
          type: 'error',
          message: err instanceof Error ? err.message : t('content.bridge.feedback.removeFailed'),
        },
      });
    } finally {
      setSpotifyState({ bridgeDeletingId: null });
    }
  };

  const persistLineInInputs = React.useCallback(
    async (inputs: LineInInputConfig[]): Promise<void> => {
      await updateInputsConfig({
        lineIn: {
          inputs: inputs.map((entry) => ({
            id: entry.id,
            name: entry.name,
            iconType: entry.iconType,
            metadataEnabled: entry.metadataEnabled,
            controllable: entry.controllable,
            autoPlayZoneId: entry.autoPlayZoneId,
            source: entry.source ?? {},
          })),
        },
      });
    },
    [],
  );

  const handleLineInSave = React.useCallback(async (): Promise<void> => {
    if (lineInSubmitting) return;
    const name = lineInForm.name.trim();
    if (!name) return;
    if (lineInForm.sourceType === 'sendspin' && !lineInForm.sendspinClientId.trim()) return;
    setLineInSubmitting(true);
    try {
      const parsedAutoPlayZoneId = parseNumberOrNull(lineInForm.autoPlayZoneId);
      const autoPlayZoneId =
        lineInForm.sourceType === 'sendspin' && parsedAutoPlayZoneId != null && parsedAutoPlayZoneId > 0
          ? Math.floor(parsedAutoPlayZoneId)
          : undefined;
      const nextInputs = [...lineInInputs];
      if (lineInEditingId) {
        const idx = nextInputs.findIndex((entry) => entry.id === lineInEditingId);
        const nextSource: Record<string, unknown> = {
          ...(nextInputs[idx]?.source ?? {}),
          type: lineInForm.sourceType,
        };
        if (lineInForm.sourceType === 'sendspin' && lineInForm.sendspinClientId.trim()) {
          nextSource.clientId = lineInForm.sendspinClientId.trim();
          const threshold = parseNumberOrNull(lineInForm.vadThresholdDb);
          const holdMs = parseNumberOrNull(lineInForm.vadHoldMs);
          // The format is the client's to announce, so it is not stored here — and an older entry
          // that still carries one is cleared on save, because a stored number outranks the
          // hardware and that is exactly the mistake being undone.
          delete nextSource.sample_rate;
          delete nextSource.channels;
          delete nextSource.bit_depth;
          delete nextSource.codec;
          if (threshold != null) {
            nextSource.vad_threshold_db = threshold;
          } else {
            delete nextSource.vad_threshold_db;
          }
          if (holdMs != null) {
            nextSource.vad_hold_ms = holdMs;
          } else {
            delete nextSource.vad_hold_ms;
          }
          delete nextSource.ingest_sample_rate;
          delete nextSource.ingest_channels;
          delete nextSource.ingest_bit_depth;
          delete nextSource.ingest_codec;
        } else if ('clientId' in nextSource) {
          delete nextSource.clientId;
        }
        if (lineInForm.sourceType !== 'sendspin') {
          delete nextSource.vad_threshold_db;
          delete nextSource.vad_hold_ms;
          delete nextSource.ingest_sample_rate;
          delete nextSource.sample_rate;
          delete nextSource.channels;
          delete nextSource.bit_depth;
          delete nextSource.codec;
        }
        const nextEntry: LineInInputConfig = {
          id: lineInEditingId,
          name,
          iconType: lineInForm.iconType ?? LineInIconType.CdPlayer,
          metadataEnabled: lineInForm.metadataEnabled,
          controllable: lineInForm.controllable || undefined,
          autoPlayZoneId,
          source: nextSource,
        };
        if (idx >= 0) {
          nextInputs[idx] = nextEntry;
        } else {
          nextInputs.push(nextEntry);
        }
      } else {
        const nextId = lineInForm.draftId || createLineInId();
        const nextSource: Record<string, unknown> = { type: lineInForm.sourceType };
        if (lineInForm.sourceType === 'sendspin' && lineInForm.sendspinClientId.trim()) {
          nextSource.clientId = lineInForm.sendspinClientId.trim();
          const threshold = parseNumberOrNull(lineInForm.vadThresholdDb);
          const holdMs = parseNumberOrNull(lineInForm.vadHoldMs);
          const ingestSampleRate = parseNumberOrNull(lineInForm.ingestSampleRate);
          const ingestChannels = parseNumberOrNull(lineInForm.ingestChannels);
          const ingestBitDepth = parseNumberOrNull(lineInForm.ingestBitDepth);
          const ingestCodec = lineInForm.ingestCodec.trim();
          if (ingestSampleRate != null && ingestSampleRate > 0) {
            nextSource.sample_rate = ingestSampleRate;
          }
          if (ingestChannels != null && ingestChannels > 0) {
            nextSource.channels = ingestChannels;
          }
          if (ingestBitDepth != null && ingestBitDepth > 0) {
            nextSource.bit_depth = ingestBitDepth;
          }
          if (ingestCodec) {
            nextSource.codec = ingestCodec;
          }
          if (threshold != null) {
            nextSource.vad_threshold_db = threshold;
          }
          if (holdMs != null) {
            nextSource.vad_hold_ms = holdMs;
          }
        }
        nextInputs.push({
          id: nextId,
          name,
          iconType: lineInForm.iconType ?? LineInIconType.CdPlayer,
          metadataEnabled: lineInForm.metadataEnabled,
          controllable: lineInForm.controllable || undefined,
          autoPlayZoneId,
          source: nextSource,
        });
      }
      await persistLineInInputs(nextInputs);
      setLineInInputs(nextInputs);
      closeLineInModal();
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('content.linein.feedback.updateFailedTitle'),
        message: err instanceof Error ? err.message : t('content.linein.feedback.updateFailedDefault'),
      });
    } finally {
      setLineInSubmitting(false);
    }
  }, [closeLineInModal, lineInEditingId, lineInForm, lineInInputs, lineInSubmitting, persistLineInInputs, pushAlert, t]);

  const handleSendspinDiscovery = React.useCallback(async (): Promise<void> => {
    if (sendspinLoading) return;
    setSendspinLoading(true);
    setSendspinError(null);
    try {
      const clients = await discoverSendspinSources();
      setSendspinClients(clients);
      if (!clients.length) {
        setSendspinError(t('content.linein.sendspin.noClients'));
      }
    } catch (err) {
      setSendspinClients([]);
      setSendspinError(err instanceof Error ? err.message : t('content.linein.sendspin.discoveryFailed'));
    } finally {
      setSendspinLoading(false);
    }
  }, [sendspinLoading, t]);

  React.useEffect(() => {
    const needsSendspin = contentFilter === 'linein' || (lineInModalOpen && lineInForm.sourceType === 'sendspin');
    if (!needsSendspin) return;
    void handleSendspinDiscovery();
    const timer = window.setInterval(() => {
      void handleSendspinDiscovery();
    }, SENDSPIN_STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [contentFilter, lineInModalOpen, lineInForm.sourceType, lineInInputs, handleSendspinDiscovery]);

  const handleLineInRemove = React.useCallback(
    async (inputId: string, inputName?: string): Promise<void> => {
      if (!inputId && !inputName) return;
      const nextInputs = lineInInputs.filter((entry) => {
        if (inputId) return entry.id !== inputId;
        return entry.name !== inputName;
      });
      try {
        await persistLineInInputs(nextInputs);
        setLineInInputs(nextInputs);
      } catch (err) {
        pushAlert({
          tone: 'error',
          title: t('content.linein.feedback.updateFailedTitle'),
          message: err instanceof Error ? err.message : t('content.linein.feedback.removeFailedDefault'),
        });
      }
    },
    [lineInInputs, persistLineInInputs, pushAlert, t],
  );

  // Local folder and network shares are presented as one list of interchangeable
  // sources: same row, same stats, same browser. `storage` is null for the local
  // one, which is what makes it non-editable and upload-capable.
  const librarySources = React.useMemo(() => {
    const local = {
      id: 'local',
      name: t('content.library.summary.local'),
      tracks: libraryTrackCount ?? 0,
      albums: libraryAlbumCount ?? 0,
      artists: libraryArtistCount ?? 0,
      indexed: (libraryTrackCount ?? 0) > 0,
      path: 'data/music/local',
      storage: null as LibraryStorage | null,
    };
    const shares = libraryStorages.map((storage) => {
      const stats = libraryStorageStats[storage.id];
      return {
        id: storage.id,
        name: storage.name || storage.server || t('content.library.share.default'),
        tracks: stats?.tracks ?? 0,
        albums: stats?.albums ?? 0,
        artists: stats?.artists ?? 0,
        indexed: (stats?.tracks ?? 0) > 0,
        path: `${storage.server ?? ''}${storage.folder ? `/${storage.folder.replace(/^\//, '')}` : ''}`,
        storage,
      };
    });
    return [local, ...shares];
  }, [libraryAlbumCount, libraryArtistCount, libraryStorageStats, libraryStorages, libraryTrackCount, t]);

  const activeLibrarySource =
    librarySources.find((source) => source.id === librarySourceId) ?? librarySources[0];

  // A removed share must not leave the browser pointing at a source that is gone.
  React.useEffect(() => {
    if (!librarySources.some((source) => source.id === librarySourceId)) {
      setLibrarySourceId('local');
    }
  }, [librarySourceId, librarySources]);

  if (loading) {
    return (
      <div className="content-layout">
        <div className="content-shell panel shell-glass">
          <InlineState kind="loading" title={t('content.loading.title')} message={t('content.loading.message')} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="content-layout">
        <div className="content-shell panel shell-glass">
          <InlineState
            kind="error"
            title={t('content.errorState.title')}
            message={error}
            action={{ label: t('content.errorState.retry'), onClick: () => void refreshContent() }}
          />
        </div>
      </div>
    );
  }

  const statusMeta = formatScanStatus(libraryStatus);
  const renderHeroStatValue = (value: number | null, loadingState: boolean): string => {
    if (loadingState) return '…';
    if (value == null) return '–';
    return value.toString();
  };
  const heroStats = [
    { label: t('content.stats.customStreams'), value: customRadios.length, loading: customRadioLoading },
    {
      label: t('content.stats.libraryTracks'),
      value: libraryTrackCount ?? 0,
      loading: libraryLoading || libraryTrackCount == null,
    },
    { label: t('content.stats.spotifyAccounts'), value: spotifyAccounts.length, loading: false },
    {
      label: t('content.stats.activeBridges'),
      value: spotifyBridges.filter((bridge) => bridge.enabled !== false).length,
      loading: false,
    },
  ];
  const hasSpotifyClientId = spotifyClientId.trim().length > 0;
  const tuneInStatusLabel = (() => {
    switch (radioValidationStatus) {
      case 'checking':
        return t('content.radio.validation.checking');
      case 'valid':
        return t('content.radio.validation.verified');
      case 'invalid':
        return t('content.radio.validation.notFound');
      case 'error':
        return t('content.radio.validation.error');
      default:
        return '';
    }
  })();
  const tuneInStatusTone =
    radioValidationStatus === 'valid' || radioValidationStatus === 'checking'
      ? 'active'
      : radioValidationStatus === 'invalid'
        ? 'warn'
        : radioValidationStatus === 'error'
          ? 'error'
          : 'idle';
  const widevineStatus = appleMusicWidevineStatus?.status ?? 'error';
  const widevineTone =
    appleMusicWidevineLoading
      ? 'idle'
      : widevineStatus === 'valid'
        ? 'active'
        : widevineStatus === 'missing' || widevineStatus === 'invalid'
          ? 'warn'
          : widevineStatus === 'error'
            ? 'error'
            : 'idle';
  const widevineLabel =
    appleMusicWidevineLoading
      ? t('content.bridge.apple.widevineChecking')
      : widevineStatus === 'valid'
        ? t('content.bridge.apple.widevineReady')
        : widevineStatus === 'missing'
          ? t('content.bridge.apple.widevineMissing')
          : widevineStatus === 'invalid'
            ? t('content.bridge.apple.widevineInvalid')
        : t('content.bridge.apple.widevineFailed');

  const widevineFiles = appleMusicWidevineStatus?.files;
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  };
  const showUploadedBadge = (ts: number): boolean => ts > 0 && Date.now() - ts < 60_000;
  const visibleSpotifyAccounts = spotifyAccounts.filter(
    (account) =>
      resolveAccountKey(account) ||
      account.displayName ||
      account.name ||
      account.user ||
      account.email,
  );
  const SUB_TABS: Array<{ key: ContentFilterKey; label: string }> = [
    { key: 'radio', label: t('content.subTabs.radio') },
    { key: 'library', label: t('content.subTabs.library') },
    { key: 'linein', label: t('content.subTabs.linein') },
    { key: 'streaming', label: t('content.subTabs.streaming') },
  ];

  const stubModal = (label: string): void => {
    pushAlert({
      tone: 'warn',
      title: t('content.comingSoon.title'),
      message: t('content.comingSoon.message', { label }),
    });
  };

  const handleDropZoneFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    const transfer = new DataTransfer();
    Array.from(files).forEach((file) => transfer.items.add(file));
    void handleDropFiles(transfer);
  };

  return (
    <div className="content-layout">
      <header className="content-head">
        <p className="content-eyebrow">{t('content.eyebrow')}</p>
        <h1 className="content-title">{t('content.title')}</h1>
        <p className="content-subtitle">
          {t('content.subtitle')}
        </p>
        <div className="content-stats">
          <div className="content-stat">
            <span className="content-stat__label">{t('content.stats.customStreams')}</span>
            <span className="content-stat__value">{customRadios.length}</span>
          </div>
          <div className="content-stat">
            <span className="content-stat__label">{t('content.stats.libraryTracks')}</span>
            <span className="content-stat__value">{libraryTrackCount ?? 0}</span>
          </div>
          <div className="content-stat">
            <span className="content-stat__label">{t('content.stats.spotifyAccounts')}</span>
            <span className="content-stat__value">{spotifyAccounts.length}</span>
          </div>
          <div className="content-stat">
            <span className="content-stat__label">{t('content.stats.activeBridges')}</span>
            <span className="content-stat__value">{spotifyBridges.length}</span>
          </div>
        </div>
      </header>

      <SubTabs
        ariaLabel={t('content.subTabs.ariaLabel')}
        active={contentFilter}
        onChange={setContentFilter}
        tabs={SUB_TABS}
      />

      <SubPanel key={displayedFilter} isLeaving={panelLeaving}>

      {/* ============ RADIO ============ */}
      {displayedFilter === 'radio' ? (
        <div className="source-layout">
          <aside className="source-aside">
            <span className="source-aside__eyebrow">{t('content.aside.eyebrow')}</span>
            <h2 className="source-aside__title">{t('content.radio.title')}</h2>
            <p className="source-aside__desc">
              {t('content.radio.desc')}
            </p>
            <div className="source-aside__actions">
              <button
                type="button"
                className="content-btn content-btn--primary"
                onClick={() => setRadioPickerOpen(true)}
              >
                {t('content.radio.providers.add')}
              </button>
            </div>

            <div className="library-summary">
              <div className="library-summary__row">
                <span
                  className={`library-summary__dot${
                    radioValidationStatus === 'valid' && (radioPresetCount ?? 0) > 0 ? '' : ' is-off'
                  }`}
                />
                <span className="library-summary__label">
                  <strong>{t('content.radio.summary.tunein')}</strong> ·{' '}
                  {(radioPresetCount ?? 0) > 0
                    ? t('content.radio.summary.presets', { count: radioPresetCount ?? 0 })
                    : t('content.radio.summary.notConfigured')}
                </span>
              </div>
              <div className="library-summary__row">
                <span
                  className={`library-summary__dot${customRadios.length > 0 ? '' : ' is-off'}`}
                />
                <span className="library-summary__label">
                  <strong>{t('content.radio.summary.custom')}</strong> ·{' '}
                  {customRadios.length > 0
                    ? t('content.radio.summary.streams', { count: customRadios.length })
                    : t('content.radio.summary.none')}
                </span>
              </div>
              <div className="library-summary__row">
                <span
                  className={`library-summary__dot${radioParadiseEnabled ? '' : ' is-off'}`}
                />
                <span className="library-summary__label">
                  <strong>{t('content.radio.summary.radioParadise')}</strong> · {radioParadiseEnabled ? t('content.radio.summary.on') : t('content.radio.summary.off')}
                </span>
              </div>
              <div className="library-summary__foot">
                {t('content.radio.summary.active', {
                  count: [
                    radioValidationStatus === 'valid' && (radioPresetCount ?? 0) > 0,
                    customRadios.length > 0,
                    radioParadiseEnabled,
                  ].filter(Boolean).length,
                })}
              </div>
            </div>
          </aside>

          <div className="source-cards">
            <div className="source-card">
              <div className="source-card__head">
                <div className="source-card__head-text">
                  <h3 className="source-card__title">{t('content.radio.providers.title')}</h3>
                  <p className="source-card__desc">{t('content.radio.providers.desc')}</p>
                </div>
              </div>
              {radioUsername.trim() || radioParadiseEnabled ? (
                <div className="content-list">
                  {radioUsername.trim() ? (
                    <div className="content-list-row">
                      <div className="content-list-row__main">
                        <div className="content-list-row__title">{t('content.radio.tunein.title')}</div>
                        <div className="content-list-row__meta">
                          {(radioPresetCount ?? 0) > 0
                            ? t('content.radio.summary.presets', { count: radioPresetCount ?? 0 })
                            : radioUsername}
                        </div>
                      </div>
                      <div className="content-list-row__actions">
                        <button
                          type="button"
                          className="content-btn"
                          onClick={() => setTuneInModalOpen(true)}
                        >
                          {t('content.custom.edit')}
                        </button>
                        <button
                          type="button"
                          className="content-btn content-btn--danger"
                          onClick={() => void handleRemoveTuneIn()}
                        >
                          {t('content.custom.remove')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {radioParadiseEnabled ? (
                    <div className="content-list-row">
                      <div className="content-list-row__main">
                        <div className="content-list-row__title">{t('content.radio.radioParadise.title')}</div>
                        <div className="content-list-row__meta">{t('content.radio.providers.radioBadge')}</div>
                      </div>
                      <div className="content-list-row__actions">
                        <button
                          type="button"
                          className="content-btn content-btn--danger"
                          onClick={() => void handleToggleRadioParadise(false)}
                        >
                          {t('content.custom.remove')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="content-empty-info">
                  <span className="content-empty-info__icon">i</span>
                  <div className="content-empty-info__text">
                    <div className="content-empty-info__title">{t('content.radio.providers.emptyTitle')}</div>
                    <div className="content-empty-info__sub">{t('content.radio.providers.emptySub')}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="source-card">
              <div className="source-card__head">
                <span className="source-card__chip" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h16M4 6h10M4 18h7" />
                    <circle cx="19" cy="18" r="2" />
                  </svg>
                </span>
                <div className="source-card__head-text">
                  <h3 className="source-card__title">{t('content.radio.custom.title')}</h3>
                  <p className="source-card__desc">{t('content.radio.custom.desc')}</p>
                </div>
              </div>
              {customRadios.length === 0 ? (
                <div className="content-empty-info">
                  <span className="content-empty-info__icon">i</span>
                  <div className="content-empty-info__text">
                    <div className="content-empty-info__title">{t('content.radio.custom.emptyTitle')}</div>
                    <div className="content-empty-info__sub">{t('content.radio.custom.emptySub')}</div>
                  </div>
                </div>
              ) : (
                <div className="content-list">
                  {customRadios.map((stream) => (
                    <div key={stream.id} className="content-list-row">
                      <div className="content-list-row__main">
                        <div className="content-list-row__title">{stream.name}</div>
                        <div className="content-list-row__meta">{stream.stream}</div>
                      </div>
                      <div className="content-list-row__actions">
                        <button
                          type="button"
                          className="content-btn content-btn--danger"
                          onClick={() => void handleCustomRadioDelete(stream.id)}
                        >
                          {t('content.radio.custom.remove')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="source-card__foot-row">
                <span className="source-card__foot-count">
                  {t('content.radio.custom.configured', { count: customRadios.length })}
                </span>
                <button
                  type="button"
                  className="content-btn content-btn--primary"
                  onClick={openCustomRadioModal}
                  disabled={customRadioModalOpen}
                >
                  {t('content.radio.custom.add')}
                </button>
              </div>
              <InlineForm
                open={customRadioModalOpen}
                eyebrow={t('content.radio.custom.form.eyebrow')}
                title={t('content.radio.custom.form.title')}
                description={t('content.radio.custom.form.description')}
                cancelLabel={t('content.radio.custom.form.cancel')}
                submitLabel={t('content.radio.custom.form.submit')}
                submitDisabled={!customRadioFormValid}
                busy={customRadioSubmitting}
                onCancel={() => closeCustomRadioModal()}
                onSubmit={() => void handleCustomRadioAdd()}
              >
                <InlineFormField label={t('content.radio.custom.form.nameLabel')}>
                  <input
                    className="inline-form__input"
                    type="text"
                    placeholder={t('content.radio.custom.form.namePlaceholder')}
                    value={customRadioForm.name}
                    onChange={(event) =>
                      setCustomRadioForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    autoFocus
                  />
                </InlineFormField>
                <InlineFormField
                  label={t('content.radio.custom.form.streamLabel')}
                  help={t('content.radio.custom.form.streamHelp')}
                >
                  <input
                    className="inline-form__input is-mono"
                    type="url"
                    placeholder={t('content.radio.custom.form.streamPlaceholder')}
                    value={customRadioForm.stream}
                    onChange={(event) =>
                      setCustomRadioForm((prev) => ({ ...prev, stream: event.target.value }))
                    }
                  />
                </InlineFormField>
                <InlineFormField label={t('content.radio.custom.form.coverLabel')} optional>
                  <input
                    className="inline-form__input is-mono"
                    type="url"
                    placeholder={t('content.radio.custom.form.coverPlaceholder')}
                    value={customRadioForm.coverurl}
                    onChange={(event) =>
                      setCustomRadioForm((prev) => ({ ...prev, coverurl: event.target.value }))
                    }
                  />
                </InlineFormField>
              </InlineForm>
            </div>
          </div>
        </div>
      ) : null}

      {/* ============ LIBRARY ============ */}
      {displayedFilter === 'library' ? (
        <div className="source-layout">
          <aside className="source-aside">
            <span className="source-aside__eyebrow">{t('content.aside.eyebrow')}</span>
            <h2 className="source-aside__title">{t('content.library.title')}</h2>
            <p className="source-aside__desc">{t('content.library.desc')}</p>
            <div className="library-summary">
              <div className="library-summary__foot">
                {t('content.library.summary.sources', {
                  count: librarySources.length,
                  tracks: librarySources.reduce((sum, source) => sum + source.tracks, 0),
                })}
              </div>
            </div>
          </aside>

          <div className="source-cards">
            <InlineForm
              open={storageModalOpen}
              eyebrow={storageEditingId ? t('content.library.form.editEyebrow') : t('content.library.form.newEyebrow')}
              title={storageEditingId ? t('content.library.form.editTitle') : t('content.library.form.newTitle')}
              description={t('content.library.form.description')}
              cancelLabel={t('content.library.form.cancel')}
              submitLabel={storageEditingId ? t('content.library.form.saveShare') : t('content.library.form.addShare')}
              submitDisabled={!storageFormValid}
              busy={storageSubmitting}
              onCancel={() => closeStorageModal()}
              onSubmit={() => void handleSaveLibraryStorage()}
            >
              <div className="inline-form__group-label">{t('content.library.form.groupConnection')}</div>

              <InlineFormField label={t('content.library.form.displayName')}>
                <input
                  className="inline-form__input"
                  type="text"
                  placeholder={t('content.library.form.displayNamePlaceholder')}
                  value={storageForm.name}
                  onChange={(e) => updateStorageForm({ name: e.target.value })}
                  autoFocus
                />
              </InlineFormField>

              <div className="inline-form__grid inline-form__grid--uneven">
                <InlineFormField label={t('content.library.form.server')}>
                  <input
                    className="inline-form__input is-mono"
                    type="text"
                    placeholder={t('content.library.form.serverPlaceholder')}
                    value={storageForm.server}
                    onChange={(e) => updateStorageForm({ server: e.target.value })}
                  />
                </InlineFormField>
                <InlineFormField label={t('content.library.form.folder')}>
                  <input
                    className="inline-form__input is-mono"
                    type="text"
                    placeholder={t('content.library.form.folderPlaceholder')}
                    value={storageForm.folder}
                    onChange={(e) => updateStorageForm({ folder: e.target.value })}
                  />
                </InlineFormField>
              </div>

              <div className="inline-form__group-label">{t('content.library.form.groupAccess')}</div>

              <div className={`inline-form__access${storageForm.guest ? ' is-dimmed' : ''}`}>
                <div className="inline-form__grid">
                  <InlineFormField label={t('content.library.form.username')}>
                    <input
                      className="inline-form__input"
                      type="text"
                      placeholder={t('content.library.form.usernamePlaceholder')}
                      value={storageForm.username}
                      onChange={(e) => updateStorageForm({ username: e.target.value })}
                      disabled={storageForm.guest}
                    />
                  </InlineFormField>
                  <InlineFormField label={t('content.library.form.password')}>
                    <input
                      className="inline-form__input"
                      type="password"
                      placeholder={t('content.library.form.passwordPlaceholder')}
                      value={storageForm.password}
                      onChange={(e) => updateStorageForm({ password: e.target.value })}
                      disabled={storageForm.guest}
                    />
                  </InlineFormField>
                </div>
              </div>

              <div className="inline-form__toggle-row">
                <button
                  type="button"
                  className={`inline-form__toggle${storageForm.guest ? ' is-on' : ''}`}
                  aria-label={t('content.library.form.guestTitle')}
                  onClick={() => updateStorageForm({ guest: !storageForm.guest })}
                />
                <div className="inline-form__toggle-text">
                  <span className="inline-form__toggle-title">{t('content.library.form.guestTitle')}</span>
                  <span className="inline-form__toggle-sub">{t('content.library.form.guestSub')}</span>
                </div>
              </div>

              <button
                type="button"
                className={`inline-form__adv-toggle${storageAdvancedOpen ? ' is-open' : ''}`}
                onClick={() => setStorageAdvancedOpen((v) => !v)}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                {t('content.library.form.advanced')}
              </button>

              <div className={`inline-form__adv-panel${storageAdvancedOpen ? ' is-open' : ''}`}>
                <div className="inline-form__adv-inner">
                  <InlineFormField
                    label={t('content.library.form.cifsLabel')}
                    help={t('content.library.form.cifsHelp')}
                  >
                    <input
                      className="inline-form__input is-mono"
                      type="text"
                      value={storageForm.options}
                      onChange={(e) => updateStorageForm({ options: e.target.value })}
                    />
                  </InlineFormField>
                </div>
              </div>
            </InlineForm>

            {/* One source picker for every library source — the built-in local
                folder and network shares are the same kind of thing here, so they
                get the same row, the same stats and the same browser below. */}
            <div className="source-card">
              <div className="library-sources">
                <div className="library-sources__tabs" role="tablist" aria-label={t('content.library.sources.aria')}>
                  {librarySources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      role="tab"
                      aria-selected={librarySourceId === source.id}
                      className={`library-source${librarySourceId === source.id ? ' is-active' : ''}`}
                      onClick={() => setLibrarySourceId(source.id)}
                    >
                      <span
                        className={`library-source__dot${source.indexed ? '' : ' is-warn'}`}
                        aria-hidden="true"
                      />
                      <span className="library-source__name">{source.name}</span>
                      <span className="library-source__count">{source.tracks}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="library-source library-source--add"
                    onClick={() => openStorageModal()}
                    disabled={storageModalOpen}
                  >
                    {t('content.library.addShare')}
                  </button>
                </div>

                <div className="library-sources__detail">
                  <div className="library-sources__facts">
                    <span className="library-sources__stat">
                      <strong>{activeLibrarySource?.tracks ?? 0}</strong>{' '}
                      {t('content.library.local.stats.tracks').toLowerCase()}
                    </span>
                    <span className="library-sources__stat">
                      <strong>{activeLibrarySource?.albums ?? 0}</strong>{' '}
                      {t('content.library.local.stats.albums').toLowerCase()}
                    </span>
                    <span className="library-sources__stat">
                      <strong>{activeLibrarySource?.artists ?? 0}</strong>{' '}
                      {t('content.library.local.stats.artists').toLowerCase()}
                    </span>
                    {activeLibrarySource?.path ? (
                      <span className="library-sources__path" title={activeLibrarySource.path}>
                        {activeLibrarySource.path}
                      </span>
                    ) : null}
                  </div>

                  <div className="library-sources__actions">
                    <button
                      type="button"
                      className="content-btn content-btn--sm"
                      onClick={() => void handleLibraryRescan()}
                      disabled={libraryActionPending}
                    >
                      {t('content.library.sources.rescan')}
                    </button>
                    {activeLibrarySource && activeLibrarySource.storage ? (
                      <>
                        <button
                          type="button"
                          className="content-btn content-btn--sm"
                          onClick={() => openStorageModal(activeLibrarySource.storage ?? undefined)}
                          disabled={storageModalOpen}
                        >
                          {t('content.library.share.edit')}
                        </button>
                        <button
                          type="button"
                          className="content-btn content-btn--sm content-btn--danger"
                          onClick={() =>
                            void handleDeleteLibraryStorage(activeLibrarySource.id)
                          }
                        >
                          {t('content.library.share.remove')}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {activeLibrarySource && !activeLibrarySource.indexed ? (
                  <div className="library-sources__hint">
                    {activeLibrarySource.storage
                      ? t('content.library.share.scanPromptSub')
                      : t('content.library.sources.localEmpty')}
                  </div>
                ) : null}

                {/* Upload only ever lands in the local folder — a network share is
                    owned by whatever host exports it. */}
                {activeLibrarySource && !activeLibrarySource.storage ? (
                  <label className="content-drop-zone content-drop-zone--slim">
                    <input
                      type="file"
                      multiple
                      accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.wav"
                      onChange={(event) => {
                        handleDropZoneFiles(event.target.files);
                        event.target.value = '';
                      }}
                    />
                    <span className="content-drop-zone__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </span>
                    <div className="content-drop-zone__text">
                      <div className="content-drop-zone__title">{t('content.library.drop.title')}</div>
                      <div className="content-drop-zone__sub">{t('content.library.drop.formats')}</div>
                    </div>
                  </label>
                ) : null}
              </div>
            </div>

            <div className="source-card">
              <LibraryBrowser
                storageId={librarySourceId}
                isShare={Boolean(activeLibrarySource?.storage)}
                refreshToken={libraryBrowseToken}
                onMutated={() => {
                  void refreshLibraryStatus(false);
                  void refreshLibraryCovers(false);
                  void refreshLibraryStorageDetails(libraryStorages);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ============ LINE-IN ============ */}
      {displayedFilter === 'linein' ? (
        <div className="source-layout">
          <aside className="source-aside">
            <span className="source-aside__eyebrow">{t('content.aside.eyebrow')}</span>
            <h2 className="source-aside__title">{t('content.linein.title')}</h2>
            <p className="source-aside__desc">
              {t('content.linein.desc')}
            </p>
            <div className="source-aside__actions">
              <button
                type="button"
                className="content-btn content-btn--primary"
                onClick={() => openLineInModal()}
                disabled={lineInModalOpen}
              >
                {t('content.linein.add')}
              </button>
            </div>
          </aside>

          <div className="source-cards">
            <div className="source-card">
              <div>
                <h3 className="source-card__title">{t('content.linein.cardTitle')}</h3>
                <p className="source-card__desc">{t('content.linein.cardDesc')}</p>
              </div>
              {lineInInputs.length === 0 ? (
                <div className="content-empty-info">
                  <span className="content-empty-info__icon">i</span>
                  <div className="content-empty-info__text">
                    <div className="content-empty-info__title">{t('content.linein.emptyTitle')}</div>
                    <div className="content-empty-info__sub">
                      {t('content.linein.emptySub')}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="content-list">
                  {lineInInputs.map((input, idx) => {
                    const inputId = input.id ?? `linein-${idx}`;
                    return (
                      <div key={inputId} className="content-list-row">
                        <div className="content-list-row__icon">
                          <img
                            src={resolveLineInIconUrl(
                              typeof input.iconType === 'number' ? input.iconType : LineInIconType.CdPlayer,
                            )}
                            alt=""
                            aria-hidden="true"
                          />
                        </div>
                        <div className="content-list-row__main">
                          <div className="content-list-row__title">{input.name ?? '—'}</div>
                          <div className="content-list-row__meta">
                            {input.source?.type ?? 'ingest'}
                          </div>
                        </div>
                        <div className="content-list-row__actions">
                          <button
                            type="button"
                            className="content-btn"
                            onClick={() => openLineInModal(input)}
                            disabled={lineInModalOpen}
                          >
                            {t('content.linein.edit')}
                          </button>
                          <button
                            type="button"
                            className="content-btn content-btn--danger"
                            onClick={() => input.id && void handleLineInRemove(input.id)}
                          >
                            {t('content.linein.remove')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ============ SPOTIFY ============ */}
      {displayedFilter === 'streaming' ? (
        <div className="source-layout">
          <aside className="source-aside">
            <span className="source-aside__eyebrow">{t('content.aside.eyebrow')}</span>
            <h2 className="source-aside__title">{t('content.streaming.title')}</h2>
            <p className="source-aside__desc">
              {t('content.streaming.desc')}
            </p>
            <div className="source-aside__actions">
              <button
                type="button"
                className="content-btn content-btn--primary"
                onClick={() => setAddPickerOpen(true)}
                disabled={bridgeModalOpen}
              >
                {t('content.streaming.addService')}
              </button>
            </div>

            <div className="library-summary">
              <div className="library-summary__row">
                <span
                  className={`library-summary__dot${(spotifyAccounts.length + spotifyBridges.length) > 0 ? '' : ' is-off'}`}
                />
                <span className="library-summary__label">
                  <strong>{t('content.streaming.summary.accounts')}</strong> ·{' '}
                  {t('content.streaming.summary.count', { count: spotifyAccounts.length + spotifyBridges.length })}
                </span>
              </div>
              <div className="library-summary__foot">
                {(spotifyAccounts.length + spotifyBridges.length) === 0
                  ? t('content.streaming.summary.empty')
                  : t('content.streaming.summary.active', { count: spotifyAccounts.length + spotifyBridges.length })}
              </div>
            </div>
          </aside>

          <div className="source-cards">

            {/* Unified account list: Spotify + all other streaming services. */}
            <div className="source-card">
              <div>
                <h3 className="source-card__title">{t('content.streaming.activeTitle')}</h3>
                <p className="source-card__desc">{t('content.streaming.activeDesc')}</p>
              </div>
              {(spotifyAccounts.length + spotifyBridges.length) === 0 ? (
                <div className="content-empty-info">
                  <span className="content-empty-info__icon">i</span>
                  <div className="content-empty-info__text">
                    <div className="content-empty-info__title">{t('content.streaming.emptyTitle')}</div>
                    <div className="content-empty-info__sub">{t('content.streaming.emptySub')}</div>
                  </div>
                </div>
              ) : (
                <div className="content-list">
                  {spotifyAccounts.length > 0 ? (
                    <div className="content-list-row">
                      <div className="content-list-row__main">
                        <div className="content-list-row__title">
                          {t('content.bridge.providerNames.spotify')}
                        </div>
                        <div className="content-list-row__meta">{spotifyAccountNames}</div>
                      </div>
                      <div className="content-list-row__actions">
                        <button
                          type="button"
                          className="content-btn"
                          onClick={() => setSpotifySetupOpen(true)}
                        >
                          {t('content.custom.edit')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {spotifyBridges.map((bridge) => (
                    <div key={bridge.id} className="content-list-row">
                      <div className="content-list-row__main">
                        <div className="content-list-row__title">{bridge.label || bridge.provider}</div>
                        <div className="content-list-row__meta">
                          {t(`content.bridge.providerNames.${bridge.provider}`, { defaultValue: bridge.provider })}
                        </div>
                      </div>
                      <div className="content-list-row__actions">
                        <button
                          type="button"
                          className="content-btn"
                          onClick={() => openBridgeEditModal(bridge)}
                          disabled={bridgeModalOpen}
                        >
                          {t('content.custom.edit')}
                        </button>
                        <button
                          type="button"
                          className="content-btn content-btn--danger"
                          onClick={() => void handleBridgeDelete(bridge.id)}
                          disabled={bridgeDeletingId === bridge.id}
                        >
                          {bridgeDeletingId === bridge.id ? t('content.custom.removing') : t('content.custom.remove')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      ) : null}


      </SubPanel>

      {spotifySetupOpen && (
        <Modal
          open
          onClose={() => setSpotifySetupOpen(false)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          ariaLabelledBy="spotify-setup-title"
          closeOnBackdrop
          closeOnEscape
          bodyClasses={['modal-open']}
          scrollToTop
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__eyebrow">{t('content.streaming.spotifySetup.eyebrow')}</span>
              <h3 id="spotify-setup-title" className="bridge-modal__title">
                {t('content.streaming.spotifySetup.title')}
              </h3>
              <p className="bridge-modal__subtitle">{t('content.streaming.spotifySetup.subtitle')}</p>
            </div>
            <button
              type="button"
              className="bridge-modal__close"
              aria-label={t('content.bridge.close')}
              onClick={() => setSpotifySetupOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div className="bridge-modal__tabs">
            <button
              type="button"
              className={`bridge-modal__tab${spotifyTab === 'accounts' ? ' is-on' : ''}`}
              onClick={() => setSpotifyTab('accounts')}
            >
              {t('content.spotify.tabs.accounts')}
            </button>
            <button
              type="button"
              className={`bridge-modal__tab${spotifyTab === 'engine' ? ' is-on' : ''}`}
              onClick={() => setSpotifyTab('engine')}
            >
              {t('content.spotify.tabs.engine')}
            </button>
          </div>
          <div className="bridge-modal__body">
            {spotifyTab === 'engine' ? (
              <SpotifyPlayers
                accounts={spotifyAccounts.map((account) => ({
                  key: account.id ?? account.user ?? account.email ?? account.displayName ?? account.name ?? '',
                  label: account.displayName ?? account.name ?? account.user ?? account.email ?? '',
                }))}
                pairingAccountId={pairingAccountId}
                onPairAccount={(key) => void handlePairSpotifyAccount(key)}
                cacheEnabled={spotifyCacheEnabled}
                cacheSizeMb={spotifyCacheSizeMb}
                onCacheChange={(patch) => dispatchSpotify({ type: 'update', payload: patch })}
                onSaveCache={() => void handleSaveSpotify()}
                cacheDirty={spotifyDirty && hasSpotifyClientId && !spotifyClientIdEditing}
                cacheSaving={spotifySaving}
              />
            ) : null}
            {spotifyTab === 'accounts' ? (
            hasSpotifyClientId && !spotifyClientIdEditing ? (
              <div className="spotify-configured-strip">
                <span className="spotify-configured-strip__chip" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div className="spotify-configured-strip__text">
                  <div className="spotify-configured-strip__title">{t('content.spotify.configuredTitle')}</div>
                  <div className="spotify-configured-strip__sub">
                    {spotifyClientId.length > 5
                      ? '•'.repeat(Math.max(0, spotifyClientId.length - 5)) + spotifyClientId.slice(-5)
                      : spotifyClientId}
                  </div>
                </div>
                <button
                  type="button"
                  className="content-btn content-btn--sm"
                  onClick={() => setSpotifyClientIdEditing(true)}
                >
                  {t('content.spotify.edit')}
                </button>
              </div>
            ) : (
              <div className="source-card">
                <div className="source-card__head">
                  <span className="source-card__chip" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="7.5" cy="15.5" r="3.5" />
                      <path d="M10 13l8.5-8.5M16 6l2 2M13.5 8.5l2 2" />
                    </svg>
                  </span>
                  <div className="source-card__head-text">
                    <h3 className="source-card__title">
                      {t('content.spotify.clientIdTitle')}
                      <span className="source-card__tag">{t('content.spotify.oneTimeTag')}</span>
                    </h3>
                    <p className="source-card__desc">
                      {/* Plain text and a link, not a Trans slot: the `{' '}` between the children
                          shifted the indices, so the placeholder resolved to a space and the link
                          never rendered — leaving "Create one at using these details." */}
                      {t('content.spotify.clientIdDesc')}{' '}
                      <a
                        className="content-link"
                        href="https://developer.spotify.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('content.spotify.clientIdLink')}
                      </a>
                    </p>
                  </div>
                </div>

                <div className="content-spec-table">
                  <div className="content-spec-row">
                    <span className="content-spec-label">{t('content.spotify.spec.appName')}</span>
                    <span className="content-spec-value">sonn-core</span>
                    <button
                      type="button"
                      className="content-spec-copy"
                      title={t('content.spotify.spec.copy')}
                      onClick={() => void navigator.clipboard?.writeText('sonn-core')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                    </button>
                  </div>
                  <div className="content-spec-row">
                    <span className="content-spec-label">{t('content.spotify.spec.redirectUri')}</span>
                    <span className="content-spec-value">
                      https://sonn-audio.github.io/callbacks/spotify/
                    </span>
                    <button
                      type="button"
                      className="content-spec-copy"
                      title={t('content.spotify.spec.copy')}
                      onClick={() =>
                        void navigator.clipboard?.writeText(
                          'https://sonn-audio.github.io/callbacks/spotify/',
                        )
                      }
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                    </button>
                  </div>
                  <div className="content-spec-row">
                    <span className="content-spec-label">{t('content.spotify.spec.enableApis')}</span>
                    <span className="content-spec-value">{t('content.spotify.spec.apisValue')}</span>
                    <span />
                  </div>
                </div>

                <div>
                  <label className="content-input-label">{t('content.spotify.pasteLabel')}</label>
                  <div className="content-input content-input--mono">
                    <input
                      type="text"
                      value={spotifyClientId}
                      placeholder={t('content.spotify.pastePlaceholder')}
                      onChange={(event) =>
                        dispatchSpotify({ type: 'update', payload: { clientId: event.target.value } })
                      }
                    />
                  </div>
                </div>

                <div className="source-card__save-row">
                  <button
                    type="button"
                    className="content-btn content-btn--primary"
                    onClick={async () => {
                      await handleSaveSpotify();
                      if (spotifyClientId.trim().length > 0) setSpotifyClientIdEditing(false);
                    }}
                    disabled={spotifySaving || spotifyClientId.trim().length === 0}
                  >
                    {spotifySaving ? t('content.spotify.saving') : t('content.spotify.saveClientId')}
                  </button>
                  {hasSpotifyClientId ? (
                    <button
                      type="button"
                      className="content-btn content-btn--sm"
                      onClick={() => setSpotifyClientIdEditing(false)}
                    >
                      {t('content.spotify.cancel')}
                    </button>
                  ) : null}
                </div>
              </div>
            )) : null}

            {/* Spotify accounts appear in the unified list above; add via the
                "+ Add service" picker. Only Spotify's app client-ID + cache
                remain here as Spotify-specific settings. */}

            {spotifyTab === 'accounts' ? (
            <>
            {/* The linked accounts also appear in the unified services list, where Spotify is one
                provider among many. They are repeated here because this screen offers to add one
                and says so in its subtitle — without the list you cannot see whether that worked,
                and someone opening "Spotify setup" because playback stopped finds nothing to act
                on. This is where the pair action belongs for the same reason. */}
            <div className="source-card" style={{ marginTop: 14 }}>
              <div>
                <h3 className="source-card__title">{t('content.spotify.accountsTitle')}</h3>
                <p className="source-card__desc">{t('content.spotify.accountsDesc')}</p>
              </div>
              {spotifyAccounts.length === 0 ? (
                <div className="content-empty-info">
                  <span className="content-empty-info__icon">i</span>
                  <div className="content-empty-info__text">
                    <div className="content-empty-info__title">{t('content.spotify.noAccountsTitle')}</div>
                    <div className="content-empty-info__sub">{t('content.spotify.noAccountsSub')}</div>
                  </div>
                </div>
              ) : (
                <div className="content-list">
                  {spotifyAccounts.map((account) => {
                    const accountKey =
                      account.id ?? account.user ?? account.email ?? account.displayName ?? account.name ?? '';
                    const accountLabel =
                      account.displayName ?? account.name ?? account.user ?? account.email ?? accountKey;
                    return (
                      <div key={`spotify-setup:${accountKey}`} className="content-list-row">
                        <div className="content-list-row__main">
                          <div className="content-list-row__title">{accountLabel}</div>
                          {account.email && account.email !== accountLabel ? (
                            <div className="content-list-row__meta">{account.email}</div>
                          ) : null}
                        </div>
                        <div className="content-list-row__actions">
                          <button
                            type="button"
                            className="content-btn content-btn--danger"
                            onClick={() => accountKey && void handleDeleteSpotifyAccount(accountKey)}
                            disabled={deletingAccountId === accountKey}
                          >
                            {deletingAccountId === accountKey
                              ? t('content.spotify.removingAccount')
                              : t('content.spotify.removeAccount')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="source-card__action-block" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="content-btn content-btn--primary content-btn--full"
                onClick={() => void handleAddSpotifyAccount()}
                disabled={!hasSpotifyClientId || addingSpotifyAccount}
              >
                {addingSpotifyAccount ? t('content.spotify.addingAccount') : t('content.spotify.addAccount')}
              </button>
              {!hasSpotifyClientId ? (
                <span className="source-card__action-reason">{t('content.spotify.setClientIdFirst')}</span>
              ) : null}
            </div>
            </>
            ) : null}
          </div>
        </Modal>
      )}

      {addPickerOpen && (
        <Modal
          open
          onClose={() => setAddPickerOpen(false)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          ariaLabelledBy="add-service-title"
          closeOnBackdrop
          closeOnEscape
          bodyClasses={['modal-open']}
          scrollToTop
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__eyebrow">{t('content.streaming.picker.eyebrow')}</span>
              <h3 id="add-service-title" className="bridge-modal__title">{t('content.streaming.picker.title')}</h3>
              <p className="bridge-modal__subtitle">{t('content.streaming.picker.subtitle')}</p>
            </div>
            <button
              type="button"
              className="bridge-modal__close"
              aria-label={t('content.bridge.close')}
              onClick={() => setAddPickerOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div className="bridge-modal__body">
            <div className="bridge-modal__provider-grid">
            {([
              { id: 'spotify' as const, name: t('content.bridge.providerNames.spotify') },
              { id: 'applemusic' as const, name: t('content.bridge.providerNames.applemusic') },
              { id: 'tidal' as const, name: t('content.bridge.providerNames.tidal') },
              { id: 'ytmusic' as const, name: t('content.bridge.providerNames.ytmusic') },
              { id: 'youtube' as const, name: t('content.bridge.providerNames.youtube') },
              { id: 'deezer' as const, name: t('content.bridge.providerNames.deezer') },
              { id: 'soundcloud' as const, name: t('content.bridge.providerNames.soundcloud') },
              { id: 'musicassistant' as const, name: t('content.bridge.providerNames.musicassistant') },
            ]).map((p) => {
              const logoUrl = resolveBridgeLogoUrl(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="bridge-modal__provider-tile"
                  onClick={() => {
                    setAddPickerOpen(false);
                    if (p.id === 'spotify') {
                      setSpotifySetupOpen(true);
                    } else {
                      openBridgeModal(p.id);
                    }
                  }}
                >
                  <span className="bridge-modal__provider-icon" aria-hidden="true">
                    {logoUrl ? <img src={logoUrl} alt="" loading="lazy" /> : <span>{p.name.charAt(0)}</span>}
                  </span>
                  <span className="bridge-modal__provider-name">{p.name}</span>
                </button>
              );
            })}
            </div>
          </div>
        </Modal>
      )}

      {radioPickerOpen && (
        <Modal
          open
          onClose={() => setRadioPickerOpen(false)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          ariaLabelledBy="add-radio-title"
          closeOnBackdrop
          closeOnEscape
          bodyClasses={['modal-open']}
          scrollToTop
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__eyebrow">{t('content.radio.providers.pickerEyebrow')}</span>
              <h3 id="add-radio-title" className="bridge-modal__title">{t('content.radio.providers.pickerTitle')}</h3>
              <p className="bridge-modal__subtitle">{t('content.radio.providers.pickerSubtitle')}</p>
            </div>
            <button
              type="button"
              className="bridge-modal__close"
              aria-label={t('content.bridge.close')}
              onClick={() => setRadioPickerOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div className="bridge-modal__body">
            <div className="bridge-modal__provider-grid">
              <button
                type="button"
                className="bridge-modal__provider-tile"
                onClick={() => {
                  setRadioPickerOpen(false);
                  setTuneInModalOpen(true);
                }}
              >
                <span className="bridge-modal__provider-icon" aria-hidden="true"><span>T</span></span>
                <span className="bridge-modal__provider-name">{t('content.radio.tunein.title')}</span>
              </button>
              <button
                type="button"
                className="bridge-modal__provider-tile"
                disabled={radioParadiseEnabled}
                onClick={() => {
                  setRadioPickerOpen(false);
                  void handleToggleRadioParadise(true);
                }}
              >
                <span className="bridge-modal__provider-icon" aria-hidden="true"><span>R</span></span>
                <span className="bridge-modal__provider-name">{t('content.radio.radioParadise.title')}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {tuneInModalOpen && (
        <Modal
          open
          onClose={() => setTuneInModalOpen(false)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          ariaLabelledBy="tunein-title"
          closeOnBackdrop
          closeOnEscape
          bodyClasses={['modal-open']}
          scrollToTop
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__eyebrow">{t('content.radio.tunein.title')}</span>
              <h3 id="tunein-title" className="bridge-modal__title">{t('content.radio.tunein.title')}</h3>
              <p className="bridge-modal__subtitle">{t('content.radio.tunein.desc')}</p>
            </div>
            <button
              type="button"
              className="bridge-modal__close"
              aria-label={t('content.bridge.close')}
              onClick={() => setTuneInModalOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div className="bridge-modal__body">
            <label className="content-input-label">{t('content.radio.tunein.label')}</label>
            <div className="content-input">
              <input
                type="text"
                value={radioUsername}
                placeholder={t('content.radio.tunein.placeholder')}
                onChange={(event) =>
                  dispatchRadio({ type: 'update', payload: { username: event.target.value } })
                }
              />
            </div>
            <div className="source-card__save-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="content-btn content-btn--primary"
                onClick={async () => {
                  await handleSaveRadio();
                  setTuneInModalOpen(false);
                }}
                disabled={radioSaving || !radioDirty}
              >
                {radioSaving ? t('content.radio.tunein.saving') : t('content.radio.tunein.save')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bridgeModalOpen && (() => {
        const PROVIDERS: Array<{ id: BridgeFormState['provider']; name: string }> = [
          { id: 'applemusic', name: t('content.bridge.providerNames.applemusic') },
          { id: 'tidal', name: t('content.bridge.providerNames.tidal') },
          { id: 'ytmusic', name: t('content.bridge.providerNames.ytmusic') },
          { id: 'youtube', name: t('content.bridge.providerNames.youtube') },
          { id: 'deezer', name: t('content.bridge.providerNames.deezer') },
          { id: 'soundcloud', name: t('content.bridge.providerNames.soundcloud') },
          { id: 'musicassistant', name: t('content.bridge.providerNames.musicassistant') },
        ];
        const FLOWS: Record<BridgeFormState['provider'], Array<{ id: string; label: string }>> = {
          musicassistant: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'ma-conn', label: t('content.bridge.connectionStep') },
            { id: 'ma-mode', label: t('content.bridge.modeStep') },
          ],
          applemusic: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'apple-token', label: t('content.bridge.tokenStep') },
          ],
          ytmusic: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'ytm-cookie', label: t('content.bridge.cookieStep') },
          ],
          youtube: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'yt-key', label: t('content.bridge.apiKeyStep') },
          ],
          deezer: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'deezer-arl', label: t('content.bridge.cookieStep') },
          ],
          soundcloud: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'soundcloud-token', label: t('content.bridge.tokenStep') },
          ],
          tidal: [
            { id: 'provider', label: t('content.bridge.providerStep') },
            { id: 'tidal-token', label: t('content.bridge.tokenStep') },
          ],
        };
        // The provider is already fixed when editing, or when the "+ Add service"
        // picker chose it — skip the provider-choice step in both cases and start
        // directly at the configuration steps.
        const flow = bridgeEditingId || bridgeProviderLocked
          ? FLOWS[bridgeForm.provider].filter((step) => step.id !== 'provider')
          : FLOWS[bridgeForm.provider];
        const totalSteps = flow.length;
        const safeStep = Math.min(Math.max(bridgeWizStep, 1), totalSteps);
        const currentStepId = flow[safeStep - 1].id;
        const isLast = safeStep === totalSteps;
        const stepValid = (idx: number): boolean => {
          const id = flow[idx - 1].id;
          switch (id) {
            case 'ma-conn':
              return bridgeForm.host.trim().length > 0 && bridgeForm.apiKey.trim().length > 0;
            case 'apple-token':
              return bridgeForm.userToken.trim().length > 0;
            case 'ytm-cookie':
              return bridgeForm.ytmusicCookie.trim().length > 0;
            case 'tidal-token':
              return bridgeForm.tidalAccessToken.trim().length > 0;
            case 'soundcloud-token':
              return bridgeForm.soundcloudOauthToken.trim().length > 0;
            default:
              return true;
          }
        };
        const canAdvance = stepValid(safeStep);
        const submitDisabled = !bridgeFormValid || bridgeSubmitting;
        const handleNext = (): void => {
          if (isLast) {
            void handleBridgeAdd();
          } else if (canAdvance) {
            setBridgeWizStep(safeStep + 1);
          }
        };
        const handleBack = (): void => {
          if (safeStep > 1) setBridgeWizStep(safeStep - 1);
        };
        const providerLabel = PROVIDERS.find((p) => p.id === bridgeForm.provider)?.name ?? bridgeForm.provider;
        return (
        <Modal
          open
          onClose={() => closeBridgeModal(true)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          ariaLabelledBy="bridge-modal-title"
          closeOnBackdrop
          closeOnEscape
          bodyClasses={['modal-open']}
          scrollToTop
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__eyebrow">{bridgeEditingId ? t('content.bridge.editEyebrow') : t('content.bridge.newEyebrow')}</span>
              <h3 id="bridge-modal-title" className="bridge-modal__title">
                {bridgeEditingId ? t('content.bridge.editTitle') : t('content.bridge.newTitle')}
              </h3>
              <p className="bridge-modal__subtitle">{t('content.bridge.subtitle')}</p>
            </div>
            <button
              type="button"
              className="bridge-modal__close"
              aria-label={t('content.bridge.close')}
              onClick={() => closeBridgeModal(true)}
              disabled={bridgeSubmitting}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          {flow.length > 1 && (
          <nav className="bridge-modal__rail" aria-label={t('content.bridge.wizardAriaLabel')}>
            {flow.map((s, i) => {
              const n = i + 1;
              const cls =
                'bridge-modal__step' + (n === safeStep ? ' is-active' : '') + (n < safeStep ? ' is-done' : '');
              return (
                <React.Fragment key={s.id}>
                  <div className={cls}>
                    <span className="bridge-modal__node">
                      {n < safeStep ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        n
                      )}
                    </span>
                    <span className="bridge-modal__step-label">{s.label}</span>
                  </div>
                  {i < flow.length - 1 && (
                    <div className={'bridge-modal__line' + (safeStep > n ? ' is-filled' : '')} />
                  )}
                </React.Fragment>
              );
            })}
          </nav>
          )}

          <div className="bridge-modal__body">
            {isLast && (
              <div className="bridge-modal__panel bridge-modal__panel--name">
                <div className="bridge-modal__field">
                  <label className="bridge-modal__label" htmlFor="bridge-name">
                    {t('content.bridge.nameLabel')}
                  </label>
                  <input
                    id="bridge-name"
                    type="text"
                    className="bridge-modal__input"
                    value={bridgeForm.label}
                    onChange={(e) => updateBridgeForm({ label: e.target.value })}
                    autoComplete="off"
                    maxLength={60}
                  />
                  <span className="bridge-modal__help">{t('content.bridge.nameHelp')}</span>
                </div>
              </div>
            )}
            {currentStepId === 'provider' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.providerTitle')}</div>
                <p className="bridge-modal__panel-desc">
                  {t('content.bridge.providerDesc')}
                </p>
                <div className="bridge-modal__provider-grid">
                  {PROVIDERS.map((p) => {
                    const selected = bridgeForm.provider === p.id;
                    const logoUrl = resolveBridgeLogoUrl(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={'bridge-modal__provider-tile' + (selected ? ' is-selected' : '')}
                        onClick={() => updateBridgeForm({ provider: p.id })}
                        disabled={bridgeSubmitting}
                        aria-pressed={selected}
                      >
                        <span className="bridge-modal__provider-icon" aria-hidden="true">
                          {logoUrl ? <img src={logoUrl} alt="" loading="lazy" /> : <span>?</span>}
                        </span>
                        <span className="bridge-modal__provider-name">{p.name}</span>
                        <svg className="bridge-modal__provider-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    );
                  })}
                </div>

                <div className="bridge-modal__provider-detail">
                  <div className="bridge-modal__provider-head">
                    <span className="bridge-modal__provider-detail-icon" aria-hidden="true">
                      {bridgeProviderLogoUrl ? <img src={bridgeProviderLogoUrl} alt="" loading="lazy" /> : null}
                    </span>
                    <div>
                      <div className="bridge-modal__provider-detail-name">{providerLabel}</div>
                      <div className="bridge-modal__provider-detail-kicker">{t('content.bridge.detailKicker')}</div>
                    </div>
                  </div>
                  {bridgeForm.provider === 'musicassistant' && (
                    <>
                      <p className="bridge-modal__provider-detail-desc">
                        {t('content.bridge.ma.desc')}
                      </p>
                      <span className="bridge-modal__provider-req">{t('content.bridge.ma.req')}</span>
                    </>
                  )}
                  {bridgeForm.provider === 'applemusic' && (
                    <p className="bridge-modal__provider-detail-desc">
                      {t('content.bridge.apple.desc')}
                    </p>
                  )}
                  {bridgeForm.provider === 'ytmusic' && (
                    <p className="bridge-modal__provider-detail-desc">
                      {t('content.bridge.ytmusic.desc')}
                    </p>
                  )}
                  {bridgeForm.provider === 'deezer' && (
                    <p className="bridge-modal__provider-detail-desc">
                      {t('content.bridge.deezer.desc')}
                    </p>
                  )}
                  {bridgeForm.provider === 'soundcloud' && (
                    <p className="bridge-modal__provider-detail-desc">
                      {t('content.bridge.soundcloud.desc')}
                    </p>
                  )}
                  {bridgeForm.provider === 'tidal' && (
                    <p className="bridge-modal__provider-detail-desc">
                      {t('content.bridge.tidal.desc')}
                    </p>
                  )}
                  {bridgeForm.provider === 'youtube' && (
                    <>
                      <p className="bridge-modal__provider-detail-desc">
                        {t('content.bridge.youtube.desc')}
                      </p>
                      <div className="bridge-modal__callout">
                        <svg className="bridge-modal__callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4M12 8h.01" />
                        </svg>
                        <div className="bridge-modal__callout-body">
                          <p>
                            <strong>{t('content.bridge.youtube.callout1')}</strong>{t('content.bridge.youtube.callout1Text')}
                          </p>
                          <p>
                            {t('content.bridge.youtube.callout2')}<em>{t('content.bridge.youtube.loading')}</em>{t('content.bridge.youtube.callout2End')}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {currentStepId === 'ma-conn' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.ma.connectionTitle')}</div>
                <p className="bridge-modal__panel-desc">{t('content.bridge.ma.connectionDesc')}</p>
                <div className="bridge-modal__stack">
                  <div className="bridge-modal__field">
                    <label className="bridge-modal__label">{t('content.bridge.ma.hostPort')}</label>
                    <div className="bridge-modal__row-host">
                      <input
                        className="bridge-modal__input is-mono"
                        type="text"
                        value={bridgeForm.host}
                        onChange={(e) => updateBridgeForm({ host: e.target.value })}
                        placeholder="127.0.0.1"
                        autoComplete="off"
                      />
                      <div className="bridge-modal__num-wrap">
                        <input
                          type="number"
                          value={bridgeForm.port}
                          onChange={(e) => updateBridgeForm({ port: Number(e.target.value) || 0 })}
                          placeholder="8095"
                          min={1}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="bridge-modal__field">
                    <label className="bridge-modal__label" htmlFor="bridge-apikey">{t('content.bridge.ma.apiKey')}</label>
                    <input
                      id="bridge-apikey"
                      className="bridge-modal__input is-mono"
                      type="text"
                      value={bridgeForm.apiKey}
                      onChange={(e) => updateBridgeForm({ apiKey: e.target.value })}
                      placeholder="token"
                      autoComplete="off"
                    />
                    <span className="bridge-modal__help">
                      {t('content.bridge.ma.apiKeyHelp')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {currentStepId === 'ma-mode' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.ma.modeTitle')}</div>
                <p className="bridge-modal__panel-desc">
                  {t('content.bridge.ma.modeDesc')}
                </p>
                <div className="bridge-modal__mode-grid" role="radiogroup" aria-label={t('content.bridge.ma.modeAriaLabel')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={bridgeForm.mode === 'source'}
                    className={'bridge-modal__mode-card' + (bridgeForm.mode === 'source' ? ' is-selected' : '')}
                    onClick={() => updateBridgeForm({ mode: 'source' })}
                  >
                    <div className="bridge-modal__mode-head">
                      <span className="bridge-modal__mode-tag bridge-modal__mode-tag--source">{t('content.bridge.ma.sourceTag')}</span>
                      <span className="bridge-modal__mode-title">{t('content.bridge.ma.sourceTitle')}</span>
                    </div>
                    <p className="bridge-modal__mode-desc">
                      {t('content.bridge.ma.sourceDesc')}
                    </p>
                    <ul className="bridge-modal__mode-bullets">
                      {(t('content.bridge.ma.sourceBullets', { returnObjects: true }) as string[]).map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                    </ul>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={bridgeForm.mode === 'sink'}
                    className={'bridge-modal__mode-card' + (bridgeForm.mode === 'sink' ? ' is-selected' : '')}
                    onClick={() => updateBridgeForm({ mode: 'sink' })}
                  >
                    <div className="bridge-modal__mode-head">
                      <span className="bridge-modal__mode-tag bridge-modal__mode-tag--sink">{t('content.bridge.ma.sinkTag')}</span>
                      <span className="bridge-modal__mode-title">{t('content.bridge.ma.sinkTitle')}</span>
                    </div>
                    <p className="bridge-modal__mode-desc">
                      {t('content.bridge.ma.sinkDesc')}
                    </p>
                    <ul className="bridge-modal__mode-bullets">
                      {(t('content.bridge.ma.sinkBullets', { returnObjects: true }) as string[]).map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                    </ul>
                  </button>
                </div>
              </div>
            )}

            {currentStepId === 'apple-token' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.apple.tokenTitle')}</div>
                <p className="bridge-modal__panel-desc">{t('content.bridge.apple.tokenDesc')}</p>
                <div className="bridge-modal__stack">
                  <div className="bridge-modal__field">
                    <button
                      type="button"
                      className="bridge-modal__btn is-primary"
                      onClick={handleAppleMusicSignIn}
                    >
                      {t('content.bridge.apple.signInButton')}
                    </button>
                    <p className="bridge-modal__hint">{t('content.bridge.apple.signInHint')}</p>
                  </div>
                  <div className="bridge-modal__field">
                    <textarea
                      id="bridge-usertoken"
                      className="bridge-modal__input is-mono"
                      value={bridgeForm.userToken}
                      onChange={(e) => updateBridgeForm({ userToken: e.target.value })}
                      placeholder={t('content.bridge.apple.tokenPlaceholder')}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      rows={4}
                    />
                  </div>
                  <div className="bridge-modal__wv">
                    <div className="bridge-modal__wv-head">
                      <div>
                        <div className="bridge-modal__wv-title">{t('content.bridge.apple.widevineTitle')}</div>
                        <div className="bridge-modal__wv-desc">
                          <Trans i18nKey="content.bridge.apple.widevineDesc">
                            Required for Apple Music DRM playback. Stored locally under <code>data/widevine_cdm</code>.
                          </Trans>
                        </div>
                      </div>
                      <span className={'bridge-modal__wv-badge tone-' + widevineTone}>
                        <span className="bridge-modal__wv-badge-dot" />
                        {widevineLabel}
                      </span>
                    </div>
                    {appleMusicWidevineStatus?.details?.length ? (
                      <ul className="bridge-modal__wv-details">
                        {appleMusicWidevineStatus.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="bridge-modal__wv-files">
                      <div
                        className={
                          'bridge-modal__wv-file' +
                          (appleMusicPrivateKeyFile ? ' is-selected' : '') +
                          (appleMusicWidevineUploading ? ' is-disabled' : '')
                        }
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
                          }
                        }}
                        onClick={(e) => {
                          (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
                        }}
                      >
                        <input
                          id="applemusic-private-key"
                          type="file"
                          accept=".pem"
                          onChange={(e) => setAppleMusicPrivateKeyFile(e.target.files?.[0] ?? null)}
                          disabled={appleMusicWidevineUploading}
                        />
                        <span className="bridge-modal__wv-fbadge">PK</span>
                        <div className="bridge-modal__wv-fbody">
                          <div className="bridge-modal__wv-fname">
                            private_key.pem
                            {appleMusicPrivateKeyFile ? (
                              <span className="bridge-modal__wv-fpill">{t('content.bridge.apple.selected')}</span>
                            ) : null}
                            {!appleMusicPrivateKeyFile && showUploadedBadge(appleMusicWidevineUploadedAt.privateKey) ? (
                              <span className="bridge-modal__wv-fpill is-ok">{t('content.bridge.apple.uploaded')}</span>
                            ) : null}
                          </div>
                          <div className="bridge-modal__wv-fmeta">
                            {appleMusicWidevineUploading
                              ? t('content.bridge.apple.waiting')
                              : appleMusicPrivateKeyFile
                                ? appleMusicPrivateKeyFile.name
                                : widevineFiles?.privateKey?.present
                                  ? t('content.bridge.apple.storedBytes', { bytes: formatBytes(widevineFiles.privateKey.bytes) })
                                  : t('content.bridge.apple.notStored')}
                          </div>
                          <div className="bridge-modal__wv-ftype">PEM</div>
                        </div>
                      </div>
                      <div
                        className={
                          'bridge-modal__wv-file' +
                          (appleMusicClientIdFile ? ' is-selected' : '') +
                          (appleMusicWidevineUploading ? ' is-disabled' : '')
                        }
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
                          }
                        }}
                        onClick={(e) => {
                          (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
                        }}
                      >
                        <input
                          id="applemusic-client-id"
                          type="file"
                          accept=".bin,application/octet-stream"
                          onChange={(e) => setAppleMusicClientIdFile(e.target.files?.[0] ?? null)}
                          disabled={appleMusicWidevineUploading}
                        />
                        <span className="bridge-modal__wv-fbadge">CID</span>
                        <div className="bridge-modal__wv-fbody">
                          <div className="bridge-modal__wv-fname">
                            client_id.bin
                            {appleMusicClientIdFile ? <span className="bridge-modal__wv-fpill">{t('content.bridge.apple.selected')}</span> : null}
                            {!appleMusicClientIdFile && showUploadedBadge(appleMusicWidevineUploadedAt.clientId) ? (
                              <span className="bridge-modal__wv-fpill is-ok">{t('content.bridge.apple.uploaded')}</span>
                            ) : null}
                          </div>
                          <div className="bridge-modal__wv-fmeta">
                            {appleMusicWidevineUploading
                              ? t('content.bridge.apple.waiting')
                              : appleMusicClientIdFile
                                ? appleMusicClientIdFile.name
                                : widevineFiles?.clientId?.present
                                  ? t('content.bridge.apple.storedBytes', { bytes: formatBytes(widevineFiles.clientId.bytes) })
                                  : t('content.bridge.apple.notStored')}
                          </div>
                          <div className="bridge-modal__wv-ftype">BIN</div>
                        </div>
                      </div>
                    </div>
                    <div className="bridge-modal__wv-actions">
                      <button
                        type="button"
                        className="bridge-modal__btn"
                        onClick={() => void refreshAppleMusicWidevine()}
                        disabled={appleMusicWidevineLoading || appleMusicWidevineUploading}
                      >
                        {t('content.bridge.apple.refreshStatus')}
                      </button>
                      <button
                        type="button"
                        className="bridge-modal__btn is-primary"
                        onClick={() => void uploadAppleMusicWidevineFiles()}
                        disabled={appleMusicWidevineUploading || (!appleMusicPrivateKeyFile && !appleMusicClientIdFile)}
                      >
                        {appleMusicWidevineUploading ? t('content.bridge.apple.uploading') : t('content.bridge.apple.uploadFiles')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStepId === 'ytm-cookie' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.ytmusic.title')}</div>
                <p className="bridge-modal__panel-desc">
                  <Trans i18nKey="content.bridge.ytmusic.descLong">
                    From <code>music.youtube.com</code> DevTools: Network request → Request Headers →{' '}
                    <code>cookie: …</code> (paste the value only).
                  </Trans>
                </p>
                <div className="bridge-modal__field">
                  <textarea
                    id="bridge-ytmusic-cookie"
                    className="bridge-modal__input is-mono"
                    value={bridgeForm.ytmusicCookie}
                    onChange={(e) => updateBridgeForm({ ytmusicCookie: e.target.value })}
                    placeholder="SID=...; HSID=...; SAPISID=...; __Secure-3PAPISID=...; ..."
                    autoComplete="off"
                    rows={5}
                  />
                </div>
                <YtDlpPanel />
              </div>
            )}

            {currentStepId === 'yt-key' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">
                  {t('content.bridge.youtube.apiTitle')} <span className="bridge-modal__optional">{t('content.bridge.youtube.optional')}</span>
                </div>
                <p className="bridge-modal__panel-desc">
                  <Trans i18nKey="content.bridge.youtube.apiDesc">
                    Enables better search results and trending music charts. Without it, search still works via yt-dlp. Get a free
                    key at{' '}
                    <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> → Enable
                    "YouTube Data API v3" → Create API key.
                  </Trans>
                </p>
                <div className="bridge-modal__field">
                  <input
                    id="bridge-youtube-apikey"
                    type="text"
                    className="bridge-modal__input is-mono"
                    value={bridgeForm.youtubeApiKey}
                    onChange={(e) => updateBridgeForm({ youtubeApiKey: e.target.value })}
                    placeholder="AIza..."
                    autoComplete="off"
                  />
                </div>
                <YtDlpPanel />
              </div>
            )}

            {currentStepId === 'deezer-arl' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">
                  {t('content.bridge.deezer.title')} <span className="bridge-modal__optional">{t('content.bridge.youtube.optional')}</span>
                </div>
                <p className="bridge-modal__panel-desc">
                  {t('content.bridge.deezer.descLong')}
                </p>
                <div className="bridge-modal__field">
                  <input
                    id="bridge-deezer-arl"
                    type="text"
                    className="bridge-modal__input is-mono"
                    value={bridgeForm.deezerArl}
                    onChange={(e) => updateBridgeForm({ deezerArl: e.target.value })}
                    placeholder="ARL"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {currentStepId === 'soundcloud-token' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">
                  {t('content.bridge.soundcloud.title')}
                </div>
                <p className="bridge-modal__panel-desc">
                  {t('content.bridge.soundcloud.descLong')}
                </p>
                <div className="bridge-modal__field">
                  <input
                    id="bridge-soundcloud-token"
                    type="text"
                    className="bridge-modal__input is-mono"
                    value={bridgeForm.soundcloudOauthToken}
                    onChange={(e) => updateBridgeForm({ soundcloudOauthToken: e.target.value })}
                    placeholder="OAuth token"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {currentStepId === 'tidal-token' && (
              <div className="bridge-modal__panel">
                <div className="bridge-modal__panel-title">{t('content.bridge.tidal.title')}</div>
                <p className="bridge-modal__panel-desc">{t('content.bridge.tidal.descLong')}</p>
                <div className="bridge-modal__stack">
                  <div className="bridge-modal__field">
                    <input
                      id="bridge-tidal-token"
                      type="text"
                      className="bridge-modal__input is-mono"
                      value={bridgeForm.tidalAccessToken}
                      onChange={(e) => updateBridgeForm({ tidalAccessToken: e.target.value })}
                      placeholder={t('content.bridge.tidal.placeholder')}
                      autoComplete="off"
                    />
                  </div>
                  <div className="bridge-modal__field">
                    <label className="bridge-modal__label" htmlFor="bridge-tidal-country">{t('content.bridge.tidal.countryLabel')}</label>
                    <input
                      id="bridge-tidal-country"
                      type="text"
                      className="bridge-modal__input is-mono bridge-modal__input--narrow"
                      value={bridgeForm.tidalCountryCode}
                      onChange={(e) => updateBridgeForm({ tidalCountryCode: e.target.value.toUpperCase() })}
                      placeholder="US"
                      autoComplete="off"
                      maxLength={2}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <footer className="bridge-modal__foot">
            <button
              type="button"
              className="bridge-modal__btn bridge-modal__btn--ghost"
              onClick={handleBack}
              hidden={safeStep === 1}
              disabled={bridgeSubmitting}
            >
              {t('content.bridge.back')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="bridge-modal__btn is-primary"
              onClick={handleNext}
              disabled={isLast ? submitDisabled : !canAdvance}
            >
              {isLast
                ? bridgeSubmitting
                  ? t('content.bridge.saving')
                  : bridgeEditingId
                    ? t('content.bridge.saveBridge')
                    : t('content.bridge.addBridge')
                : t('content.bridge.next')}
            </button>
          </footer>
        </Modal>
        );
      })()}
      {appleAuthOpen && (
        <Modal
          open
          onClose={() => setAppleAuthOpen(false)}
          backdropClassName="bridge-modal-backdrop"
          dialogClassName="bridge-modal"
          closeOnBackdrop
          closeOnEscape
          zIndex={1100}
        >
          <header className="bridge-modal__head">
            <div className="bridge-modal__head-text">
              <span className="bridge-modal__title">{t('content.bridge.apple.signInButton')}</span>
            </div>
            <button
              type="button"
              className="bridge-modal__btn"
              onClick={() => setAppleAuthOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </header>
          <iframe
            title="Apple Music Sign-in"
            src={`${API_BASE}/applemusic/auth`}
            style={{ width: '100%', height: `${appleAuthHeight}px`, border: '0', background: 'transparent', display: 'block' }}
          />
        </Modal>
      )}
      {lineInModalOpen && (() => {
        const ingestBaseUrl = getLineInIngestBaseUrl();
        const ingestWsUrl = getLineInIngestWsUrl(ingestBaseUrl);
        const ingestTcpHost = getLineInIngestTcpHost();
        const ingestId = lineInEditingId ?? lineInForm.draftId ?? '<line-in-id>';
        const saveDisabled =
          !lineInForm.name.trim() ||
          lineInSubmitting ||
          (lineInForm.sourceType === 'sendspin' && !lineInForm.sendspinClientId.trim());
        return (
          <Modal
            open
            onClose={() => closeLineInModal()}
            backdropClassName="linein-modal-backdrop"
            dialogClassName="linein-modal"
            ariaLabelledBy="linein-modal-title"
            bodyClasses={['modal-open']}
            scrollToTop
          >
            <header className="linein-modal__head">
              <div className="linein-modal__head-text">
                <span className="linein-modal__eyebrow">{lineInEditingId ? t('content.linein.modal.editEyebrow') : t('content.linein.modal.newEyebrow')}</span>
                <h3 id="linein-modal-title" className="linein-modal__title">
                  {lineInEditingId ? t('content.linein.modal.editTitle') : t('content.linein.modal.newTitle')}
                </h3>
                <p className="linein-modal__subtitle">{t('content.linein.modal.subtitle')}</p>
              </div>
              <button
                type="button"
                className="linein-modal__close"
                aria-label={t('content.linein.modal.close')}
                onClick={() => closeLineInModal()}
                disabled={lineInSubmitting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="linein-modal__body">
              <div className="linein-modal__grid">
                {/* LEFT COLUMN */}
                <div className="linein-modal__col">
                  <div className="linein-modal__group-label">{t('content.linein.modal.basics')}</div>
                  <div className="linein-modal__field">
                    <label className="linein-modal__field-label" htmlFor="linein-name">
                      {t('content.linein.modal.name')} <span className="linein-modal__req">{t('content.linein.modal.required')}</span>
                    </label>
                    <input
                      ref={lineInNameInputRef}
                      id="linein-name"
                      type="text"
                      className="linein-modal__input"
                      value={lineInForm.name}
                      onChange={(e) => setLineInForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={t('content.linein.modal.namePlaceholder')}
                      autoComplete="off"
                      data-autofocus
                    />
                    <span className="linein-modal__help">{t('content.linein.modal.nameHelp')}</span>
                  </div>

                  <div className="linein-modal__field">
                    <label className="linein-modal__field-label">{t('content.linein.modal.icon')}</label>
                    <div className="linein-modal__icon-grid" role="listbox" aria-label={t('content.linein.modal.icon')}>
                      {LINEIN_ICON_OPTIONS.map((option) => {
                        const isSelected = lineInForm.iconType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`linein-modal__icon-tile${isSelected ? ' is-selected' : ''}`}
                            onClick={() => setLineInForm((prev) => ({ ...prev, iconType: option.value }))}
                            aria-pressed={isSelected}
                          >
                            <img src={resolveLineInIconUrl(option.value)} alt="" aria-hidden="true" />
                            <span>{t(option.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <span className="linein-modal__help">{t('content.linein.modal.iconHelp')}</span>
                  </div>

                  <div className="linein-modal__group-label">{t('content.linein.modal.source')}</div>
                  <div className="linein-modal__field">
                    <label className="linein-modal__field-label" htmlFor="linein-source">{t('content.linein.modal.inputMethod')}</label>
                    <select
                      id="linein-source"
                      className="linein-modal__select"
                      value={lineInForm.sourceType}
                      onChange={(e) =>
                        setLineInForm((prev) => ({
                          ...prev,
                          sourceType: e.target.value as LineInSourceType,
                        }))
                      }
                    >
                      <option value="ingest">{t('content.linein.sourceLabels.ingestOption')}</option>
                      <option value="sendspin">{t('content.linein.sourceLabels.sendspin')}</option>
                    </select>
                    <span className="linein-modal__help">{t('content.linein.modal.inputMethodHelp')}</span>
                  </div>

                  <div className="linein-modal__group-label">{t('content.linein.modal.preferences')}</div>
                  <div className="linein-modal__pref">
                    <div className="linein-modal__pref-head">
                      <span className="linein-modal__pref-title">{t('content.linein.modal.fingerprintTitle')}</span>
                      <button
                        type="button"
                        className={`linein-modal__toggle${lineInForm.metadataEnabled ? ' is-on' : ''}`}
                        aria-label={t('content.linein.modal.fingerprintTitle')}
                        aria-pressed={lineInForm.metadataEnabled}
                        onClick={() =>
                          setLineInForm((prev) => ({ ...prev, metadataEnabled: !prev.metadataEnabled }))
                        }
                      />
                    </div>
                    <span className="linein-modal__help">{t('content.linein.modal.fingerprintHelp')}</span>
                  </div>
                  <div className="linein-modal__pref">
                    <div className="linein-modal__pref-head">
                      <span className="linein-modal__pref-title">{t('content.linein.modal.controllableTitle')}</span>
                      <button
                        type="button"
                        className={`linein-modal__toggle${lineInForm.controllable ? ' is-on' : ''}`}
                        aria-label={t('content.linein.modal.controllableTitle')}
                        aria-pressed={lineInForm.controllable}
                        onClick={() =>
                          setLineInForm((prev) => ({ ...prev, controllable: !prev.controllable }))
                        }
                      />
                    </div>
                    <span className="linein-modal__help">{t('content.linein.modal.controllableHelp')}</span>
                  </div>
                </div>

                {/* RIGHT COLUMN — source-specific */}
                <div className="linein-modal__col">
                  {lineInForm.sourceType === 'sendspin' && (
                    <>
                      <div className="linein-modal__group-label">{t('content.linein.modal.sendspin')}</div>
                      <div className="linein-modal__field">
                        <label className="linein-modal__field-label" htmlFor="linein-sendspin-client">{t('content.linein.modal.sendspinClient')}</label>
                        <select
                          id="linein-sendspin-client"
                          className="linein-modal__select"
                          value={lineInForm.sendspinClientId}
                          onChange={(e) => setLineInForm((prev) => ({ ...prev, sendspinClientId: e.target.value }))}
                        >
                          <option value="">{t('content.linein.modal.selectClient')}</option>
                          {sendspinClients.map((client) => (
                            <option key={client.id} value={client.clientId}>
                              {client.name || client.clientId}
                            </option>
                          ))}
                        </select>
                        <span className="linein-modal__help">
                          {t('content.linein.modal.sendspinHelp')}
                        </span>
                      </div>
                      {sendspinError && <p className="linein-modal__error">{sendspinError}</p>}

                      {/* No format here on purpose. sendspin does not negotiate a source's format:
                          the client announces what it captures, and it is the only party that can
                          see what its converter is. A number typed in here is a guess that outranks
                          the hardware — which is how a 24-bit converter came to be recorded in 16
                          bits. */}
                      <div className="linein-modal__group-label">{t('content.linein.modal.autoplay')}</div>
                      <div className="linein-modal__field">
                        <label className="linein-modal__field-label" htmlFor="linein-autoplay-zone">{t('content.linein.modal.autoplayZone')}</label>
                        <select
                          id="linein-autoplay-zone"
                          className="linein-modal__select"
                          value={lineInForm.autoPlayZoneId}
                          onChange={(e) => setLineInForm((prev) => ({ ...prev, autoPlayZoneId: e.target.value }))}
                        >
                          <option value="">{t('content.linein.modal.autoplayDisabled')}</option>
                          {zoneOptions.map((zone) => (
                            <option key={zone.id} value={String(zone.id)}>
                              {zone.name} (#{zone.id})
                            </option>
                          ))}
                        </select>
                        <span className="linein-modal__help">
                          {t('content.linein.modal.autoplayHelp')}
                        </span>
                      </div>

                      <div className="linein-modal__group-label">{t('content.linein.modal.captureSettings')}</div>
                      <div className="linein-modal__row-2">
                        <div className="linein-modal__field">
                          <label className="linein-modal__field-label" htmlFor="linein-sendspin-vad-threshold">{t('content.linein.modal.threshold')}</label>
                          <div className="linein-modal__num-wrap">
                            <input
                              id="linein-sendspin-vad-threshold"
                              type="number"
                              inputMode="decimal"
                              value={lineInForm.vadThresholdDb}
                              onChange={(e) => setLineInForm((prev) => ({ ...prev, vadThresholdDb: e.target.value }))}
                              placeholder="-45"
                            />
                            <span className="linein-modal__num-suffix">dB</span>
                          </div>
                        </div>
                        <div className="linein-modal__field">
                          <label className="linein-modal__field-label" htmlFor="linein-sendspin-vad-hold">{t('content.linein.modal.hold')}</label>
                          <div className="linein-modal__num-wrap">
                            <input
                              id="linein-sendspin-vad-hold"
                              type="number"
                              inputMode="numeric"
                              value={lineInForm.vadHoldMs}
                              onChange={(e) => setLineInForm((prev) => ({ ...prev, vadHoldMs: e.target.value }))}
                              placeholder="2000"
                            />
                            <span className="linein-modal__num-suffix">ms</span>
                          </div>
                        </div>
                      </div>
                      <span className="linein-modal__help">{t('content.linein.modal.captureHelp')}</span>
                    </>
                  )}

                  {lineInForm.sourceType === 'ingest' && (
                    <>
                      <div className="linein-modal__group-label">{t('content.linein.modal.manualIngest')}</div>
                      <p className="linein-modal__copy">{t('content.linein.modal.manualCopy')}</p>
                      <div className="linein-modal__field">
                        <span className="linein-modal__field-label">{t('content.linein.modal.wsIngest')}</span>
                        <code className="linein-modal__code">{`${ingestWsUrl}/ingest/${ingestId}`}</code>
                      </div>
                      <div className="linein-modal__field">
                        <span className="linein-modal__field-label">{t('content.linein.modal.tcpIngest')}</span>
                        <code className="linein-modal__code">{`tcp://${ingestTcpHost}:7080`}</code>
                      </div>
                      <span className="linein-modal__help">
                        {t('content.linein.modal.manualHelp')}
                      </span>
                    </>
                  )}

                </div>
              </div>
            </div>

            <footer className="linein-modal__foot">
              <span className="linein-modal__foot-hint">{t('content.linein.modal.footHint')}</span>
              <div className="linein-modal__foot-actions">
                <button
                  type="button"
                  className="linein-modal__btn"
                  onClick={() => closeLineInModal()}
                  disabled={lineInSubmitting}
                >
                  {t('content.linein.modal.cancel')}
                </button>
                <button
                  type="button"
                  className="linein-modal__btn is-primary"
                  onClick={handleLineInSave}
                  disabled={saveDisabled}
                >
                  {lineInSubmitting ? t('content.linein.modal.saving') : lineInEditingId ? t('content.linein.modal.save') : t('content.linein.modal.add')}
                </button>
              </div>
            </footer>
          </Modal>
        );
      })()}
    </div>
  );
}
