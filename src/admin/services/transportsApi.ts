import { API_BASE } from '../config/apiConfig';
import { requestJson } from './http';
import type { TransportConfigDefinition } from '@/ports/OutputsTypes';

type TransportDefinitionsResponse = {
  transports?: TransportConfigDefinition[];
};

export type AirplayDeviceResponse = {
  devices?: AirplayDevice[];
};

export interface AirplayDevice {
  id: string;
  name: string;
  host: string;
  address?: string;
  port: number;
  protocol: 'airplay' | 'raop';
  txt?: Record<string, unknown>;
}

export type GoogleCastDeviceResponse = {
  devices?: GoogleCastDevice[];
};

export interface GoogleCastDevice {
  id: string;
  name: string;
  host: string;
  address?: string;
  port: number;
  manufacturer?: string;
  model?: string;
  txt?: Record<string, unknown>;
}

export type DlnaDeviceResponse = {
  devices?: DlnaDevice[];
};

export interface DlnaDevice {
  id: string;
  name?: string;
  host: string;
  address?: string;
  location?: string;
  controlUrl?: string;
  renderingControlUrl?: string;
}

export type SendspinClientResponse = {
  clients?: SendspinClient[];
};

export interface SendspinClient {
  id: string;
  name: string;
  clientId: string;
  /**
   * What this client offers: `player@v1`, `source@v1`, or both.
   *
   * Absent for a client found over mDNS that has not connected yet — the server knows its address
   * and nothing else about it.
   */
  roles?: string[];
  host?: string;
  address?: string;
  port?: number;
  path?: string;
  controls?: string[] | null;
  sourceState?: 'idle' | 'streaming' | 'error' | null;
  sourceSignal?: 'present' | 'absent' | 'unknown' | null;
}

export interface SnapcastClient {
  id: string;
  clientId: string;
  streamId?: string;
  connected?: boolean;
  connectedAt?: number;
  latency?: number;
}

export interface SqueezeliteClient {
  id: string;
  playerId: string;
  name?: string;
  zoneId?: number;
  zoneName?: string;
  address?: string | null;
  port?: number | null;
  state?: string | null;
  connected?: boolean;
  latency?: number;
  latencyMs?: number;
}

export type MusicAssistantPlayerResponse = {
  devices?: MusicAssistantPlayer[];
  bridgeId?: string | null;
  bridgeMode?: 'source' | 'sink';
};

export interface MusicAssistantPlayer {
  id: string;
  name?: string;
  deviceId?: string;
  provider?: string;
  type?: string;
  enabled?: boolean;
  available?: boolean;
}

export interface MusicAssistantPlayerDiscovery {
  devices: MusicAssistantPlayer[];
  bridgeId: string | null;
  bridgeMode: 'source' | 'sink';
}

export interface MusicAssistantBridge {
  id: string;
  label: string;
  enabled: boolean;
  mode: 'source' | 'sink';
  host?: string;
  port?: number;
}

export type MusicAssistantBridgeResponse = {
  bridges?: MusicAssistantBridge[];
};

export type SonosDeviceResponse = {
  devices?: SonosDevice[];
};

export interface SonosDevice {
  id: string;
  host: string;
  name?: string;
  roomName?: string;
  /** e.g. "Sonos Beam"; absent on servers that predate it. */
  model?: string;
  householdId?: string;
  active?: boolean;
}

export async function getTransportDefinitions(): Promise<TransportConfigDefinition[]> {
  const payload = await requestJson<TransportDefinitionsResponse>(`${API_BASE}/transports`, {
    errorMessage: 'Failed to load transports',
  });
  return payload.transports ?? [];
}

export async function discoverAirplayDevices(): Promise<AirplayDevice[]> {
  const payload = await requestJson<AirplayDeviceResponse>(`${API_BASE}/transports/airplay/devices`, {
    errorMessage: 'Failed to discover AirPlay devices',
  });
  return payload.devices ?? [];
}

