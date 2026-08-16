import type { PowerGroupConfig } from '@/domain/config/types';

export type AudioServerExtension = {
  mac?: string;
  name?: string;
};

export type AudioServerConfig = {
  ip?: string;
  name?: string;
  uuid?: string;
  macId?: string;
  paired?: boolean;
  /** @deprecated Retired; the server migrates this to loxoneEnabled/setupComplete. */
  mode?: 'loxone' | 'standalone';
  loxoneEnabled?: boolean;
  setupComplete?: boolean;
  authEnabled?: boolean;
  extensions?: AudioServerExtension[];
  crossfadeSec?: number;
};

export type SystemConfig = {
  miniserver?: {
    ip?: string;
    serial?: string;
  };
  audioserver?: AudioServerConfig;
};

export type ContentConfig = {
  /** DLNA/UPnP MediaServer exposing browsable content to other devices. */
  mediaServer?: { enabled?: boolean; friendlyName?: string };
  /** WebDAV share over the music folder at /dav. */
  webdav?: { enabled?: boolean };
  /** Subsonic API server; read the resolved state from /subsonic/status instead. */
  subsonic?: { enabled?: boolean; providers?: string[]; directoryLimit?: number };
  radio?: { tuneInUsername?: string | null; radioParadise?: { enabled?: boolean } };
  spotify?: {
    accounts?: unknown[];
    /** @deprecated Non-Spotify accounts moved to content.streamingServices. */
    bridges?: unknown[];
    clientId?: string | null;
    cacheEnabled?: boolean;
    cacheSizeMb?: number;
  };
  /** Neutral streaming-service accounts (Apple Music, Tidal, …). */
  streamingServices?: unknown[];
  library?: { enabled?: boolean; autoScan?: boolean };
  tts?: TtsConfig;
};

export type OpenAiTtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';

export type TtsProviderConfig =
  | { type: 'internal' }
  | {
      type: 'loxberry-tts';
      enabled?: boolean;
      host?: string;
      mqttPort?: number;
      protocol?: 'mqtt' | 'mqtts';
      username?: string;
      password?: string;
      clientId?: string;
      httpBaseUrl?: string;
    }
  | {
      type: 'openai-tts';
      enabled?: boolean;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      voice?: string;
      format?: OpenAiTtsFormat;
      speed?: number;
      /** Advanced, config-file only: voice per language code. */
      voiceByLanguage?: Record<string, string>;
      instructions?: string;
    };

export type TtsConfig = {
  provider?: TtsProviderConfig;
  fallbackToInternal?: boolean;
};

export type InputsConfig = {
  lineIn?: { inputs?: unknown[] | null };
};

export type RootConfig = {
  system?: SystemConfig;
  groups?: {
    mixedGroupEnabled?: boolean;
    powerGroups?: PowerGroupConfig[];
  };
  zones?: unknown[];
  content?: ContentConfig;
  inputs?: InputsConfig;
  updatedAt?: string;
  crc32?: string;
  rawAudioConfig?: {
    crc32?: string;
  };
};