export async function discoverGoogleCastDevices(host?: string): Promise<GoogleCastDevice[]> {
  const url =
    host && host.trim().length > 0
      ? `${API_BASE}/transports/googlecast/devices?host=${encodeURIComponent(host.trim())}`
      : `${API_BASE}/transports/googlecast/devices`;
  const payload = await requestJson<GoogleCastDeviceResponse>(url, {
    errorMessage: 'Failed to discover Google Cast devices',
  });
  return payload.devices ?? [];
}

export async function discoverDlnaDevices(host?: string): Promise<DlnaDevice[]> {
  const url =
    host && host.trim().length > 0
      ? `${API_BASE}/transports/dlna/devices?host=${encodeURIComponent(host.trim())}`
      : `${API_BASE}/transports/dlna/devices`;
  const payload = await requestJson<DlnaDeviceResponse>(url, {
    errorMessage: 'Failed to discover DLNA devices',
  });
  return payload.devices ?? [];
}

export async function discoverSonosDevices(params?: {
  name?: string;
  householdId?: string;
  networkScan?: boolean;
  host?: string;
}): Promise<SonosDevice[]> {
  const search = new URLSearchParams();
  if (params?.name) search.set('name', params.name);
  if (params?.householdId) search.set('householdId', params.householdId);
  if (typeof params?.networkScan === 'boolean') search.set('networkScan', String(params.networkScan));
  if (params?.host) search.set('host', params.host);
  const suffix = search.toString();
  const url = suffix
    ? `${API_BASE}/transports/sonos/devices?${suffix}`
    : `${API_BASE}/transports/sonos/devices`;
  const payload = await requestJson<SonosDeviceResponse>(url, {
    errorMessage: 'Failed to discover Sonos devices',
  });
  return payload.devices ?? [];
}

export async function discoverSendspinClients(): Promise<SendspinClient[]> {
  const payload = await requestJson<SendspinClientResponse>(`${API_BASE}/transports/sendspin/clients`, {
    errorMessage: 'Failed to discover Sendspin clients',
  });
  return payload.clients ?? [];
}

export async function discoverSendspinSources(): Promise<SendspinClient[]> {
  const payload = await requestJson<SendspinClientResponse>(`${API_BASE}/transports/sendspin/sources`, {
    errorMessage: 'Failed to discover Sendspin sources',
  });
  return payload.clients ?? [];
}

export async function discoverSnapcastClients(): Promise<SnapcastClient[]> {
  const payload = await requestJson<{ clients?: SnapcastClient[] }>(`${API_BASE}/transports/snapcast/clients`, {
    errorMessage: 'Failed to discover Snapcast clients',
  });
  return payload.clients ?? [];
}

export async function discoverSqueezeliteClients(): Promise<SqueezeliteClient[]> {
  const payload = await requestJson<{ clients?: SqueezeliteClient[] }>(
    `${API_BASE}/transports/squeezelite/clients`,
    {
      errorMessage: 'Failed to discover Squeezelite players',
    },
  );
  return payload.clients ?? [];
}

export async function discoverMusicAssistantPlayers(bridgeId?: string): Promise<MusicAssistantPlayerDiscovery> {
  const url = new URL(`${API_BASE}/transports/musicassistant/devices`, window.location.origin);
  if (bridgeId && bridgeId.trim()) {
    url.searchParams.set('bridgeId', bridgeId.trim());
  }
  const target = url.pathname + url.search;
  const payload = await requestJson<MusicAssistantPlayerResponse>(target, {
    errorMessage: 'Failed to discover Music Assistant players',
  });
  return {
    devices: payload.devices ?? [],
    bridgeId: payload.bridgeId ?? null,
    bridgeMode: payload.bridgeMode ?? 'source',
  };
}

export async function getMusicAssistantBridges(): Promise<MusicAssistantBridge[]> {
  const payload = await requestJson<MusicAssistantBridgeResponse>(
    `${API_BASE}/transports/musicassistant/bridges`,
    { errorMessage: 'Failed to load Music Assistant bridges' },
  );
  return payload.bridges ?? [];
}

export async function pingTransport(host: string, port?: number): Promise<{ reachable: boolean }> {
  const body = { host, port };
  return requestJson(`${API_BASE}/transports/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    errorMessage: 'Ping failed',
  });
}
