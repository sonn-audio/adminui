import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import './ZonesView.css';
import { fetchSoloistStatus } from '../services/contentApi';
import { getConfig, updateGroupsConfig, updateManagedPlayers, setLoxoneConnection } from '../services/setupApi';
import {
  createZone,
  deleteZone,
  fetchStateControllers,
  fetchZoneStates,
  setZoneOutputLatency,
  updateZones,
  type StateControllerDefinition,
  type ZonePlaybackState,
} from '../services/zonesApi';
import { fetchGroups, type GroupRecord } from '../services/groupsApi';
import { SubPanel } from '../components/SubPanel';
import { useGlobalAlert } from '../components/GlobalAlert';
import { useConfirm } from '../components/ConfirmDialog';
import InlineState from '../components/InlineState';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import Row from '../components/Row';
import SelectMenu from '../components/SelectMenu';
import ZoneBeoremoteSection from './ZoneBeoremoteSection';
import ZoneBluetoothSection from './ZoneBluetoothSection';
import ZoneDeviceSection from './ZoneDeviceSection';
import ZoneEssenceSection from './ZoneEssenceSection';
import ZoneRemoteModelList from './ZoneRemoteModelList';
import {
  getTransportDefinitions,
  discoverAirplayDevices,
  discoverGoogleCastDevices,
  discoverDlnaDevices,
  discoverSonosDevices,
  discoverSendspinClients,
  discoverSnapcastClients,
  discoverSqueezeliteClients,
  discoverMusicAssistantPlayers,
  getMusicAssistantBridges,
  type AirplayDevice,
  type GoogleCastDevice,
  type DlnaDevice,
  type SonosDevice,
  type SendspinClient,
  type SnapcastClient,
  type SqueezeliteClient,
  type MusicAssistantPlayer,
  type MusicAssistantBridge,
} from '../services/transportsApi';
import type {
  PowerGroupConfig,
  ZoneBeoremoteConfig,
  ZoneBluetoothConfig,
  ZoneEqualizerConfig,
  ZoneEqualizerProvider,
  ZoneInputConfig,
  ZonePlaybackConfig,
  ZonePowerManagerConfig,
  ZoneSpotifyConfig,
  ZoneStateConfig,
  ZoneTransportConfig,
} from '@/domain/config/types';
import type { TransportConfigDefinition } from '@/ports/OutputsTypes';
import type { SpotifyAccountConfig } from '@/domain/config/types';

interface Zone {
  id: number;
  name: string;
  source?: string;
  sourceSerial?: string;
  sourceMac?: string;
  inputs?: ZoneInputConfig;
  playback?: ZonePlaybackConfig | null;
  powerManager?: ZonePowerManagerConfig | null;
  equalizer?: ZoneEqualizerConfig | null;
  state?: ZoneStateConfig;
  transport?: ZoneTransportConfig | null;
  transports?: ZoneTransportConfig[];
}

/**
 * Used only until the server's list arrives (and if the request fails). The server
 * owns the real list; this keeps the picker usable rather than empty.
 */
const STATE_CONTROLLER_FALLBACK: StateControllerDefinition[] = [
  { id: 'internal', label: 'Internal' },
  { id: 'beolink', label: 'BeoLink' },
  { id: 'sonos', label: 'Sonos' },
  { id: 'musicassistant', label: 'Music Assistant' },
];

type AudioServerExtension = {
  mac?: string;
  name?: string;
};

type AudioServerConfig = {
  macId?: string;
  name?: string;
  paired?: boolean;
  loxoneEnabled?: boolean;
  managedPlayers?: boolean;
  extensions?: AudioServerExtension[];
};

interface ConfigResponse {
  config?: {
    system?: {
      audioserver?: AudioServerConfig;
    };
    content?: {
      spotify?: {
        accounts?: SpotifyAccountConfig[];
      };
    };
    inputs?: {
      airplay?: { enabled?: boolean };
      spotify?: { enabled?: boolean };
      dlna?: { enabled?: boolean };
      bluetooth?: { enabled?: boolean; deviceId?: string; publishName?: string };
    };
    groups?: {
      powerGroups?: PowerGroupConfig[];
    };
    zones?: Zone[];
  };
}

interface ZoneGroup {
  key: string;
  label: string;
  sourceSerial?: string;
  zones: Zone[];
  totalZones?: number;
  filteredEmpty?: boolean;
}

interface ExtensionPlaceholder {
  index: number;
  serial: string;
  label: string;
}

/** Crossed-out circle: no player layer at all. */
function DisabledIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="18.4" x2="18.4" y2="5.6" />
    </svg>
  );
}

/** Speaker: players you set up and control here. */
function ManualIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <circle cx="12" cy="15" r="3.4" />
      <circle cx="12" cy="7" r="1.4" />
    </svg>
  );
}

/** Loxone brand mark: players come from the Loxone project. */
function LoxoneIcon(): JSX.Element {
  return (
    <img
      src={`${import.meta.env.BASE_URL || '/'}providers/loxone.png`}
      alt=""
      width={20}
      height={20}
    />
  );
}

export default function ZonesView(): JSX.Element {
  // Whether Spotify plays at all, so the per-zone Connect switch can say it is not a choice here:
  // Soloist cannot advertise a room without also being able to play in it.
  const [soloistInUse, setSoloistInUse] = React.useState(false);
  React.useEffect(() => {
    void fetchSoloistStatus()
      .then((status) => setSoloistInUse(status.hasApiKey === true))
      .catch(() => setSoloistInUse(false));
  }, []);
  const { t } = useTranslation();
  const [zoneGroups, setZoneGroups] = React.useState<ZoneGroup[]>([]);
  const [baseSerial, setBaseSerial] = React.useState<string>('');
  // "standalone" = Loxone not connected. When Loxone is connected, players are
  // pushed by the Miniserver and the local managed-players controls don't apply.
  const [stateControllers, setStateControllers] =
    React.useState<StateControllerDefinition[]>(STATE_CONTROLLER_FALLBACK);
  const [standalone, setStandalone] = React.useState(false);
  const [paired, setPaired] = React.useState(false);
  // Opt-in for the local player layer (only when Loxone is not connected). Off =
  // pure content/access server (DLNA/Subsonic), no players shown.
  const [managedPlayers, setManagedPlayers] = React.useState(false);
  const [managedSaving, setManagedSaving] = React.useState(false);
  const [loxoneModalOpen, setLoxoneModalOpen] = React.useState(false);
  const [loxoneBusy, setLoxoneBusy] = React.useState(false);
  const [addZoneOpen, setAddZoneOpen] = React.useState(false);
  const [newZoneName, setNewZoneName] = React.useState('');
  const [addingZone, setAddingZone] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [extensionPlaceholders, setExtensionPlaceholders] = React.useState<ExtensionPlaceholder[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [activeZoneModal, setActiveZoneModal] = React.useState<{
    zoneId: number;
    tab: 'settings' | 'output';
  } | null>(null);
  const modalCloseRef = React.useRef<HTMLButtonElement | null>(null);
  const [transportDefinitions, setTransportDefinitions] = React.useState<TransportConfigDefinition[]>([]);
  const [hasSpotifyAccounts, setHasSpotifyAccounts] = React.useState(false);
  const [tileOutputLatencyDrafts, setTileOutputLatencyDrafts] = React.useState<Record<number, string>>({});
  const [zoneQuery, setZoneQuery] = React.useState('');
  const [powerGroups, setPowerGroups] = React.useState<PowerGroupConfig[]>([]);
  const [zoneStateMap, setZoneStateMap] = React.useState<Record<number, ZonePlaybackState>>({});
  const [groups, setGroups] = React.useState<GroupRecord[]>([]);
  const { push: pushAlert } = useGlobalAlert();
  const { confirm } = useConfirm();
  const closeZoneModal = React.useCallback((): void => {
    setActiveZoneModal(null);
  }, []);

  // `quiet` re-reads without flipping the loading state, so background refreshes
  // (e.g. while waiting for a Miniserver push) don't flash the placeholder.
  const refreshZones = React.useCallback(async (signal?: AbortSignal, quiet = false): Promise<void> => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [cfg, definitions, states, groupList, controllers] = await Promise.all([
        getConfig(),
        getTransportDefinitions(),
        fetchZoneStates().catch(() => null),
        fetchGroups().catch(() => [] as GroupRecord[]),
        // Falls back to the built-in list, so an older server (or a failed request)
        // still renders a usable picker rather than an empty one.
        fetchStateControllers().catch(() => [] as StateControllerDefinition[]),
      ]);
      if (signal?.aborted) return;
      if (controllers.length > 0) setStateControllers(controllers);
      const data = cfg as ConfigResponse;
      const rawZones = data.config?.zones ?? [];
      const spotifyAccounts = Array.isArray(data.config?.content?.spotify?.accounts)
        ? data.config?.content?.spotify?.accounts
        : [];
      const base = (data.config?.system?.audioserver?.macId ?? '').toUpperCase();
      const loxoneConnected = data.config?.system?.audioserver?.loxoneEnabled === true;
      setStandalone(!loxoneConnected);
      setPaired(data.config?.system?.audioserver?.paired === true);
      // Explicit flag wins; absent means "on if zones already exist" so existing
      // local setups aren't suddenly hidden behind the opt-in gate.
      const rawManaged = data.config?.system?.audioserver?.managedPlayers;
      setManagedPlayers(typeof rawManaged === 'boolean' ? rawManaged : rawZones.length > 0);
      const hasAccounts = spotifyAccounts.length > 0;
      setHasSpotifyAccounts(hasAccounts);
      setBaseSerial(base);
      setPowerGroups(Array.isArray(data.config?.groups?.powerGroups) ? data.config?.groups?.powerGroups : []);
      setTransportDefinitions(definitions);
      setZoneStateMap(states?.map ?? {});
      setGroups(groupList);
      const sanitizedZones = rawZones.map((zone) => {
        const next: Zone = { ...zone };
        const inputs: ZoneInputConfig = { ...(zone.inputs ?? {}) };
        if (!hasAccounts) {
          inputs.spotify = { ...(inputs.spotify ?? {}), enabled: false };
        }
        next.inputs = inputs;
        return next;
      });
      setZoneGroups(groupZones(sanitizedZones, buildSourceDirectory(data.config?.system?.audioserver), base));
    } catch (err) {
      if (signal?.aborted) return;
      setError(String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void refreshZones(controller.signal);
    return () => controller.abort();
  }, [refreshZones]);

  React.useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const [states, groupList] = await Promise.all([
          fetchZoneStates(),
          fetchGroups().catch(() => [] as GroupRecord[]),
        ]);
        if (!cancelled) {
          setZoneStateMap(states.map);
          setGroups(groupList);
        }
      } catch {
        // Keep current UI state on transient polling failures.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // While waiting for the Miniserver to push its configuration, re-read the config
  // so the pushed players (and the paired state) appear on their own. The regular
  // poll above only refreshes playback state, so without this the page would sit on
  // "Pairing…" until a manual browser refresh. Stops as soon as pairing lands.
  const awaitingPairing = !standalone && !paired;
  React.useEffect(() => {
    if (!awaitingPairing) return;
    const timer = setInterval(() => void refreshZones(undefined, true), 4000);
    return () => clearInterval(timer);
  }, [awaitingPairing, refreshZones]);

  const handleCreateZone = React.useCallback(async (): Promise<void> => {
    const name = newZoneName.trim();
    if (!name || addingZone) return;
    setAddingZone(true);
    try {
      await createZone(name);
      setAddZoneOpen(false);
      setNewZoneName('');
      await refreshZones();
    } catch (err) {
      pushAlert({ tone: 'error', title: t('zones.add.errorTitle'), message: String(err) });
    } finally {
      setAddingZone(false);
    }
  }, [newZoneName, addingZone, refreshZones, pushAlert, t]);

  const handleDeleteZone = React.useCallback(
    async (zone: Zone): Promise<void> => {
      const ok = await confirm({
        title: t('zones.delete.title', { name: zone.name }),
        message: t('zones.delete.message'),
        confirmLabel: t('zones.delete.confirm'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await deleteZone(zone.id);
        closeZoneModal();
        await refreshZones();
      } catch (err) {
        pushAlert({ tone: 'error', title: t('zones.delete.errorTitle'), message: String(err) });
      }
    },
    [confirm, t, closeZoneModal, refreshZones, pushAlert],
  );

  function handleTileOutputLatencyChange(zoneId: number, value: string): void {
    setTileOutputLatencyDrafts((prev) => ({ ...prev, [zoneId]: value }));
  }

  async function handleTileOutputLatencyCommit(
    zone: Zone,
    nextValue?: number,
  ): Promise<void> {
    const zoneId = zone.id;
    const raw = tileOutputLatencyDrafts[zoneId];
    if (typeof nextValue !== 'number') {
      if (raw === undefined) return;
      if (String(raw).trim() === '') return;
    }
    const parsed = typeof nextValue === 'number' ? nextValue : Number(raw);
    if (!Number.isFinite(parsed)) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.invalidLatencyTitle'),
        message: t('zones.feedback.invalidLatencyMessage'),
      });
      return;
    }
    const primaryTransport = getPrimaryTransport(zone);
    if (!primaryTransport) return;
    const transportId = (primaryTransport.id ?? '').toLowerCase();
    if (transportId !== 'snapcast' && transportId !== 'squeezelite' && transportId !== 'sendspin') return;
    if (transportId === 'snapcast' && extractClientIds(primaryTransport).length === 0) return;
    if (transportId === 'squeezelite' && !readStringField(primaryTransport as any, 'playerId')) return;

    const currentTransports =
      Array.isArray(zone.transports) && zone.transports.length > 0
        ? zone.transports
        : zone.transport
          ? [zone.transport]
          : [primaryTransport];
    try {
      const clamped = Math.max(0, Math.round(parsed));
      const updatedPrimary: ZoneTransportConfig = {
        ...(currentTransports[0] ?? primaryTransport),
        latencyMs: clamped,
      } as any;
      const nextTransports = [updatedPrimary, ...currentTransports.slice(1)];
      setSaving(true);
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) =>
            z.id === zoneId
              ? {
                  ...z,
                  transport: updatedPrimary,
                  transports: nextTransports,
                }
              : z,
          ),
        })),
      );
      await setZoneOutputLatency(zoneId, clamped);
      setTileOutputLatencyDrafts((prev) => ({ ...prev, [zoneId]: String(clamped) }));
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.latencyFailedTitle'),
        message:
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : t('zones.feedback.latencyFailedDefault'),
      });
    } finally {
      setSaving(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;

    return () => {
      cancelled = true;
    };
  }, []);

  const displayGroups = React.useMemo(() => {
    const placeholders: ZoneGroup[] = extensionPlaceholders.map((ph) => ({
      key: `placeholder-${ph.index}`,
      label: ph.label,
      sourceSerial: ph.serial,
      zones: [],
    }));
    return [...zoneGroups, ...placeholders];
  }, [zoneGroups, extensionPlaceholders]);

  const filteredGroups = React.useMemo(() => {
    const groups: ZoneGroup[] = [];
    const query = zoneQuery.trim().toLowerCase();
    displayGroups.forEach((group) => {
      const zones = group.zones.filter((zone) => {
        if (!query) return true;
        const name = (zone.name ?? '').toLowerCase();
        const idLabel = String(zone.id ?? '');
        const source = (zone.source ?? '').toLowerCase();
        return name.includes(query) || idLabel.includes(query) || source.includes(query);
      });
      if (zones.length > 0) {
        groups.push({ ...group, zones, totalZones: group.zones.length, filteredEmpty: false });
        return;
      }
      if (group.zones.length === 0) {
        groups.push({ ...group, zones, totalZones: 0, filteredEmpty: false });
        return;
      }
      if (query) {
        groups.push({ ...group, zones, totalZones: group.zones.length, filteredEmpty: true });
      }
    });
    return groups;
  }, [displayGroups, zoneQuery]);

  const totalZones = zoneGroups.reduce((sum, g) => sum + g.zones.length, 0);

  // Standalone caps zones at 24, matching the Loxone audioserver ceiling.
  const STANDALONE_MAX_ZONES = 24;
  const atZoneLimit = standalone && totalZones >= STANDALONE_MAX_ZONES;
  // The player layer is shown when Loxone pushes zones, or when the local opt-in
  // is on. Off = pure content/access server, so the rest stays hidden.
  const showPlayers = !standalone || managedPlayers;
  // One explicit choice: nobody manages players ('none'), you do ('manual'), or the
  // Miniserver does ('loxone'). Loxone wins when connected — it owns the zones then.
  const playerMode: 'none' | 'manual' | 'loxone' = !standalone
    ? 'loxone'
    : managedPlayers
      ? 'manual'
      : 'none';
  const busySetup = managedSaving || loxoneBusy;

  const MAX_EXTENSION_COUNT = 10;

  const extensionCount = React.useMemo(() => {
    const configured = zoneGroups.reduce((count, group) => {
      return extractExtensionIndex(group.label) ? count + 1 : count;
    }, 0);
    return configured + extensionPlaceholders.length;
  }, [zoneGroups, extensionPlaceholders]);

  // Extensions are a Loxone-compatibility concept (4 zones per device); standalone has no extensions.
  const canAddExtension = !standalone && Boolean(baseSerial) && extensionCount < MAX_EXTENSION_COUNT;

  function extractExtensionIndex(label: string | undefined): number | null {
    if (!label) return null;
    const match = label.match(/extension\s*(\d+)/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function computeExtensionSerial(base: string, index: number): string {
    if (!base) return '';
    const value = parseInt(base, 16);
    if (!Number.isFinite(value)) return '';
    const hex = (value + index).toString(16).toUpperCase();
    return hex.padStart(base.length, '0');
  }

  function formatSerial(serial?: string): string {
    if (!serial) return '';
    const compact = serial.replace(/[^0-9A-Fa-f]/g, '');
    return compact.replace(/(..)(?=.)/g, '$1:');
  }


  function handleAddExtension(): void {
    if (!canAddExtension) {
      if (!baseSerial) return;
      pushAlert({
        tone: 'warn',
        title: t('zones.extensionLimitTitle'),
        message: t('zones.extensionLimitMessage', { max: MAX_EXTENSION_COUNT }),
      });
      return;
    }
    const indexes = new Set<number>();
    zoneGroups.forEach((g) => {
      const idx = extractExtensionIndex(g.label);
      if (idx && idx > 0) indexes.add(idx);
    });
    extensionPlaceholders.forEach((ph) => {
      if (ph.index && ph.index > 0) indexes.add(ph.index);
    });
    let highest = 0;
    indexes.forEach((v) => {
      if (v > highest) highest = v;
    });
    if (indexes.size >= MAX_EXTENSION_COUNT) {
      pushAlert({
        tone: 'warn',
        title: t('zones.extensionLimitTitle'),
        message: t('zones.extensionLimitMessage', { max: MAX_EXTENSION_COUNT }),
      });
      return;
    }
    const next = highest + 1;
    const serial = computeExtensionSerial(baseSerial, next);
    setExtensionPlaceholders((prev) => [
      ...prev,
      { index: next, serial, label: t('zones.extensionDefaultName', { index: next }) },
    ]);
  }

  const definitionMap = React.useMemo(() => {
    const map = new Map<string, TransportConfigDefinition>();
    transportDefinitions.forEach((def) => map.set(def.id, def));
    return map;
  }, [transportDefinitions]);

  // Standalone opt-in for the player layer. Enabling reveals the rest of this
  // view; disabling collapses it back to the gate (existing zones stay in config,
  // just hidden). Optimistic; reverts on failure.
  async function handleToggleManagedPlayers(next: boolean): Promise<void> {
    if (managedSaving) return;
    const previous = managedPlayers;
    setManagedSaving(true);
    setManagedPlayers(next);
    try {
      await updateManagedPlayers(next);
    } catch (err) {
      setManagedPlayers(previous);
      pushAlert({
        tone: 'error',
        title: t('zones.managed.failedTitle'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setManagedSaving(false);
    }
  }

  // Connect or disconnect Loxone in the background: the server starts/stops just its
  // protocol subsystem — no restart, the admin UI stays live. Refresh afterwards so
  // the card, the managed toggle and the (Miniserver-pushed) zone list reflect it.
  async function applyLoxone(enabled: boolean): Promise<void> {
    if (loxoneBusy) return;
    setLoxoneBusy(true);
    try {
      await setLoxoneConnection(enabled);
      setLoxoneModalOpen(false);
      await refreshZones();
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.loxone.failedTitle'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoxoneBusy(false);
    }
  }

  // The single either/or on this screen. Picking Loxone opens the pairing modal (it
  // needs the serial/host instructions); the other two apply straight away. Leaving
  // Loxone always disconnects it first so the two can never both claim the players.
  async function selectPlayerMode(next: 'none' | 'manual' | 'loxone'): Promise<void> {
    if (busySetup) return;

    // The Loxone card always opens its modal — to connect when it isn't the current
    // choice, and to show the pairing state / disconnect when it already is.
    if (next === 'loxone') {
      setLoxoneModalOpen(true);
      return;
    }

    if (next === playerMode) return;

    if (playerMode === 'loxone') {
      const ok = await confirm({
        title: t(next === 'manual' ? 'zones.setup.confirmManualTitle' : 'zones.setup.confirmOffTitle'),
        message: t(next === 'manual' ? 'zones.setup.confirmManualMessage' : 'zones.setup.confirmOffMessage'),
        confirmLabel: t('zones.setup.confirmSwitch'),
        cancelLabel: t('zones.add.cancel'),
      });
      if (!ok) return;
      // Persist the local intent first so the post-disconnect reload lands on it.
      try {
        setManagedPlayers(next === 'manual');
        await updateManagedPlayers(next === 'manual');
      } catch {
        // Non-fatal: disconnecting still applies and the gate defaults sanely.
      }
      await applyLoxone(false);
      return;
    }

    await handleToggleManagedPlayers(next === 'manual');
  }

  const handleTileInputToggle = React.useCallback(
    (zone: Zone, badge: InputBadge): void => {
      if (!badge.type || badge.disabled) return;
      const current = deriveZoneInputs(zone);
      if (badge.type === 'airplay') {
        current.airplay = { ...(current.airplay ?? {}), enabled: !badge.enabled };
      } else if (badge.type === 'spotify') {
        current.spotify = { ...(current.spotify ?? { publishName: zone.name }), enabled: !badge.enabled };
      }
      void handleInputChange(zone.id, current);
    },
    [handleInputChange],
  );

  // Spotify Connect input enable, like AirPlay.
  function handleSpotifyConnectToggle(zone: Zone, enabled: boolean): void {
    const next = deriveZoneInputs(zone);
    const base = next.spotify ?? { publishName: zone.name };
    next.spotify = { ...base, enabled } satisfies ZoneSpotifyConfig;
    void handleInputChange(zone.id, next);
  }

  async function handleInputChange(zoneId: number, inputs: ZoneInputConfig): Promise<void> {
    setSaving(true);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) => (z.id === zoneId ? { ...z, inputs } : z)),
        })),
      );
      await updateZones([{ id: zoneId, inputs }]);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.inputsFailedDefault', { error: String(err) }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleStateControllerChange(zone: Zone, controller: string): Promise<void> {
    const binding = resolveStateControllerBinding(zone);
    if ((controller === 'beolink' || controller === 'sonos') && !binding.selectable) {
      pushAlert({
        tone: 'warn',
        title: t('zones.stateController.unavailableTitle'),
        message: t('zones.stateController.unavailableIp'),
      });
      return;
    }
    if (controller === 'musicassistant') {
      const primary = getPrimaryTransport(zone);
      if ((primary?.id ?? '').toLowerCase() !== 'musicassistant') {
        pushAlert({
          tone: 'warn',
          title: t('zones.stateController.unavailableTitle'),
          message: t('zones.stateController.unavailableMa'),
        });
        return;
      }
    }
    const nextState = buildNextZoneState(zone.state, controller, binding.outputIp);
    setSaving(true);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) => (z.id === zone.id ? { ...z, state: nextState } : z)),
        })),
      );
      await updateZones([{ id: zone.id, state: nextState }]);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.stateFailedDefault', { error: String(err) }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTransportChange(zone: Zone, transport: ZoneTransportConfig | null): Promise<void> {
    setSaving(true);
    const zoneId = zone.id;
    const transports = transport ? [transport] : [];
    const outputIp = extractOutputHostOrIp(transport);
    const currentController = resolveZoneStateController(zone);
    const nextController = resolveControllerForTransport(transport, currentController, outputIp);
    const nextState = buildNextZoneState(zone.state, nextController, outputIp);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) =>
            z.id === zoneId
              ? {
                  ...z,
                  transport,
                  transports,
                  state: nextState,
                }
              : z,
          ),
        })),
      );
      await updateZones([{ id: zoneId, transports, state: nextState }]);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.outputsFailedDefault', { error: String(err) }),
      });
    } finally {
      setSaving(false);
    }
  }

  // Live latency change from the output modal — applied without rebuilding the output ("no slinger").
  // clientId targets a Sendspin satellite; null = the primary/main output. Optimistically patches the
  // zone config (so the modal reflects it) then calls the live endpoint.
  async function handleOutputLatencyLive(
    zone: Zone,
    clientId: string | null,
    latencyMs: number,
  ): Promise<void> {
    const clamped = Math.max(0, Math.round(latencyMs));
    const zoneId = zone.id;
    setZoneGroups((prev) =>
      prev.map((group) => ({
        ...group,
        zones: group.zones.map((z) => {
          if (z.id !== zoneId) return z;
          const ts =
            Array.isArray(z.transports) && z.transports.length > 0
              ? z.transports
              : z.transport
                ? [z.transport]
                : [];
          if (!ts[0]) return z;
          const prim = { ...ts[0] } as Record<string, unknown>;
          if (clientId) {
            const sats = parseSatellites(prim.satellites).map((s) =>
              s.clientId === clientId ? { ...s, latencyMs: clamped } : s,
            );
            prim.satellites = serializeSatellites(sats);
          } else {
            prim.latencyMs = clamped;
          }
          const nextTransports = [prim as ZoneTransportConfig, ...ts.slice(1)];
          return { ...z, transport: prim as ZoneTransportConfig, transports: nextTransports };
        }),
      })),
    );
    try {
      await setZoneOutputLatency(zoneId, clamped, clientId ?? undefined);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.latencyFailedTitle'),
        message:
          err instanceof Error ? err.message : t('zones.feedback.latencyFailedDefault'),
      });
    }
  }

  async function handlePowerManagerChange(zoneId: number, powerManager: ZonePowerManagerConfig | null): Promise<boolean> {
    setSaving(true);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) => (z.id === zoneId ? { ...z, powerManager } : z)),
        })),
      );
      await updateZones([{ id: zoneId, powerManager }]);
      return true;
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.powerFailedDefault', { error: String(err) }),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handlePlaybackChange(zoneId: number, playback: ZonePlaybackConfig | null): Promise<boolean> {
    setSaving(true);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) => (z.id === zoneId ? { ...z, playback } : z)),
        })),
      );
      await updateZones([{ id: zoneId, playback }]);
      return true;
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.powerFailedDefault', { error: String(err) }),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleEqualizerChange(zoneId: number, equalizer: ZoneEqualizerConfig | null): Promise<boolean> {
    setSaving(true);
    try {
      setZoneGroups((prev) =>
        prev.map((group) => ({
          ...group,
          zones: group.zones.map((z) => (z.id === zoneId ? { ...z, equalizer } : z)),
        })),
      );
      await updateZones([{ id: zoneId, equalizer }]);
      return true;
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.equalizerFailedDefault', { error: String(err) }),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handlePowerGroupsSave(groups: PowerGroupConfig[]): Promise<boolean> {
    setSaving(true);
    try {
      const normalized = normalizePowerGroupsForSave(groups);
      await updateGroupsConfig({ powerGroups: normalized });
      setPowerGroups(normalized);
      return true;
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('zones.feedback.updateFailedTitle'),
        message: t('zones.feedback.powerGroupsFailedDefault', { error: String(err) }),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  const openZoneModal = (zoneId: number, tab: 'settings' | 'output'): void => {
    setActiveZoneModal({ zoneId, tab });
  };

  const modalZone = React.useMemo((): Zone | null => {
    if (!activeZoneModal) return null;
    for (const group of zoneGroups) {
      const found = group.zones.find((z) => z.id === activeZoneModal.zoneId);
      if (found) return found;
    }
    return null;
  }, [activeZoneModal, zoneGroups]);

  React.useEffect(() => {
    if (!activeZoneModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeZoneModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeZoneModal, closeZoneModal]);

  return (
    <div className="zones-layout">
      <header className="zones-head">
        <div className="zones-head__text">
          <p className="zones-eyebrow">{t('zones.eyebrow')}</p>
          <h1 className="zones-title">{t('zones.title')}</h1>
          <p className="zones-subtitle">{t('zones.subtitle')}</p>
        </div>

        {standalone && managedPlayers ? (
          <button
            type="button"
            className="zones-add-btn"
            onClick={() => {
              setNewZoneName('');
              setAddZoneOpen(true);
            }}
            disabled={atZoneLimit}
            title={atZoneLimit ? t('zones.add.limitReached', { max: STANDALONE_MAX_ZONES }) : undefined}
          >
            <span aria-hidden="true">+</span> {t('zones.add.button')}
          </button>
        ) : null}
      </header>

      {/* One explicit either/or: you manage the players, or the Miniserver does. */}
      <section className="zones-setup">
        <h2 className="zones-setup__title">{t('zones.setup.title')}</h2>
        <p className="zones-setup__desc">{t('zones.setup.desc')}</p>

        <div className="zones-setup__options" role="radiogroup" aria-label={t('zones.setup.title')}>
          <button
            type="button"
            role="radio"
            aria-checked={playerMode === 'none'}
            className={`zones-setup-card${playerMode === 'none' ? ' is-active' : ''}`}
            disabled={busySetup}
            onClick={() => void selectPlayerMode('none')}
          >
            <span className="zones-setup-card__head">
              <span className="zones-setup-card__icon" aria-hidden="true"><DisabledIcon /></span>
              <span className="zones-setup-card__label">{t('zones.setup.none.label')}</span>
              {playerMode === 'none' ? (
                <span className="zones-setup-card__badge">{t('zones.setup.active')}</span>
              ) : null}
            </span>
            <span className="zones-setup-card__desc">{t('zones.setup.none.desc')}</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={playerMode === 'manual'}
            className={`zones-setup-card${playerMode === 'manual' ? ' is-active' : ''}`}
            disabled={busySetup}
            onClick={() => void selectPlayerMode('manual')}
          >
            <span className="zones-setup-card__head">
              <span className="zones-setup-card__icon" aria-hidden="true"><ManualIcon /></span>
              <span className="zones-setup-card__label">{t('zones.setup.manual.label')}</span>
              {playerMode === 'manual' ? (
                <span className="zones-setup-card__badge">{t('zones.setup.active')}</span>
              ) : null}
            </span>
            <span className="zones-setup-card__desc">{t('zones.setup.manual.desc')}</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={playerMode === 'loxone'}
            className={`zones-setup-card${playerMode === 'loxone' ? ' is-active' : ''}${
              playerMode === 'loxone' && !paired ? ' is-pairing' : ''
            }`}
            disabled={busySetup}
            onClick={() => void selectPlayerMode('loxone')}
          >
            <span className="zones-setup-card__head">
              <span className="zones-setup-card__icon" aria-hidden="true"><LoxoneIcon /></span>
              <span className="zones-setup-card__label">{t('zones.setup.loxone.label')}</span>
              {playerMode === 'loxone' ? (
                paired ? (
                  <span className="zones-setup-card__badge">{t('zones.setup.active')}</span>
                ) : (
                  // Pairing is an active wait (we poll for the Miniserver push), so the
                  // badge pulses to show something is genuinely happening.
                  <span className="zones-setup-card__badge zones-setup-card__badge--pairing">
                    <span className="zones-setup-card__pulse" aria-hidden="true" />
                    {t('zones.setup.pairing')}
                  </span>
                )
              ) : null}
            </span>
            <span className="zones-setup-card__desc">
              {playerMode === 'loxone'
                ? paired
                  ? t('zones.loxone.descPaired')
                  : t('zones.loxone.descWaiting')
                : t('zones.setup.loxone.desc')}
            </span>
          </button>
        </div>
      </section>

      {showPlayers ? (
        <>

      <SubPanel isLeaving={false}>
      {filteredGroups.length === 0 ? (
        <div className="zones-empty">
          <p className="zones-empty__title">{standalone ? t('zones.add.emptyTitle') : t('zones.emptyTitle')}</p>
          <p className="zones-empty__sub">{standalone ? t('zones.add.emptySub') : t('zones.emptySub')}</p>
          {standalone ? (
            <button
              type="button"
              className="zones-add-btn"
              onClick={() => {
                setNewZoneName('');
                setAddZoneOpen(true);
              }}
            >
              <span aria-hidden="true">+</span> {t('zones.add.button')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="zones-devices">
          {filteredGroups.map((group) => {
            const isAudioServer = !group.sourceSerial || group.sourceSerial === baseSerial;
            const deviceLabel = isAudioServer ? t('zones.audioServer') : t('zones.extension');
            const macId = group.sourceSerial ?? baseSerial ?? '';
            const formattedMac = formatSerial(macId) || macId;
            const zoneCount = group.totalZones ?? group.zones.length;
            return (
              <section key={group.key} className="zones-device">
                <header className="zones-device__head">
                  <div className="zones-device__head-main">
                    <span
                      className={`zones-device__eyebrow${
                        isAudioServer ? '' : ' zones-device__eyebrow--extension'
                      }`}
                    >
                      {deviceLabel}
                    </span>
                    <span className="zones-device__name">{group.label}</span>
                  </div>
                  <div className="zones-device__meta">
                    <span className="zones-device__meta-accent">
                      {t('zones.zoneCount', { count: zoneCount })}
                    </span>
                    {formattedMac ? (
                      <>
                        <span className="zones-device__meta-sep" />
                        <span>{formattedMac}</span>
                      </>
                    ) : null}
                  </div>
                </header>

                {group.zones.length === 0 ? (
                  <div style={{ padding: '4px 12px 12px', color: 'var(--text-dim)', fontSize: 12 }}>
                    {t('zones.noZonesForDevice')}
                  </div>
                ) : (
                  <div className="zones-device__zones">
                    {group.zones.map((zone) => {
                      const playback = zoneStateMap[zone.id];
                      const transport = zone.transport ?? zone.transports?.[0] ?? null;
                      const transportId = transport?.id ? String(transport.id) : '';
                      const effectiveId = effectiveTransportId(transport);
                      const transportProtoLabel =
                        transportDefinitions.find((t) => t.id === effectiveId)?.label ?? effectiveId;
                      const rawDeviceName =
                        (typeof transport?.name === 'string' ? (transport.name as string).trim() : '') ||
                        (playback?.tech?.outputTarget ?? '').trim();
                      const transportDeviceName =
                        rawDeviceName &&
                        rawDeviceName.toLowerCase() !== transportId.toLowerCase() &&
                        rawDeviceName.toLowerCase() !== transportProtoLabel.toLowerCase()
                          ? rawDeviceName
                          : '';
                      const hasOutput = transportId.length > 0;
                      // Receivers are opt-in per player, matching the server's gate.
                      const airplayOn = zone.inputs?.airplay?.enabled === true;
                      // Soloist cannot run without advertising, so while it is the player the
                      // room is a Connect target whatever the stored switch says — and the card
                      // has to show what is true, not what was last chosen.
                      const spotifyOn = soloistInUse || zone.inputs?.spotify?.enabled === true;
                      const dlnaOn = Boolean(zone.inputs?.dlna?.enabled);

                      // Group role lookup — Loxone sync group (master/member)
                      const groupRec = groups.find((g) => g.members.includes(zone.id));
                      const isLeader = groupRec ? groupRec.leader === zone.id : false;
                      const groupHasMembers = (groupRec?.members.length ?? 0) > 1;
                      const groupLeaderName = groupRec?.leaderName ?? '';

                      // Playback mode
                      // The diagnostics route reports playback the same way /api does.
                      const isPlaying = playback?.state === 'playing';

                      // State controller — surfaced on the card only when it's not the default
                      // ('internal'); the interesting cases are BeoLink / Sonos / MA / Miniserver.
                      const stateCtrl = (zone.state?.controller ?? 'internal').toLowerCase();
                      const stateCtrlLabel =
                        stateCtrl && stateCtrl !== 'internal'
                          ? t(`zones.stateController.${stateCtrl}`, { defaultValue: stateCtrl })
                          : '';

                      // EQ chip status — 'off' (neutral) / 'ok' / 'warn'
                      const eqProvider = zone.equalizer?.provider ?? 'off';
                      const eqCallback = zone.equalizer?.callbackUrl ?? '';
                      const eqStatus: 'off' | 'ok' | 'warn' =
                        eqProvider === 'off'
                          ? 'off'
                          : eqProvider === 'squeezelite-mr' && !eqCallback.trim()
                            ? 'warn'
                            : 'ok';
                      const eqTitle =
                        eqStatus === 'off'
                          ? t('zones.eqTitle.off')
                          : eqStatus === 'warn'
                            ? t('zones.eqTitle.warn')
                            : eqProvider === 'builtin'
                              ? t('zones.eqTitle.builtin')
                              : eqProvider === 'squeezelite-mr'
                                ? t('zones.eqTitle.squeezeliteMr')
                                : t('zones.eqTitle.on');

                      // Output status pill
                      const outputStatusOk = hasOutput && isPlaying;

                      return (
                        <article
                          key={zone.id}
                          className={`zones-card${hasOutput ? '' : ' needs-output'}`}
                        >
                          <div className="zones-card__head">
                            <a
                              className={`zones-card__play${isPlaying ? ' is-playing' : ''}`}
                              href="/player/"
                              target="_blank"
                              rel="noreferrer"
                              title={t('zones.card.openPlayer')}
                              aria-label={t('zones.card.openPlayer')}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <polygon points="6 4 20 12 6 20 6 4" />
                              </svg>
                            </a>
                            <div className="zones-card__head-text">
                              <span className="zones-card__name">{zone.name || `Zone ${zone.id}`}</span>
                              <div className="zones-card__head-sub">
                                <span className="zones-card__id">#{zone.id}</span>
                                {isLeader && groupHasMembers ? (
                                  <span className="zones-card__role zones-card__role--master">{t('zones.card.master')}</span>
                                ) : groupRec && !isLeader ? (
                                  <span className="zones-card__role zones-card__role--member">
                                    {t('zones.card.member', { leader: groupLeaderName })}
                                  </span>
                                ) : null}
                                {stateCtrlLabel ? (
                                  <span className="zones-card__ctrl" title={t('zones.modal.stateController')}>
                                    {stateCtrlLabel}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="zones-card__status">
                              <span
                                className={`zones-card__eq-chip zones-card__eq-chip--${eqStatus}`}
                                title={eqTitle}
                              >
                                <span className="zones-card__eq-chip-dot" />
                                {t('zones.card.eqLabel')}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className={`zones-card__output zones-card__output--btn${hasOutput ? '' : ' is-empty'}`}
                            onClick={() => openZoneModal(zone.id, 'output')}
                            aria-label={`${t('zones.card.output')} — ${
                              hasOutput ? transportDeviceName || transportProtoLabel : t('zones.card.noOutputShort')
                            }`}
                          >
                            <div className="zones-card__output-main">
                              <span className="zones-card__proto-chip" aria-hidden="true">
                                {hasOutput ? (
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5C7 5 3 8 2 12c1 4 5 7 10 7M12 5c5 0 9 3 10 7-1 4-5 7-10 7" opacity="0.5" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M16 9a5 5 0 0 1 0 6M3 9v6h4l5 4V5L7 9H3z" />
                                    <line x1="2" y1="2" x2="22" y2="22" />
                                  </svg>
                                )}
                              </span>
                              <div className="zones-card__output-info">
                                <div className="zones-card__output-device">
                                  {hasOutput
                                    ? transportDeviceName || transportProtoLabel
                                    : t('zones.card.noOutputShort')}
                                </div>
                                <div className="zones-card__output-proto">
                                  {hasOutput
                                    ? transportDeviceName
                                      ? transportProtoLabel
                                      : ''
                                    : t('zones.card.pickOutput')}
                                </div>
                              </div>
                              {hasOutput ? (
                                <span
                                  className={`zones-card__status-pill${
                                    outputStatusOk ? ' is-ok' : ' is-muted'
                                  }`}
                                >
                                  <span className="zones-card__status-dot" />
                                  {outputStatusOk ? t('zones.card.connected') : t('zones.card.idleShort')}
                                </span>
                              ) : null}
                              <svg className="zones-card__output-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </div>
                          </button>

                          {/* Only what this room actually accepts. Listing the rest greyed out
                              filled the card with things that are not true of it, and made the
                              ones that are harder to pick out — and with only the active ones
                              left, a heading costs a line to say what the chips already say. */}
                          {airplayOn || spotifyOn || dlnaOn ? (
                            <div className="zones-card__inputs">
                              <div className="zones-card__chips">
                                {airplayOn ? (
                                  <span className="zones-card__chip is-on">
                                    <span className="zones-card__chip-dot" />
                                    {t('zones.card.airplay')}
                                  </span>
                                ) : null}
                                {spotifyOn ? (
                                  <span className="zones-card__chip is-on">
                                    <span className="zones-card__chip-dot" />
                                    {t('zones.card.spotifyConnect')}
                                  </span>
                                ) : null}
                                {dlnaOn ? (
                                  <span className="zones-card__chip is-on">
                                    <span className="zones-card__chip-dot" />
                                    {t('zones.card.dlna')}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          <div className="zones-card__foot">
                            <button
                              type="button"
                              className="zones-card__action"
                              onClick={() => openZoneModal(zone.id, 'settings')}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                              </svg>
                              {t('zones.card.settings')}
                            </button>
                            <button
                              type="button"
                              className="zones-card__action"
                              onClick={() => openZoneModal(zone.id, 'output')}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                              </svg>
                              {t('zones.card.output')}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          {canAddExtension ? (
            <button
              type="button"
              className="zones-add-extension"
              onClick={handleAddExtension}
              disabled={!canAddExtension || saving}
            >
              <span className="zones-add-extension__icon">+</span>
              {t('zones.addExtension')}
            </button>
          ) : null}
        </div>
      )}
      </SubPanel>
        </>
      ) : null}

      {activeZoneModal && modalZone ? (
        <ZoneModal
          tab={activeZoneModal.tab}
          zone={modalZone}
          saving={saving}
          transports={transportDefinitions}
          stateControllers={stateControllers}
          powerGroups={powerGroups}
          onClose={closeZoneModal}
          onTransportChange={(transport) => handleTransportChange(modalZone, transport)}
          onStateControllerChange={(controller) => handleStateControllerChange(modalZone, controller)}
          onOutputLatency={(clientId, latencyMs) => void handleOutputLatencyLive(modalZone, clientId, latencyMs)}
          onAirplayToggle={(enabled) => {
            const next = deriveZoneInputs(modalZone);
            next.airplay = { ...(next.airplay ?? {}), enabled };
            void handleInputChange(modalZone.id, next);
          }}
          onDlnaToggle={(enabled) => {
            const next = deriveZoneInputs(modalZone);
            next.dlna = { ...(next.dlna ?? { publishName: modalZone.name }), enabled };
            void handleInputChange(modalZone.id, next);
          }}
          soloistInUse={soloistInUse}
          onSpotifyConnectToggle={(enabled) => handleSpotifyConnectToggle(modalZone, enabled)}
          hasSpotifyAccounts={hasSpotifyAccounts}
          onBeoremoteChange={(beoremote) => {
            const next = deriveZoneInputs(modalZone);
            next.beoremote = beoremote;
            void handleInputChange(modalZone.id, next);
          }}
          onBluetoothChange={(bluetooth) => {
            const next = deriveZoneInputs(modalZone);
            next.bluetooth = bluetooth;
            void handleInputChange(modalZone.id, next);
          }}
          onPowerManagerChange={async (config) => {
            const ok = await handlePowerManagerChange(modalZone.id, config);
            return ok;
          }}
          onPowerGroupsSave={handlePowerGroupsSave}
          onPlaybackChange={async (config) => {
            const ok = await handlePlaybackChange(modalZone.id, config);
            return ok;
          }}
          onEqualizerChange={async (config) => {
            const ok = await handleEqualizerChange(modalZone.id, config);
            return ok;
          }}
          describeTransport={describeTransport}
          canDelete={standalone}
          onDelete={() => void handleDeleteZone(modalZone)}
        />
      ) : null}

      <Modal
        open={addZoneOpen}
        onClose={() => {
          if (!addingZone) setAddZoneOpen(false);
        }}
        backdropClassName="zones-add-backdrop"
        dialogClassName="zones-add-modal"
        ariaLabelledBy="zones-add-title"
        initialFocusSelector="[data-autofocus]"
      >
        <h3 id="zones-add-title" className="zones-add-modal__title">{t('zones.add.title')}</h3>
        <p className="zones-add-modal__sub">{t('zones.add.sub')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreateZone();
          }}
        >
          <input
            data-autofocus
            type="text"
            className="zones-add-modal__input"
            placeholder={t('zones.add.placeholder')}
            value={newZoneName}
            maxLength={64}
            onChange={(e) => setNewZoneName(e.target.value)}
            disabled={addingZone}
          />
          <div className="zones-add-modal__actions">
            <button
              type="button"
              className="zones-modal__btn"
              onClick={() => setAddZoneOpen(false)}
              disabled={addingZone}
            >
              {t('zones.add.cancel')}
            </button>
            <button
              type="submit"
              className="zones-modal__btn zones-modal__btn--primary"
              disabled={addingZone || newZoneName.trim().length === 0}
            >
              {addingZone ? t('zones.add.creating') : t('zones.add.create')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={loxoneModalOpen}
        onClose={() => {
          if (!loxoneBusy) setLoxoneModalOpen(false);
        }}
        backdropClassName="zones-add-backdrop"
        dialogClassName="zones-add-modal zones-loxone-modal"
        ariaLabelledBy="zones-loxone-title"
      >
        <h3 id="zones-loxone-title" className="zones-add-modal__title">{t('zones.loxone.modalTitle')}</h3>
        <p className="zones-add-modal__sub">
          {standalone
            ? t('zones.loxone.modalConnectSub')
            : paired
              ? t('zones.loxone.modalPairedSub')
              : t('zones.loxone.modalWaitingSub')}
        </p>

        {standalone || !paired ? (
          <dl className="zones-loxone-modal__facts">
            <div>
              <dt>{t('zones.loxone.serial')}</dt>
              <dd>{baseSerial || '—'}</dd>
            </div>
            <div>
              <dt>{t('zones.loxone.host')}</dt>
              <dd>{typeof window !== 'undefined' ? window.location.host || '—' : '—'}</dd>
            </div>
          </dl>
        ) : null}

        {!standalone && !paired ? (
          <ol className="zones-loxone-modal__steps">
            <li>{t('zones.loxone.step1')}</li>
            <li>{t('zones.loxone.step2')}</li>
            <li>{t('zones.loxone.step3')}</li>
          </ol>
        ) : null}

        <div className="zones-add-modal__actions">
          <button
            type="button"
            className="zones-modal__btn"
            onClick={() => setLoxoneModalOpen(false)}
            disabled={loxoneBusy}
          >
            {t('zones.add.cancel')}
          </button>
          {standalone ? (
            <button
              type="button"
              className="zones-modal__btn zones-modal__btn--primary"
              onClick={() => void applyLoxone(true)}
              disabled={loxoneBusy}
            >
              {t('zones.loxone.connect')}
            </button>
          ) : (
            <button
              type="button"
              className="zones-modal__btn zones-modal__btn--danger"
              onClick={() => void applyLoxone(false)}
              disabled={loxoneBusy}
            >
              {t('zones.loxone.disconnect')}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}

type ZoneModalProps = {
  tab: 'settings' | 'output';
  zone: Zone;
  saving: boolean;
  transports: TransportConfigDefinition[];
  /** Supported state controllers, as reported by the server. */
  stateControllers: StateControllerDefinition[];
  powerGroups: PowerGroupConfig[];
  onClose: () => void;
  onTransportChange: (transport: ZoneTransportConfig | null) => Promise<void>;
  onStateControllerChange: (controller: string) => Promise<void>;
  onOutputLatency: (clientId: string | null, latencyMs: number) => void;
  onAirplayToggle: (enabled: boolean) => void;
  onDlnaToggle: (enabled: boolean) => void;
  soloistInUse: boolean;
  onSpotifyConnectToggle: (enabled: boolean) => void;
  hasSpotifyAccounts: boolean;
  onBeoremoteChange: (config: ZoneBeoremoteConfig | null) => void;
  onBluetoothChange: (config: ZoneBluetoothConfig | null) => void;
  onPowerManagerChange: (config: ZonePowerManagerConfig | null) => Promise<boolean>;
  onPowerGroupsSave: (groups: PowerGroupConfig[]) => Promise<boolean>;
  onPlaybackChange: (config: ZonePlaybackConfig | null) => Promise<boolean>;
  onEqualizerChange: (config: ZoneEqualizerConfig | null) => Promise<boolean>;
  describeTransport: (config: ZoneTransportConfig | null) => string;
  canDelete?: boolean;
  onDelete?: () => void;
};

function ZoneModal({
  tab,
  zone,
  saving,
  transports,
  stateControllers,
  powerGroups,
  onClose,
  onTransportChange,
  onStateControllerChange,
  onOutputLatency,
  onAirplayToggle,
  onDlnaToggle,
  onSpotifyConnectToggle,
  hasSpotifyAccounts,
  soloistInUse,
  onBeoremoteChange,
  onBluetoothChange,
  onPowerManagerChange,
  onPowerGroupsSave,
  onPlaybackChange,
  onEqualizerChange,
  describeTransport,
  canDelete,
  onDelete,
}: ZoneModalProps): JSX.Element {
  const { t } = useTranslation();
  const inputs = zone.inputs ?? {};
  const airplayOn = Boolean(inputs.airplay?.enabled);
  const spotifyOn = Boolean(inputs.spotify?.enabled);
  const dlnaOn = Boolean(inputs.dlna?.enabled);
  const currentTransport = getPrimaryTransport(zone);
  const currentTransportLabel = currentTransport
    ? transports.find((t) => t.id === effectiveTransportId(currentTransport))?.label ??
      effectiveTransportId(currentTransport)
    : null;

  type SettingsView =
    | 'main'
    | 'power'
    | 'eq'
    | 'remote'
    | 'remote-one'
    | 'remote-essence'
    | 'bluetooth';
  const [settingsView, setSettingsView] = React.useState<SettingsView>('main');

  const powerCfg = zone.powerManager ?? null;
  const hasSwitching = Boolean(
    powerCfg?.gpio?.enabled ||
      powerCfg?.url?.enabled ||
      powerCfg?.udp?.enabled ||
      powerCfg?.crelay?.enabled,
  );
  /**
   * One line for the folded row. It cannot name a model: one switch serves the room and which
   * remotes are paired is a fact about the speaker, read a screen further in.
   */
  const beoremoteSummary =
    deriveZoneInputs(zone).beoremote?.enabled === true
      ? t('zones.beoremote.summaryOn')
      : t('zones.beoremote.summaryNone');

  // Whether the room takes Bluetooth at all, in the same words as the switches beside it. Naming
  // the room here was noise: it is the room whose settings are open.
  const bluetoothOn = deriveZoneInputs(zone).bluetooth?.enabled === true;
  const bluetoothSummary = bluetoothOn
    ? t('zones.bluetooth.summaryOn')
    : t('zones.bluetooth.summaryOff');

  const powerSummary = (() => {
    if (powerCfg?.powerGroupId) {
      const group = powerGroups.find((g) => g.id === powerCfg.powerGroupId);
      return t('zones.modal.groupPrefix', { name: group?.name ?? powerCfg.powerGroupId });
    }
    if (hasSwitching) {
      if (powerCfg?.gpio?.enabled) return 'GPIO';
      if (powerCfg?.url?.enabled) return 'HTTP relay';
      if (powerCfg?.udp?.enabled) return 'UDP';
      if (powerCfg?.crelay?.enabled) return 'crelay';
    }
    return t('zones.modal.switchingNone');
  })();

  const eqProvider = zone.equalizer?.provider ?? 'off';
  const eqSummary =
    eqProvider === 'builtin'
      ? t('zones.eq.builtin')
      : eqProvider === 'squeezelite-mr'
        ? t('zones.eq.squeezeliteMr')
        : t('zones.eq.off');

  const stateController = resolveZoneStateController(zone);
  const resetVolumeOnPauseOn = zone.playback?.resetVolumeOnPause === true;

  const currentTransportDeviceName =
    typeof currentTransport?.name === 'string' && (currentTransport.name as string).trim().length > 0
      ? (currentTransport.name as string)
      : '';

  const headSubtitle = (() => {
    if (tab === 'output') {
      if (!currentTransportLabel) {
        return (
          <>
            {t('zones.modal.zoneId', { id: zone.id })} <span className="zones-modal__sep">·</span> {t('zones.modal.noOutput')}
          </>
        );
      }
      return (
        <>
          {t('zones.modal.zoneId', { id: zone.id })} <span className="zones-modal__sep">·</span>{' '}
          {currentTransportDeviceName ? (
            <>
              <span className="zones-modal__subtitle-active">{currentTransportDeviceName}</span>{' '}
              <span className="zones-modal__sep">·</span>{' '}
            </>
          ) : null}
          {currentTransportLabel}
        </>
      );
    }
    if (settingsView === 'remote') return t('zones.beoremote.groupTitle');
    if (settingsView === 'remote-one') return t('zones.beoremote.models.one');
    if (settingsView === 'remote-essence') return t('zones.beoremote.models.essence');
    if (settingsView === 'bluetooth') return t('zones.bluetooth.useTitle');
    if (settingsView === 'power') return t('zones.modal.powerStateSub');
    if (settingsView === 'eq') return t('zones.modal.eqSub');
    return t('zones.modal.zoneId', { id: zone.id });
  })();

  const inSubView = tab === 'settings' && settingsView !== 'main';

  // The power panel carries its own Save/Cancel row, but `.zones-modal` hides it
  // (the modal supplies the footer instead). Without this the footer's "Save" only
  // navigated back and the panel's edits were silently dropped — issue #319.
  const powerSaveRef = React.useRef<(() => Promise<void>) | null>(null);
  const registerPowerSave = React.useCallback((fn: (() => Promise<void>) | null) => {
    powerSaveRef.current = fn;
  }, []);

  const handleBackToMain = (): void =>
    setSettingsView(
      settingsView === 'remote-one' || settingsView === 'remote-essence' ? 'remote' : 'main',
    );

  const handleSubViewSave = async (): Promise<void> => {
    if (settingsView === 'power' && powerSaveRef.current) {
      await powerSaveRef.current();
    }
    handleBackToMain();
  };

  return createPortal(
    <div
      className="zones-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zones-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`zones-modal zones-modal--${tab}`}>
        <header className="zones-modal__head">
          {inSubView ? (
            <button
              type="button"
              className="zones-modal__back"
              aria-label={t('zones.modal.backToSettings')}
              onClick={handleBackToMain}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : null}
          <div className="zones-modal__head-text">
            <p className="zones-modal__eyebrow">
              {tab === 'settings' ? t('zones.modal.settingsEyebrow') : t('zones.modal.outputEyebrow')}
            </p>
            <h3 id="zones-modal-title" className="zones-modal__title">
              {zone.name || `Zone ${zone.id}`}
            </h3>
            <p className="zones-modal__subtitle">{headSubtitle}</p>
          </div>
          <button type="button" className="zones-modal__close" aria-label={t('zones.modal.close')} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="zones-modal__body">
          {tab === 'output' ? (
            <ZoneOutputEditor
              zone={zone}
              definitions={transports}
              onChange={(config) => {
                void onTransportChange(config);
              }}
              onOutputLatency={onOutputLatency}
              saving={saving}
              describe={describeTransport}
            />
          ) : settingsView === 'main' ? (
            <div className="zset">
              {/* Playback */}
              <div className="zset-group">
                <p className="zset-group__head">{t('zones.modal.groupPlayback')}</p>
                <div className="zset-row">
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </span>
                  <div className="zset-row__text">
                    <span className="zset-row__title">{t('zones.modal.resetVolumeTitle')}</span>
                    <span className="zset-row__desc">{t('zones.modal.resetVolumeCopy')}</span>
                  </div>
                  <button
                    type="button"
                    className={`zones-hub__toggle${resetVolumeOnPauseOn ? ' is-on' : ''}`}
                    aria-label={t('zones.modal.resetVolumeTitle')}
                    onClick={() => {
                      const next = resetVolumeOnPauseOn
                        ? null
                        : { ...(zone.playback ?? {}), resetVolumeOnPause: true };
                      void onPlaybackChange(next);
                    }}
                    disabled={saving}
                  />
                </div>
              </div>

              {/* The box that plays this room, when one does: the three settings that come up while
                  setting a room up, rather than a trip to another screen for them. */}
              <ZoneDeviceSection zoneId={zone.id} outputClientId={sendspinOutputClientId(zone)} />

              {/* Inputs */}
              <div className="zset-group">
                <p className="zset-group__head">{t('zones.modal.inputs')}</p>
                <div className="zset-row">
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 17a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2" />
                      <polyline points="8 22 12 18 16 22" />
                    </svg>
                  </span>
                  <div className="zset-row__text">
                    <span className="zset-row__title">{t('zones.card.airplay')}</span>
                    <span className="zset-row__desc">{t('zones.modal.airplayEnabled')}</span>
                  </div>
                  <button
                    type="button"
                    className={`zones-hub__toggle${airplayOn ? ' is-on' : ''}`}
                    aria-label={t('zones.modal.airplayEnabled')}
                    onClick={() => onAirplayToggle(!airplayOn)}
                    disabled={saving}
                  />
                </div>
                <div className="zset-row">
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                      <line x1="2" y1="20" x2="2.01" y2="20" />
                    </svg>
                  </span>
                  <div className="zset-row__text">
                    <span className="zset-row__title">{t('zones.card.dlna')}</span>
                    <span className="zset-row__desc">{t('zones.modal.dlnaEnabled')}</span>
                  </div>
                  <button
                    type="button"
                    className={`zones-hub__toggle${dlnaOn ? ' is-on' : ''}`}
                    aria-label={t('zones.modal.dlnaEnabled')}
                    onClick={() => onDlnaToggle(!dlnaOn)}
                    disabled={saving}
                  />
                </div>
                {/* A phone playing to the room is a receiver, like AirPlay and DLNA -- it has more
                    to set up than a switch, so it opens rather than toggles. */}
                <button type="button" className="zset-drill" onClick={() => setSettingsView('bluetooth')}>
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 7l10 10-5 4V3l5 4L7 17" />
                    </svg>
                  </span>
                  <span className="zset-drill__text">
                    <span className="zset-drill__lab">{t('zones.bluetooth.useTitle')}</span>
                    <b className={`zset-drill__sum${bluetoothOn ? '' : ' zset-drill__sum--muted'}`}>
                      {bluetoothSummary}
                    </b>
                  </span>
                  <svg className="zset-drill__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <ZoneSpotifyConnectSection
                  zone={zone}
                  config={
                    deriveZoneInputs(zone).spotify ?? { enabled: spotifyOn, publishName: zone.name }
                  }
                  saving={saving}
                  hasAccount={hasSpotifyAccounts}
                  soloistInUse={soloistInUse}
                  onConnectToggle={onSpotifyConnectToggle}
                />
              </div>

              {/* Control — who drives this zone: a remote in the room, or another
                  system that owns its playback state. */}
              <div className="zset-group">
                <p className="zset-group__head">{t('zones.modal.groupControl')}</p>
                {/* One row, like Power and EQ: a remote is set up once, so the whole
                    thing folds away and the summary says whether it is on. */}
                <button type="button" className="zset-drill" onClick={() => setSettingsView('remote')}>
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="7" y="2" width="10" height="20" rx="3" />
                      <circle cx="12" cy="7" r="1.4" />
                      <line x1="9.5" y1="12" x2="14.5" y2="12" />
                      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" />
                    </svg>
                  </span>
                  <span className="zset-drill__text">
                    <span className="zset-drill__lab">{t('zones.beoremote.groupTitle')}</span>
                    <b className="zset-drill__sum">{beoremoteSummary}</b>
                  </span>
                  <svg className="zset-drill__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <div className="zset-row">
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="9" y="9" width="6" height="6" />
                      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                    </svg>
                  </span>
                  <div className="zset-row__text">
                    <span className="zset-row__title">{t('zones.modal.stateController')}</span>
                    <span className="zset-row__desc">{t('zones.modal.stateControllerDesc')}</span>
                  </div>
                  <select
                    className="zones-hub__select"
                    value={stateController}
                    disabled={saving}
                    aria-label={t('zones.stateController.ariaLabel')}
                    onChange={(event) => {
                      void onStateControllerChange(event.target.value);
                    }}
                  >
                    {stateControllers.map((ctrl) => (
                      <option key={ctrl.id} value={ctrl.id}>
                        {/* Translated when we know the id; otherwise the server's own
                            label, so a newly added controller is still readable. */}
                        {t(`zones.stateController.${ctrl.id}`, { defaultValue: ctrl.label })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Audio */}
              <div className="zset-group">
                <p className="zset-group__head">{t('zones.modal.groupAudio')}</p>
                <button type="button" className="zset-drill" onClick={() => setSettingsView('eq')}>
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                  </span>
                  <span className="zset-drill__text">
                    <span className="zset-drill__lab">{t('zones.modal.equalizerHandling')}</span>
                    <b className="zset-drill__sum">{eqSummary}</b>
                  </span>
                  <svg className="zset-drill__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {/* Power & system */}
              <div className="zset-group">
                <p className="zset-group__head">{t('zones.modal.groupSystem')}</p>
                <button type="button" className="zset-drill" onClick={() => setSettingsView('power')}>
                  <span className="zset-row__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                      <line x1="12" y1="2" x2="12" y2="12" />
                    </svg>
                  </span>
                  <span className="zset-drill__text">
                    <span className="zset-drill__lab">{t('zones.modal.powerManagement')}</span>
                    <b className="zset-drill__sum">{powerSummary}</b>
                  </span>
                  <svg className="zset-drill__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          ) : settingsView === 'remote' ? (
            <ZoneRemoteModelList
              config={deriveZoneInputs(zone).beoremote}
              onOpenOne={() => setSettingsView('remote-one')}
              onOpenEssence={() => setSettingsView('remote-essence')}
            />
          ) : settingsView === 'remote-one' ? (
            <ZoneBeoremoteSection
              zoneId={zone.id}
              outputClientId={sendspinOutputClientId(zone)}
              config={deriveZoneInputs(zone).beoremote}
              saving={saving}
              onChange={onBeoremoteChange}
            />
          ) : settingsView === 'remote-essence' ? (
            <ZoneEssenceSection
              outputClientId={sendspinOutputClientId(zone)}
              config={deriveZoneInputs(zone).beoremote}
              saving={saving}
              onChange={onBeoremoteChange}
            />
          ) : settingsView === 'bluetooth' ? (
            <ZoneBluetoothSection
              zoneId={zone.id}
              zoneName={zone.name}
              outputClientId={sendspinOutputClientId(zone)}
              config={deriveZoneInputs(zone).bluetooth}
              saving={saving}
              onChange={onBluetoothChange}
            />
          ) : settingsView === 'power' ? (
            <ZonePowerManagerSection
              zone={zone}
              config={zone.powerManager}
              powerGroups={powerGroups}
              saving={saving}
              onChange={async (powerManager) => {
                await onPowerManagerChange(powerManager);
              }}
              onSavePowerGroups={onPowerGroupsSave}
              registerSave={registerPowerSave}
              onCancel={onClose}
            />
          ) : (
            <ZoneEqualizerSection
              zone={zone}
              saving={saving}
              onChange={async (config) => {
                await onEqualizerChange(config);
              }}
            />
          )}
        </div>

        <footer className="zones-modal__foot">
          {tab === 'output' ? (
            <>
              <span className="zones-modal__foot-hint">{t('zones.modal.outputHint')}</span>
              <button
                type="button"
                className="zones-modal__btn zones-modal__btn--primary"
                onClick={onClose}
                disabled={saving}
              >
                {t('zones.modal.done')}
              </button>
            </>
          ) : (
            <>
              {!inSubView && canDelete && onDelete ? (
                <button
                  type="button"
                  className="zones-modal__btn zones-modal__btn--danger"
                  onClick={onDelete}
                  disabled={saving}
                >
                  {t('zones.modal.deleteZone')}
                </button>
              ) : null}
              <button
                type="button"
                className="zones-modal__btn"
                onClick={inSubView ? handleBackToMain : onClose}
                disabled={saving}
              >
                {inSubView ? t('zones.modal.back') : t('zones.modal.cancel')}
              </button>
              <button
                type="button"
                className="zones-modal__btn zones-modal__btn--primary"
                onClick={inSubView ? () => void handleSubViewSave() : onClose}
                disabled={saving}
              >
                {inSubView ? t('zones.modal.save') : t('zones.modal.apply')}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

interface SourceDescriptor {
  serial: string;
  label: string;
}

function groupZones(
  zones: Zone[],
  sources: Record<string, SourceDescriptor>,
  fallbackSerial?: string,
): ZoneGroup[] {
  const groups = new Map<string, ZoneGroup>();
  zones.forEach((zone) => {
    const sourceMac = zone.sourceMac?.toUpperCase() ?? fallbackSerial;
    const descriptor = (sourceMac && sources[sourceMac]) || null;
    const label = descriptor?.label || zone.source?.trim() || 'AudioServer';
    const serial = descriptor?.serial || sourceMac || zone.sourceSerial || label;
    const key = serial.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        label,
        sourceSerial: serial,
        zones: [zone],
      });
    } else {
      existing.zones.push(zone);
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildSourceDirectory(audioServer?: AudioServerConfig): Record<string, SourceDescriptor> {
  const directory: Record<string, SourceDescriptor> = {};
  if (!audioServer) return directory;

  const baseSerial = audioServer.macId?.toUpperCase() ?? null;
  if (baseSerial) {
    directory[baseSerial] = {
      serial: baseSerial,
      label: audioServer.name?.trim() || 'AudioServer',
    };
  }

  audioServer.extensions?.forEach((extension, index) => {
    const serial = extension.mac?.toUpperCase();
    if (!serial) return;
    directory[serial] = {
      serial,
      label: extension.name?.trim() || `Stereo Extension ${index + 1}`,
    };
  });

  return directory;
}

type InputBadge = {
  key: string;
  label: string;
  enabled: boolean;
  type?: 'airplay' | 'spotify';
  muted?: boolean;
  subtle?: boolean;
  disabled?: boolean;
};

export type SatelliteEntry = { clientId: string; latencyMs?: number };

/**
 * Normalize the sendspin `satellites` config into rich entries (clientId + optional per-speaker
 * latency). Accepts the rich `[{ clientId, latencyMs }]` form the UI now writes, a plain string[],
 * or the legacy comma-separated string — so older configs keep working.
 */
function parseSatellites(raw: unknown): SatelliteEntry[] {
  const out: SatelliteEntry[] = [];
  const seen = new Set<string>();
  const push = (clientId: unknown, latencyMs?: unknown): void => {
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const lat = typeof latencyMs === 'number' ? latencyMs : Number(latencyMs);
    out.push(Number.isFinite(lat) ? { clientId: id, latencyMs: lat } : { clientId: id });
  };
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'string') push(entry);
      else if (entry && typeof entry === 'object') {
        const e = entry as { clientId?: unknown; latencyMs?: unknown };
        push(e.clientId, e.latencyMs);
      }
    }
  } else if (typeof raw === 'string') {
    for (const part of raw.split(',')) push(part);
  }
  return out;
}

/** Client ids only, for membership checks. */
function parseSatelliteIds(raw: unknown): string[] {
  return parseSatellites(raw).map((entry) => entry.clientId);
}

/** Serialize satellite entries for persistence: rich array, or undefined when empty. */
function serializeSatellites(entries: SatelliteEntry[]): SatelliteEntry[] | undefined {
  return entries.length ? entries.map((e) => ({ clientId: e.clientId, ...(typeof e.latencyMs === 'number' ? { latencyMs: e.latencyMs } : {}) })) : undefined;
}

type ZoneOutputEditorProps = {
  zone: Zone;
  saving: boolean;
  definitions: TransportConfigDefinition[];
  onChange: (transport: ZoneTransportConfig | null) => void;
  // Live latency change (no output rebuild). clientId targets a satellite; null = primary/main.
  onOutputLatency: (clientId: string | null, latencyMs: number) => void;
  describe: (config: ZoneTransportConfig | null) => string;
};

type ZoneSpotifyConnectProps = {
  zone: Zone;
  config: ZoneInputConfig['spotify'] | null | undefined;
  saving: boolean;
  // Spotify Connect can't be enabled without at least one linked Spotify account.
  hasAccount: boolean;
  /** True while Spotify Soloist is the player, where being a Connect target cannot be declined. */
  soloistInUse: boolean;
  onConnectToggle: (enabled: boolean) => void;
};

type ZonePowerManagerProps = {
  zone: Zone;
  config: ZonePowerManagerConfig | null | undefined;
  powerGroups: PowerGroupConfig[];
  saving: boolean;
  onChange: (config: ZonePowerManagerConfig | null) => void | Promise<void>;
  onSavePowerGroups: (groups: PowerGroupConfig[]) => Promise<boolean>;
  /** Lets the enclosing modal footer trigger this panel's save (its own row is hidden). */
  registerSave?: (save: (() => Promise<void>) | null) => void;
  onCancel: () => void;
};

type ZoneEqualizerSectionProps = {
  zone: Zone;
  saving: boolean;
  onChange: (config: ZoneEqualizerConfig | null) => void | Promise<void>;
};

const EQ_PROVIDER_OPTIONS: ReadonlyArray<{ value: ZoneEqualizerProvider; labelKey: string }> = [
  { value: 'off', labelKey: 'zones.eq.off' },
  { value: 'builtin', labelKey: 'zones.eq.builtin' },
  { value: 'squeezelite-mr', labelKey: 'zones.eq.squeezeliteMr' },
];

function normalizeEqProvider(value: unknown): ZoneEqualizerProvider {
  if (value === 'squeezelite-mr') return 'squeezelite-mr';
  if (value === 'builtin') return 'builtin';
  return 'off';
}

function ZoneEqualizerSection({ zone, saving, onChange }: ZoneEqualizerSectionProps): JSX.Element {
  const { t } = useTranslation();
  const eq = zone.equalizer ?? null;
  const provider: ZoneEqualizerProvider = normalizeEqProvider(eq?.provider);
  const [callbackUrl, setCallbackUrl] = React.useState<string>(eq?.callbackUrl ?? '');

  React.useEffect(() => {
    setCallbackUrl(zone.equalizer?.callbackUrl ?? '');
  }, [zone.id, zone.equalizer?.callbackUrl]);

  const buildPayload = (
    nextProvider: ZoneEqualizerProvider,
    nextCallbackUrl: string,
  ): ZoneEqualizerConfig => {
    const next: ZoneEqualizerConfig = { provider: nextProvider };
    if (Array.isArray(eq?.bands)) {
      next.bands = [...eq!.bands!];
    }
    if (nextProvider === 'squeezelite-mr') {
      const trimmed = nextCallbackUrl.trim();
      if (trimmed) next.callbackUrl = trimmed;
    }
    return next;
  };

  function handleProviderChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    void onChange(buildPayload(normalizeEqProvider(event.target.value), callbackUrl));
  }

  function commitCallbackUrl(): void {
    if ((eq?.callbackUrl ?? '') === callbackUrl.trim()) return;
    void onChange(buildPayload(provider, callbackUrl));
  }

  return (
    <aside className="card card--pad-sm zone-equalizer-section">
      <div className="zone-output-fields">
        <label className="zone-output-field">
          <span>{t('zones.eq.provider')}</span>
          <select value={provider} onChange={handleProviderChange} disabled={saving}>
            {EQ_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </label>
        {provider === 'builtin' && (
          <div className="zone-eq-provider-detail">
            <p className="zone-eq-provider-detail__intro">
              {t('zones.eq.builtinDetail')}
            </p>
          </div>
        )}
        {provider === 'squeezelite-mr' && (
          <div className="zone-eq-provider-detail">
            <p className="zone-eq-provider-detail__intro">
              <Trans
                i18nKey="zones.eq.squeezeliteIntro"
                components={{ 1: <em />, 3: <code /> }}
              />
            </p>
            <label className="zone-output-field">
              <span>{t('zones.eq.callbackUrl')}</span>
              <input
                type="url"
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                onBlur={commitCallbackUrl}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={t('zones.eq.callbackPlaceholder')}
                disabled={saving}
              />
              <p className="zone-output-help">
                {t('zones.eq.callbackHelp')}
              </p>
            </label>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The sound quality a DLNA renderer is fed. `auto` lets the server ask the renderer what it
 * accepts, which is right until a device claims a format it cannot really play.
 */
type DlnaStreamFormat = 'auto' | 'mp3' | 'lossless';

function ZoneOutputEditor({
  zone,
  saving,
  definitions,
  onChange,
  onOutputLatency,
  describe,
}: ZoneOutputEditorProps): JSX.Element {
  const { t } = useTranslation();
  const primary = React.useMemo(() => getPrimaryTransport(zone), [zone]);
  const [selectedId, setSelectedId] = React.useState<string>(primary?.id ?? '');
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>(
    () => extractTransportFields(primary),
  );
  // Rich sendspin satellites (clientId + optional per-speaker latency) kept in their own optimistic
  // state, since fieldValues is string-only. Synced from the saved transport on (re)open.
  const [sendspinSatellites, setSendspinSatellites] = React.useState<SatelliteEntry[]>(
    () => parseSatellites((primary as Record<string, unknown> | null)?.satellites),
  );
  const [airplayDevices, setAirplayDevices] = React.useState<AirplayDevice[] | null>(null);
  const [discoveringAirplay, setDiscoveringAirplay] = React.useState(false);
  const [airplayError, setAirplayError] = React.useState<string | null>(null);
  const [castDevices, setCastDevices] = React.useState<GoogleCastDevice[] | null>(null);
  const [discoveringCast, setDiscoveringCast] = React.useState(false);
  const [castError, setCastError] = React.useState<string | null>(null);
  const [sendspinClients, setSendspinClients] = React.useState<SendspinClient[] | null>(null);
  const [discoveringSendspin, setDiscoveringSendspin] = React.useState(false);
  const [sendspinError, setSendspinError] = React.useState<string | null>(null);
  const [squeezeliteClients, setSqueezeliteClients] = React.useState<SqueezeliteClient[] | null>(
    null,
  );
  const [discoveringSqueezelite, setDiscoveringSqueezelite] = React.useState(false);
  const [squeezeliteError, setSqueezeliteError] = React.useState<string | null>(null);
  const [sonosDevices, setSonosDevices] = React.useState<SonosDevice[] | null>(null);
  const [discoveringSonos, setDiscoveringSonos] = React.useState(false);
  const [sonosError, setSonosError] = React.useState<string | null>(null);
  const [dlnaDevices, setDlnaDevices] = React.useState<DlnaDevice[] | null>(null);
  const [discoveringDlna, setDiscoveringDlna] = React.useState(false);
  const [dlnaError, setDlnaError] = React.useState<string | null>(null);
  const [dlnaManualHost, setDlnaManualHost] = React.useState('');
  const [snapcastClients, setSnapcastClients] = React.useState<SnapcastClient[] | null>(null);
  const [discoveringSnapcast, setDiscoveringSnapcast] = React.useState(false);
  const [snapcastError, setSnapcastError] = React.useState<string | null>(null);
  const [maPlayers, setMaPlayers] = React.useState<MusicAssistantPlayer[] | null>(null);
  const [discoveringMa, setDiscoveringMa] = React.useState(false);
  const [maError, setMaError] = React.useState<string | null>(null);
  const [maBridges, setMaBridges] = React.useState<MusicAssistantBridge[] | null>(null);
  const [loadingMaBridges, setLoadingMaBridges] = React.useState(false);
  const [maSelectedBridgeId, setMaSelectedBridgeId] = React.useState<string>('');
  const [maBridgeMode, setMaBridgeMode] = React.useState<'source' | 'sink'>('source');
  const activeAirplayHost =
    selectedId === 'airplay'
      ? fieldValues.host || (primary as any)?.host || ''
      : primary?.id === 'airplay'
        ? (primary as any)?.host ?? ''
        : '';
  const activeCastHost =
    selectedId === 'googleCast'
      ? fieldValues.host || (primary as any)?.host || ''
      : primary?.id === 'googleCast'
        ? (primary as any)?.host ?? ''
        : '';
  const activeSendspinId =
    selectedId === 'sendspin'
      ? fieldValues.clientId || (primary as any)?.clientId || ''
      : primary?.id === 'sendspin'
        ? (primary as any)?.clientId ?? ''
        : '';
  const activeSendspinSatellites = sendspinSatellites;
  const activeSendspinSatelliteIds = activeSendspinSatellites.map((entry) => entry.clientId);
  const activeSqueezeliteId =
    selectedId === 'squeezelite'
      ? fieldValues.playerId || (primary as any)?.playerId || ''
      : primary?.id === 'squeezelite'
        ? (primary as any)?.playerId ?? ''
        : '';
  const activeSqueezeliteName =
    selectedId === 'squeezelite'
      ? fieldValues.playerName || (primary as any)?.playerName || ''
      : primary?.id === 'squeezelite'
        ? (primary as any)?.playerName ?? ''
        : '';
  const activeSonosHost =
    selectedId === 'sonos'
      ? fieldValues.host || (primary as any)?.host || ''
      : primary?.id === 'sonos'
        ? (primary as any)?.host ?? ''
        : '';
  const activeDlnaHost =
    selectedId === 'dlna'
      ? fieldValues.host || (primary as any)?.host || ''
      : primary?.id === 'dlna'
        ? (primary as any)?.host ?? ''
        : '';
  const activeSendspinCastHost =
    selectedId === 'sendspin'
      ? fieldValues.host || ''
      : primary?.id === 'googleCast' && (primary as any)?.useSendspin
        ? (primary as any)?.host ?? ''
        : '';
  const activeSnapcastCastHost =
    selectedId === 'snapcast'
      ? fieldValues.host || (primary as any)?.host || ''
      : primary?.id === 'snapcast-cast'
        ? (primary as any)?.host ?? ''
        : '';

  const parseFriendlyName = (
    value: string | undefined,
  ): { primary: string; secondary?: string } => {
    if (!value) return { primary: '' };
    const atParts = value.split('@');
    const base = atParts.length > 1 ? atParts[atParts.length - 1] : value;
    return { primary: base.trim() };
  };

  const normalizeValue = (value: string | undefined): string => (value ?? '').trim().toLowerCase();
  const [deviceQuery, setDeviceQuery] = React.useState('');
  const normalizedDeviceQuery = normalizeValue(deviceQuery);
  const matchesDeviceQuery = (...values: Array<string | undefined | null>): boolean => {
    if (!normalizedDeviceQuery) return true;
    return values.some((value) => normalizeValue(String(value ?? '')).includes(normalizedDeviceQuery));
  };

  const tailLabel = (value: string | undefined): string => {
    if (!value) return '';
    const tokens = value.split(/[-.]/).map((part) => part.trim()).filter(Boolean);
    return tokens.length ? tokens[tokens.length - 1] : value.trim();
  };
  const formatSqueezeliteMeta = (client: SqueezeliteClient): string => {
    const state = client.state ? client.state.replace(/_/g, ' ') : '';
    const address = client.address ? `${client.address}${client.port ? `:${client.port}` : ''}` : '';
    const parts = [state, address].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('zones.output.squeezelite');
  };
  const activeSendspinCastLabel =
    (selectedId === 'sendspin' ? fieldValues.name : undefined) ||
    ((primary as any)?.name as string | undefined) ||
    tailLabel(activeSendspinCastHost);
  const activeSnapcastCastLabel =
    (selectedId === 'snapcast' ? fieldValues.name : undefined) ||
    ((primary as any)?.name as string | undefined) ||
    tailLabel(activeSnapcastCastHost);
  const definitionMap = React.useMemo(() => {
    const map = new Map<string, TransportConfigDefinition>();
    definitions.forEach((def) => map.set(def.id, def));
    return map;
  }, [definitions]);

  React.useEffect(() => {
    setSelectedId(effectiveTransportId(primary));
    setFieldValues(extractTransportFields(primary));
    setSendspinSatellites(parseSatellites((primary as Record<string, unknown> | null)?.satellites));
  }, [primary]);

  const selectedDefinition = selectedId ? definitionMap.get(selectedId) ?? null : null;
  const hasFallbackOption = Boolean(selectedId && !selectedDefinition && primary);
  const isAirplay = selectedDefinition?.id === 'airplay';
  const isGoogleCast = selectedDefinition?.id === 'googleCast';
  const isSendspin = selectedDefinition?.id === 'sendspin';
  const isSqueezelite = selectedDefinition?.id === 'squeezelite';
  const isSnapcast = selectedDefinition?.id === 'snapcast';
  const isSonos = selectedDefinition?.id === 'sonos';
  const isDlna = selectedDefinition?.id === 'dlna';
  const isMusicAssistant = selectedDefinition?.id === 'musicassistant';
  // What the server accepts is wider than what we offer (`flac`/`lossy` are aliases), so read
  // loosely and write one canonical value back.
  const dlnaStreamFormat: DlnaStreamFormat = ((): DlnaStreamFormat => {
    const raw = (fieldValues.streamFormat ?? '').trim().toLowerCase();
    if (raw === 'mp3' || raw === 'lossy') return 'mp3';
    if (raw === 'lossless' || raw === 'flac') return 'lossless';
    return 'auto';
  })();
  React.useEffect(() => {
    if (!isAirplay) {
      setAirplayDevices(null);
      setAirplayError(null);
      setDiscoveringAirplay(false);
    }
    if (!isGoogleCast && !isSendspin && !isSnapcast) {
      setCastDevices(null);
      setCastError(null);
      setDiscoveringCast(false);
    }
    if (!isSendspin) {
      setSendspinClients(null);
      setSendspinError(null);
      setDiscoveringSendspin(false);
    }
    if (!isSqueezelite) {
      setSqueezeliteClients(null);
      setSqueezeliteError(null);
      setDiscoveringSqueezelite(false);
    }
    if (!isSonos) {
      setSonosDevices(null);
      setSonosError(null);
      setDiscoveringSonos(false);
    }
    if (!isDlna) {
      setDlnaDevices(null);
      setDlnaError(null);
      setDiscoveringDlna(false);
      setDlnaManualHost('');
    }
    if (!isSnapcast) {
      setSnapcastClients(null);
      setSnapcastError(null);
      setDiscoveringSnapcast(false);
    }
    if (!isMusicAssistant) {
      setMaPlayers(null);
      setMaError(null);
      setDiscoveringMa(false);
      setMaBridges(null);
      setMaSelectedBridgeId('');
    }
  }, [isAirplay, isGoogleCast, isSendspin, isSqueezelite, isSonos, isDlna, isSnapcast, isMusicAssistant]);

  React.useEffect(() => {
    if (isAirplay && !airplayDevices && !discoveringAirplay) {
      void handleAirplayDiscovery();
    }
  }, [isAirplay, airplayDevices, discoveringAirplay]);

  React.useEffect(() => {
    if (isGoogleCast && !castDevices && !discoveringCast) {
      void handleGoogleCastDiscovery();
    }
  }, [isGoogleCast, castDevices, discoveringCast]);

  React.useEffect(() => {
    if ((isSendspin || isSnapcast) && !castDevices && !discoveringCast) {
      void handleGoogleCastDiscovery();
    }
  }, [isSendspin, isSnapcast, castDevices, discoveringCast]);

  React.useEffect(() => {
    if (isSendspin && !sendspinClients && !discoveringSendspin) {
      void handleSendspinDiscovery();
    }
  }, [isSendspin, sendspinClients, discoveringSendspin]);

  React.useEffect(() => {
    if (isSqueezelite && !squeezeliteClients && !discoveringSqueezelite) {
      void handleSqueezeliteDiscovery();
    }
  }, [isSqueezelite, squeezeliteClients, discoveringSqueezelite]);

  React.useEffect(() => {
    if (isSonos && !sonosDevices && !discoveringSonos) {
      void handleSonosDiscovery();
    }
  }, [isSonos, sonosDevices, discoveringSonos]);

  React.useEffect(() => {
    if (isDlna && !dlnaDevices && !discoveringDlna) {
      void handleDlnaDiscovery();
    }
  }, [isDlna, dlnaDevices, discoveringDlna]);

  React.useEffect(() => {
    if (isSnapcast && !snapcastClients && !discoveringSnapcast) {
      void handleSnapcastDiscovery();
    }
  }, [isSnapcast, snapcastClients, discoveringSnapcast]);

  // Load bridge list on mount so the MA output chip can be disabled when no
  // sink-mode bridge exists, without requiring the user to select MA first.
  React.useEffect(() => {
    if (maBridges !== null || loadingMaBridges) return;
    setLoadingMaBridges(true);
    setMaError(null);
    void (async () => {
      try {
        const bridges = await getMusicAssistantBridges();
        setMaBridges(bridges);
        const savedBridgeId = (fieldValues.bridgeId || (primary as any)?.bridgeId || '').trim();
        const sinkBridges = bridges.filter((b) => b.mode === 'sink' && b.enabled);
        const matchSaved = savedBridgeId
          ? bridges.find((b) => b.id.toLowerCase() === savedBridgeId.toLowerCase())
          : null;
        const initial = matchSaved ?? sinkBridges[0] ?? bridges[0] ?? null;
        if (initial) {
          setMaSelectedBridgeId(initial.id);
          setMaBridgeMode(initial.mode);
        } else {
          setMaError(t('zones.output.noMaBridge'));
        }
      } catch (err) {
        setMaError(err instanceof Error ? err.message : t('zones.output.maLoadFailed'));
      } finally {
        setLoadingMaBridges(false);
      }
    })();
  }, [maBridges, loadingMaBridges, fieldValues.bridgeId, primary]);

  // (Re)fetch players whenever the chosen bridge changes.
  React.useEffect(() => {
    if (!isMusicAssistant || !maSelectedBridgeId) return;
    void handleMusicAssistantDiscovery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMusicAssistant, maSelectedBridgeId]);


  function persist(transportId: string, values: Record<string, string>): void {
    if (!transportId) {
      onChange(null);
      return;
    }
    const definition = definitionMap.get(transportId);
    if (!definition) return;
    const payload: ZoneTransportConfig = { id: transportId };
    definition.fields.forEach((field) => {
      const value = values[field.id];
      if (value && value.trim()) {
        payload[field.id] = value.trim();
      }
    });
    onChange(payload);
  }

  function persistSqueezelite(values: Record<string, string>): void {
    const payload: ZoneTransportConfig = {
      ...((primary?.id === 'squeezelite' ? primary : null) ?? {}),
      id: 'squeezelite',
    };
    const definition = definitionMap.get('squeezelite');
    definition?.fields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(values, field.id)) return;
      const value = values[field.id];
      if (value && value.trim()) {
        payload[field.id] = value.trim();
      } else {
        delete payload[field.id];
      }
    });
    ['host', 'address'].forEach((fieldId) => {
      if (!Object.prototype.hasOwnProperty.call(values, fieldId)) return;
      const value = values[fieldId];
      if (value && value.trim()) {
        payload[fieldId] = value.trim();
      } else {
        delete payload[fieldId];
      }
    });
    onChange(payload);
  }

  function handleModuleSelect(nextId: string): void {
    setDeviceQuery('');
    setSelectedId(nextId);
    const nextValues = nextId === '' ? {} : extractDefaultFieldValues(nextId, definitionMap);
    setFieldValues(nextValues);
    if (nextId === 'airplay') {
      onChange(null);
      setAirplayDevices(null);
      setAirplayError(null);
      setDiscoveringAirplay(false);
      void handleAirplayDiscovery();
      return;
    }
    if (nextId === 'googleCast') {
      onChange(null);
      setCastDevices(null);
      setCastError(null);
      setDiscoveringCast(false);
      void handleGoogleCastDiscovery();
      return;
    }
    if (nextId === 'sendspin') {
      onChange(null);
      setSendspinClients(null);
      setSendspinError(null);
      setDiscoveringSendspin(false);
      void handleSendspinDiscovery();
      return;
    }
    if (nextId === 'squeezelite') {
      onChange(null);
      setSqueezeliteClients(null);
      setSqueezeliteError(null);
      setDiscoveringSqueezelite(false);
      void handleSqueezeliteDiscovery();
      return;
    }
    if (nextId === 'sonos') {
      onChange(null);
      setSonosDevices(null);
      setSonosError(null);
      setDiscoveringSonos(false);
      void handleSonosDiscovery();
      return;
    }
    if (nextId === 'dlna') {
      onChange(null);
      setDlnaDevices(null);
      setDlnaError(null);
      setDiscoveringDlna(false);
      setDlnaManualHost('');
      void handleDlnaDiscovery();
      return;
    }
    if (nextId === 'snapcast') {
      onChange(null);
      setSnapcastClients(null);
      setSnapcastError(null);
      setDiscoveringSnapcast(false);
      void handleSnapcastDiscovery();
      return;
    }
    persist(nextId, nextValues);
  }

  function handleFieldChange(fieldId: string, value: string): void {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function handleFieldBlur(): void {
    if (!selectedId) {
      onChange(null);
      return;
    }
    if (
      selectedId === 'airplay' ||
      selectedId === 'googleCast' ||
      selectedId === 'sendspin'
    ) {
      return;
    }
    if (selectedId === 'squeezelite') {
      persistSqueezelite(fieldValues);
      return;
    }
    persist(selectedId, fieldValues);
  }

  async function handleAirplayDiscovery(): Promise<void> {
    if (!isAirplay || discoveringAirplay) return;
    setDiscoveringAirplay(true);
    setAirplayError(null);
    try {
      const devices = await discoverAirplayDevices();
      setAirplayDevices(devices);
      if (!devices.length) {
        setAirplayError(t('zones.output.noAirplay'));
      }
    } catch (err) {
      setAirplayDevices([]);
      setAirplayError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringAirplay(false);
    }
  }

  function applyAirplayDevice(device: AirplayDevice): void {
    if (!selectedId) {
      setSelectedId('airplay');
    }
    // libraop drives RAOP (AirPlay 1) only. Prefer the device's RAOP
    // advertisement — it carries `et`/`md`, which the output needs at connect
    // time (a `4` in `et` triggers the MFi auth-setup the device requires). If
    // the user picked the AirPlay (AP2) entry, find its RAOP sibling by address.
    const addr = device.address || device.host;
    const raop =
      device.protocol === 'raop'
        ? device
        : (airplayDevices || []).find((d) => d.protocol === 'raop' && (d.address || d.host) === addr) ?? device;
    const host = raop.address || raop.host || '';
    const et = typeof raop.txt?.et === 'string' ? (raop.txt.et as string) : undefined;
    const md = typeof raop.txt?.md === 'string' ? (raop.txt.md as string) : undefined;
    // Preserve a previously-set per-output buffer override across a device re-pick.
    const existingBuffer = (primary as Record<string, unknown> | null)?.bufferMs;
    const payload: ZoneTransportConfig = {
      id: 'airplay',
      host,
      port: raop.port,
      name: device.name,
      ...(et !== undefined ? { et } : {}),
      ...(md !== undefined ? { md } : {}),
      ...(existingBuffer !== undefined && existingBuffer !== null && existingBuffer !== ''
        ? { bufferMs: existingBuffer }
        : {}),
    };
    onChange(payload);
  }

  // Commit the AirPlay read-ahead buffer override (ms) onto the active device's
  // transport. Rebuilds the output (the buffer applies at sender construction), so
  // we commit on blur rather than per keystroke. Empty clears the override (→750).
  function commitAirplayBuffer(): void {
    const base =
      primary && (primary.id ?? '').toLowerCase() === 'airplay'
        ? (primary as ZoneTransportConfig)
        : null;
    if (!base) return;
    const raw = (fieldValues.bufferMs ?? '').trim();
    const next = { ...base } as Record<string, unknown>;
    if (raw === '') {
      delete next.bufferMs;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      next.bufferMs = Math.min(5000, Math.max(250, Math.round(n)));
    }
    onChange(next as ZoneTransportConfig);
  }

  async function handleGoogleCastDiscovery(): Promise<void> {
    if (!(isGoogleCast || isSendspin || isSnapcast) || discoveringCast) return;
    setDiscoveringCast(true);
    setCastError(null);
    try {
      const devices = await discoverGoogleCastDevices();
      setCastDevices(devices);
      if (!devices.length) {
        setCastError(null);
      }
    } catch (err) {
      setCastDevices([]);
      setCastError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringCast(false);
    }
  }

  function applyGoogleCastDevice(device: GoogleCastDevice): void {
    if (!selectedId) {
      setSelectedId('googleCast');
    }
    const host = device.address || device.host || '';
    const payload: ZoneTransportConfig = {
      id: 'googleCast',
      host,
      name: device.name,
      useSendspin: undefined,
    };
    setFieldValues({
      host,
      name: device.name || '',
    });
    onChange(payload);
  }

  async function applyGoogleCastManual(): Promise<void> {
    const hostInput = (fieldValues.host ?? '').trim();
    const ipPattern = /^\d{1,3}(\.\d{1,3}){3}$/;
    if (!hostInput) {
      setCastError(t('zones.output.manualError'));
      return;
    }
    if (!ipPattern.test(hostInput)) {
      setCastError(t('zones.output.manualErrorIp'));
      return;
    }
    setCastError(null);
    setDiscoveringCast(true);
    try {
      const devices = await discoverGoogleCastDevices(hostInput);
      setCastDevices(devices);
      const match =
        devices.find((device) => device.address === hostInput || device.host === hostInput) ||
        devices[0];
      const resolvedHost = match?.address || match?.host || hostInput;
      const resolvedName = match?.name || tailLabel(resolvedHost) || t('zones.output.googleCast');
      const payload: ZoneTransportConfig = {
        id: 'googleCast',
        host: resolvedHost,
        name: resolvedName,
        useSendspin: undefined,
      };
      setFieldValues({
        host: resolvedHost,
        name: resolvedName,
      });
      onChange(payload);
      return;
    } catch (err) {
      setCastDevices([]);
      setCastError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.manualErrorProbe'),
      );
    } finally {
      setDiscoveringCast(false);
    }
  }

  async function handleSendspinDiscovery(): Promise<void> {
    if (!isSendspin || discoveringSendspin) return;
    setDiscoveringSendspin(true);
    setSendspinError(null);
    try {
      // Only things that can *play*. A device may also offer sources -- a line-in, a phone over
      // Bluetooth -- and those arrive in the same list; offering them here would invite someone to
      // pick a turntable as a room's loudspeaker. Clients found over mDNS carry no roles yet, and
      // they stay: a device that is advertising but not connected is exactly what this is for.
      const clients = (await discoverSendspinClients()).filter(
        (client) => !client.roles?.length || client.roles.includes('player@v1'),
      );
      setSendspinClients(clients);
      if (!clients.length) {
        setSendspinError(t('zones.output.noSendspin'));
      }
    } catch (err) {
      setSendspinClients([]);
      setSendspinError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringSendspin(false);
    }
  }

  async function handleSonosDiscovery(): Promise<void> {
    if (!isSonos || discoveringSonos) return;
    setDiscoveringSonos(true);
    setSonosError(null);
    try {
      const devices = await discoverSonosDevices({
        host: activeSonosHost,
      });
      setSonosDevices(devices);
      if (!devices.length) {
        setSonosError(t('zones.output.noSonos'));
      }
    } catch (err) {
      setSonosDevices([]);
      setSonosError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringSonos(false);
    }
  }

  function applySonosDevice(device: SonosDevice): void {
    if (!selectedId) {
      setSelectedId('sonos');
    }
    const payload: ZoneTransportConfig = {
      id: 'sonos',
      host: device.host,
      deviceName: device.name ?? device.roomName ?? '',
      householdId: device.householdId,
    };
    setFieldValues({
      host: device.host,
      deviceName: device.name ?? device.roomName ?? '',
      householdId: device.householdId ?? '',
    });
    onChange(payload);
  }

  async function handleDlnaDiscovery(host?: string): Promise<void> {
    if (!isDlna || discoveringDlna) return;
    setDiscoveringDlna(true);
    setDlnaError(null);
    try {
      const target = (host ?? activeDlnaHost) || undefined;
      const devices = await discoverDlnaDevices(target);
      setDlnaDevices(devices);
      if (!devices.length) {
        setDlnaError(t('zones.output.noDlna'));
      }
    } catch (err) {
      setDlnaDevices([]);
      setDlnaError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringDlna(false);
    }
  }

  function applyDlnaDevice(device: DlnaDevice): void {
    if (!selectedId) {
      setSelectedId('dlna');
    }
    const deviceName = device.name ?? '';
    const payload: ZoneTransportConfig = {
      id: 'dlna',
      host: device.host,
      deviceName,
    };
    const values: Record<string, string> = {
      host: device.host,
      deviceName,
    };
    // Keep the discovered AVTransport endpoint so playback still works even if a
    // later SSDP re-resolution comes up empty.
    if (device.controlUrl) {
      payload.controlUrl = device.controlUrl;
      values.controlUrl = device.controlUrl;
    }
    // A picked sound quality survives a device change — this list is not a reset button, and a
    // renderer that needed MP3 to play at all would silently go back to guessing.
    const keptFormat =
      primary?.id === 'dlna' && typeof primary.streamFormat === 'string'
        ? primary.streamFormat
        : fieldValues.streamFormat;
    if (keptFormat && keptFormat.trim()) {
      payload.streamFormat = keptFormat.trim();
      values.streamFormat = keptFormat.trim();
    }
    setFieldValues(values);
    onChange(payload);
  }

  /**
   * Write the sound quality without disturbing the device the picker chose. `auto` stores nothing
   * at all: the absence of a value is what the server reads as "ask the renderer".
   */
  function applyDlnaStreamFormat(next: DlnaStreamFormat): void {
    setFieldValues((prev) => {
      const values = { ...prev };
      if (next === 'auto') {
        delete values.streamFormat;
      } else {
        values.streamFormat = next;
      }
      return values;
    });
    const base = primary?.id === 'dlna' ? primary : {};
    const payload: ZoneTransportConfig = { ...base, id: 'dlna' };
    if (next === 'auto') {
      delete payload.streamFormat;
    } else {
      payload.streamFormat = next;
    }
    onChange(payload);
  }

  async function handleMusicAssistantDiscovery(): Promise<void> {
    if (!isMusicAssistant || discoveringMa) return;
    if (!maSelectedBridgeId) return;
    setDiscoveringMa(true);
    setMaError(null);
    try {
      const result = await discoverMusicAssistantPlayers(maSelectedBridgeId);
      setMaPlayers(result.devices);
      setMaBridgeMode(result.bridgeMode);
      if (result.bridgeMode !== 'sink') {
        setMaError(t('zones.output.maSourceMode'));
      } else if (!result.devices.length) {
        setMaError(t('zones.output.noMa'));
      }
    } catch (err) {
      setMaPlayers([]);
      setMaError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringMa(false);
    }
  }

  function applyMusicAssistantPlayer(player: MusicAssistantPlayer): void {
    if (!selectedId) {
      setSelectedId('musicassistant');
    }
    const playerName = player.name ?? player.id;
    const payload: ZoneTransportConfig = {
      id: 'musicassistant',
      bridgeId: maSelectedBridgeId,
      playerId: player.id,
      playerName,
    };
    setFieldValues({
      bridgeId: maSelectedBridgeId,
      playerId: player.id,
      playerName,
    });
    onChange(payload);
  }

  // ---- Sendspin speaker group: one leader (a sendspin client or a cast device running the
  // receiver) + N satellite clients, each with optional per-speaker latency. The leader is the
  // sync reference (no delay); satellites are delayed to align. Satellites persist as the rich
  // [{ clientId, latencyMs }] array the backend accepts. ----

  type SendspinLeader =
    | { kind: 'client'; clientId: string }
    | { kind: 'cast'; host: string; name?: string }
    | null;

  function currentSendspinLeader(): SendspinLeader {
    if (activeSendspinId) return { kind: 'client', clientId: activeSendspinId };
    if (activeSendspinCastHost) {
      return {
        kind: 'cast',
        host: activeSendspinCastHost,
        name: fieldValues.name || ((primary as Record<string, unknown> | null)?.name as string) || undefined,
      };
    }
    return null;
  }

  function persistSendspin(leader: SendspinLeader, sats: SatelliteEntry[]): void {
    if (!selectedId) setSelectedId('sendspin');
    setSendspinSatellites(sats);
    const satellites = serializeSatellites(sats);
    if (!leader) {
      onChange(null);
      return;
    }
    if (leader.kind === 'client') {
      setFieldValues({ clientId: leader.clientId });
      onChange({
        id: 'sendspin',
        clientId: leader.clientId,
        ...(satellites ? { satellites } : {}),
      } as unknown as ZoneTransportConfig);
    } else {
      setFieldValues({ host: leader.host, ...(leader.name ? { name: leader.name } : {}) });
      onChange({
        id: 'googleCast',
        host: leader.host,
        useSendspin: true,
        ...(leader.name ? { name: leader.name } : {}),
        ...(satellites ? { satellites } : {}),
      } as unknown as ZoneTransportConfig);
    }
  }

  // Pick the zone's Sendspin output (a client). Satellites are optional extras kept as-is, minus
  // this client if it happened to be one.
  function setSendspinMainClient(client: SendspinClient): void {
    persistSendspin(
      { kind: 'client', clientId: client.clientId },
      activeSendspinSatellites.filter((s) => s.clientId !== client.clientId),
    );
  }

  // Pick a cast device (running the Sendspin receiver) as the zone's output. Keeps any satellites.
  function setSendspinMainCast(device: GoogleCastDevice): void {
    const host = device.address || device.host || '';
    if (!host) return;
    persistSendspin({ kind: 'cast', host, name: device.name || undefined }, activeSendspinSatellites);
  }

  // Optional: add/remove a listen-only satellite client (only meaningful once a main output is set).
  function toggleSendspinSatellite(client: SendspinClient): void {
    const leader = currentSendspinLeader();
    if (!leader || client.clientId === activeSendspinId) return;
    const next = activeSendspinSatelliteIds.includes(client.clientId)
      ? activeSendspinSatellites.filter((s) => s.clientId !== client.clientId)
      : [...activeSendspinSatellites, { clientId: client.clientId }];
    persistSendspin(leader, next);
  }

  // Latency is applied LIVE (no output rebuild). clientId targets a satellite; null = main output.
  // Updates local state optimistically so the field reflects immediately, then hits the live endpoint.
  function commitLatency(clientId: string | null, value: string): void {
    const trimmed = value.trim();
    const ms = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.round(ms));
    if (clientId) {
      setSendspinSatellites((prev) =>
        prev.map((s) => (s.clientId === clientId ? { clientId, latencyMs: clamped } : s)),
      );
    }
    onOutputLatency(clientId, clamped);
  }

  const summary = primary ? describe(primary) : t('zones.modal.noOutput');

  async function handleSqueezeliteDiscovery(): Promise<void> {
    if (!isSqueezelite || discoveringSqueezelite) return;
    setDiscoveringSqueezelite(true);
    setSqueezeliteError(null);
    try {
      const clients = await discoverSqueezeliteClients();
      setSqueezeliteClients(clients);
      if (!clients.length) {
        setSqueezeliteError(t('zones.output.noSqueezelite'));
      }
    } catch (err) {
      setSqueezeliteClients([]);
      setSqueezeliteError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringSqueezelite(false);
    }
  }

  function applySqueezeliteClient(client: SqueezeliteClient): void {
    if (!selectedId) {
      setSelectedId('squeezelite');
    }
    const discoveredHost =
      (typeof client.address === 'string' ? client.address.trim() : '') ||
      (typeof (client as { host?: string | null }).host === 'string'
        ? ((client as { host?: string | null }).host ?? '').trim()
        : '');
    const nextFieldValues = {
      ...fieldValues,
      playerId: client.playerId,
      playerName: client.name || '',
      ...(discoveredHost ? { host: discoveredHost, address: discoveredHost } : {}),
    };
    setFieldValues(nextFieldValues);
    persistSqueezelite(nextFieldValues);
  }

  async function handleSnapcastDiscovery(): Promise<void> {
    if (!isSnapcast || discoveringSnapcast) return;
    setDiscoveringSnapcast(true);
    setSnapcastError(null);
    try {
      const clients = await discoverSnapcastClients();
      setSnapcastClients(clients);
      if (!clients.length) {
        setSnapcastError(t('zones.output.noSnapcast'));
      }
    } catch (err) {
      setSnapcastClients([]);
      setSnapcastError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('zones.output.discoveryFailed'),
      );
    } finally {
      setDiscoveringSnapcast(false);
    }
  }

  function applySnapcastClient(clientId: string): void {
    setSelectedId('snapcast');
    const payload: ZoneTransportConfig = {
      id: 'snapcast',
      clientIds: clientId,
    } as any;
    setFieldValues({ clientIds: clientId });
    onChange(payload);
  }


  function applySnapcastCastDevice(device: GoogleCastDevice): void {
    setSelectedId('snapcast');
    const host = device.address || device.host || '';
    const payload: ZoneTransportConfig = {
      id: 'snapcast-cast',
      host,
      name: device.name,
    };
    setFieldValues({
      host,
      name: device.name || '',
    });
    onChange(payload);
  }

  const hasSinkBridge = maBridges === null
    ? null
    : maBridges.some((b) => b.mode === 'sink' && b.enabled);
  const moduleOptions = definitions
    .filter((definition) => definition.id !== 'snapcast-cast')
    .map((definition) => {
      const active = definition.id === selectedId;
      // Disable MA output if no sink-mode bridge exists yet — keeps the option
      // visible so the user knows it's a thing, but blocks selection with a
      // tooltip pointing them to Content. Leave it enabled while the bridge
      // list is still loading, or when it's already the saved selection.
      const maDisabled =
        definition.id === 'musicassistant' && hasSinkBridge === false && !active;
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description ?? '',
        active,
        disabled: maDisabled,
        disabledReason: maDisabled
          ? t('zones.output.maDisabledTooltip')
          : undefined,
      };
    });
  const assetBase = import.meta.env.BASE_URL || '/';
  const providerIcon = (name: string) => `${assetBase}${name.replace(/^\//, '')}`;
  const moduleIcons: Record<string, string> = {
    airplay: providerIcon('providers/airplay.svg'),
    googleCast: providerIcon('providers/cast.svg'),
    sendspin: providerIcon('providers/sendspin.svg'),
    snapcast: providerIcon('providers/snapcast.svg'),
    sonos: providerIcon('providers/sonos.svg'),
    dlna: providerIcon('providers/dlna.svg'),
    squeezelite: providerIcon('providers/squeezelite.svg'),
  };
	  const airplayLoaded = airplayDevices !== null;
	  // A device advertises both _raop._tcp (AirPlay 1) and _airplay._tcp (AirPlay 2);
	  // collapse to one row per physical device (by address), preferring the RAOP
	  // advert since libraop is RAOP-only and it carries the et/port we need.
	  const airplayDeviceItems = Array.from(
	    (airplayDevices ?? [])
	      .reduce((map, device) => {
	        const key = (device.address || device.host || device.id).toLowerCase();
	        const existing = map.get(key);
	        if (!existing || (existing.protocol !== 'raop' && device.protocol === 'raop')) {
	          map.set(key, device);
	        }
	        return map;
	      }, new Map<string, AirplayDevice>())
	      .values(),
	  );
  const activeAirplayMatch =
    activeAirplayHost &&
    airplayDeviceItems.find((device) => (device.address || device.host) === activeAirplayHost);
  const activeAirplayLabel =
    activeAirplayMatch?.name ||
    fieldValues.name ||
    ((primary as any)?.name as string | undefined) ||
    tailLabel(activeAirplayHost);
  const airplayTiles = airplayLoaded
    ? [
        ...airplayDeviceItems.map((device) => ({
          device,
          host: device.address || device.host,
          active: activeAirplayHost && (device.address || device.host) === activeAirplayHost,
        })),
        ...(!activeAirplayMatch && activeAirplayHost
          ? [{ device: activeAirplayMatch, host: activeAirplayHost, active: true }]
          : []),
      ]
    : activeAirplayHost
      ? [{ device: activeAirplayMatch, host: activeAirplayHost, active: true }]
      : [];
	  const castLoaded = castDevices !== null;
	  const castDeviceItems = castDevices ?? [];
  const activeCastMatch =
    activeCastHost &&
    castDeviceItems.find((device) => (device.address || device.host) === activeCastHost);
  const activeCastLabel =
    activeCastMatch?.name ||
    fieldValues.name ||
    ((primary as any)?.name as string | undefined) ||
    tailLabel(activeCastHost);
  const castTiles = castLoaded
    ? [
        ...castDeviceItems.map((device) => ({
          device,
          host: device.address || device.host,
          active: activeCastHost && (device.address || device.host) === activeCastHost,
        })),
        ...(!activeCastMatch && activeCastHost
          ? [{ device: activeCastMatch, host: activeCastHost, active: true }]
          : []),
      ]
    : activeCastHost
      ? [{ device: activeCastMatch, host: activeCastHost, active: true }]
      : [];
	  const sendspinLoaded = sendspinClients !== null;
	  const sendspinDeviceItems = sendspinClients ?? [];
	  const sonosLoaded = sonosDevices !== null;
	  const sonosDeviceItems = sonosDevices ?? [];
	  const maPlayersLoaded = maPlayers !== null;
	  const maPlayerItems = maPlayers ?? [];
	  const activeMaPlayerId =
	    selectedId === 'musicassistant'
	      ? fieldValues.playerId || ((primary as any)?.playerId as string | undefined) || ''
	      : primary?.id === 'musicassistant'
	        ? ((primary as any)?.playerId as string | undefined) ?? ''
	        : '';
  const activeSonosMatch =
    activeSonosHost && sonosDeviceItems.find((device) => device.host === activeSonosHost);
  const activeSonosLabel =
    activeSonosMatch?.name ||
    fieldValues.deviceName ||
    ((primary as any)?.deviceName as string | undefined) ||
    tailLabel(activeSonosHost);
  const dlnaLoaded = dlnaDevices !== null;
  const dlnaDeviceItems = dlnaDevices ?? [];
  const activeDlnaMatch =
    activeDlnaHost && dlnaDeviceItems.find((device) => device.host === activeDlnaHost);
  const activeDlnaLabel =
    (activeDlnaMatch ? activeDlnaMatch.name : undefined) ||
    fieldValues.deviceName ||
    ((primary as any)?.deviceName as string | undefined) ||
    tailLabel(activeDlnaHost);
  const activeSendspinMatch =
    activeSendspinId && sendspinDeviceItems.find((client) => client.clientId === activeSendspinId);
  const activeSendspinLabel =
    activeSendspinMatch?.name || tailLabel(activeSendspinId);
	  const squeezeliteLoaded = squeezeliteClients !== null;
	  const squeezeliteDeviceItems = squeezeliteClients ?? [];
  const activeSqueezeliteMatch = activeSqueezeliteId
    ? squeezeliteDeviceItems.find((client) => client.playerId === activeSqueezeliteId)
    : activeSqueezeliteName
      ? squeezeliteDeviceItems.find(
          (client) => normalizeValue(client.name) === normalizeValue(activeSqueezeliteName),
        )
      : undefined;
  const activeSqueezeliteLabel =
    activeSqueezeliteMatch?.name ||
    fieldValues.playerName ||
    ((primary as any)?.playerName as string | undefined) ||
    tailLabel(activeSqueezeliteId);
	  const snapcastLoaded = snapcastClients !== null;
	  const snapcastDeviceItems = snapcastClients ?? [];

	  const discoveredSummary = (loaded: boolean, discovering: boolean, count: number): string => {
	    if (discovering) return t('zones.output.discovering');
	    if (!loaded) return '';
	    return t('zones.output.discovered', { count });
	  };
  const activeSnapcastIds = (fieldValues.clientIds ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const squeezeliteTiles = squeezeliteLoaded
    ? [
        ...squeezeliteDeviceItems.map((client) => ({
          device: client,
          host: client.playerId,
          active: activeSqueezeliteId
            ? client.playerId === activeSqueezeliteId
            : activeSqueezeliteName
              ? normalizeValue(client.name) === normalizeValue(activeSqueezeliteName)
              : false,
        })),
        ...(!activeSqueezeliteMatch && (activeSqueezeliteId || activeSqueezeliteName)
          ? [
              {
                device: activeSqueezeliteMatch,
                host: activeSqueezeliteId || activeSqueezeliteName,
                active: true,
              },
            ]
          : []),
      ]
    : activeSqueezeliteId || activeSqueezeliteName
      ? [
          {
            device: activeSqueezeliteMatch,
            host: activeSqueezeliteId || activeSqueezeliteName,
            active: true,
          },
        ]
      : [];
  const sonosTiles = sonosLoaded
    ? [
        ...sonosDeviceItems.map((device) => ({
          device,
          host: device.host,
          active: device.active ?? (activeSonosHost && device.host === activeSonosHost),
        })),
        ...(!activeSonosMatch && activeSonosHost
          ? [{ device: activeSonosMatch, host: activeSonosHost, active: true }]
          : []),
      ]
    : activeSonosHost
      ? [{ device: activeSonosMatch, host: activeSonosHost, active: true }]
      : [];
  const dlnaTiles = dlnaLoaded
    ? [
        ...dlnaDeviceItems.map((device) => ({
          device,
          host: device.host,
          active: Boolean(activeDlnaHost && device.host === activeDlnaHost),
        })),
        ...(!activeDlnaMatch && activeDlnaHost
          ? [{ device: activeDlnaMatch, host: activeDlnaHost, active: true }]
          : []),
      ]
    : activeDlnaHost
      ? [{ device: activeDlnaMatch, host: activeDlnaHost, active: true }]
      : [];

  return (
    <div className="zone-output-config">
      <div className="card card--pad-sm zone-output-editor">
        <div className="card__header">
          <div>
            <p className="card__title">{t('zones.output.type')}</p>
            <p className="card__subtitle">{t('zones.output.typeDesc')}</p>
          </div>
        </div>
        <div className="zone-output-editor__body">
          <div className="zone-output-selector">
            {definitions.length ? (
              <SelectMenu
                className="zone-output-select"
                label={t('zones.output.type')}
                value={moduleOptions.some((o) => o.active) ? selectedId ?? '' : ''}
                disabled={saving}
                options={[
                  // Unavailable types (e.g. Music Assistant without a sink bridge)
                  // are simply omitted — you can't pick them anyway.
                  ...(moduleOptions.some((o) => o.active)
                    ? []
                    : [{ value: '', label: t('zones.output.selectTypePlaceholder') }]),
                  ...moduleOptions
                    .filter((o) => !o.disabled)
                    .map((o) => ({
                      value: o.id,
                      label: o.label,
                      icon: moduleIcons[o.id] ? (
                        <img src={moduleIcons[o.id]} alt="" loading="lazy" />
                      ) : undefined,
                    })),
                ]}
                onChange={(next) => {
                  if (next) handleModuleSelect(next);
                }}
              />
            ) : (
              <p className="zone-detail-text muted">{t('zones.output.noTransports')}</p>
            )}
          </div>
          {definitions.length === 0 && (
            <p className="zone-detail-text muted">{t('zones.output.noTransports')}</p>
          )}
          {isDlna && (
            <div className="zone-output-fields">
              <div className="zone-output-field">
                <span>{t('zones.output.dlnaQuality')}</span>
                <SelectMenu
                  className="zone-output-select"
                  label={t('zones.output.dlnaQuality')}
                  value={dlnaStreamFormat}
                  disabled={saving}
                  options={[
                    { value: 'auto', label: t('zones.output.dlnaQualityAuto') },
                    { value: 'mp3', label: t('zones.output.dlnaQualityMp3') },
                    { value: 'lossless', label: t('zones.output.dlnaQualityLossless') },
                  ]}
                  onChange={applyDlnaStreamFormat}
                />
                <p className="zone-output-help">{t('zones.output.dlnaQualityDesc')}</p>
              </div>
            </div>
          )}
          {selectedDefinition &&
            !isAirplay &&
            !isGoogleCast &&
            !isSendspin &&
            !isSqueezelite &&
            !isSnapcast &&
            !isDlna &&
            !isMusicAssistant && (
            <div className="zone-output-fields">
              {selectedDefinition.fields.map((field) => (
                <label key={field.id} className="zone-output-field">
                  <span>{field.label}</span>
                  <input
                    type="text"
                    value={fieldValues[field.id] ?? ''}
                    onChange={(event) => handleFieldChange(field.id, event.target.value)}
                    onBlur={handleFieldBlur}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleFieldBlur();
                      }
                    }}
                    placeholder={field.placeholder}
                    disabled={saving}
                  />
                  {field.description && <p className="zone-output-help">{field.description}</p>}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="zone-output-config__devices">
        {isAirplay && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.devices')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.selectDevice')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(airplayLoaded, discoveringAirplay, airplayDeviceItems.length)}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {airplayError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleAirplayDiscovery()}
                    disabled={saving || discoveringAirplay}
                  >
                    {discoveringAirplay ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {airplayTiles.map((item, index) => {
                  const device = item.device;
                  if (!device) {
                    return (
                      <Row
                        key={`airplay-active-${item.host || index}`}
                        className="zone-device-row is-active zone-device-row--static"
                        title={<span className="row__name">{activeAirplayLabel}</span>}
                        subtitle={<span className="row__subtle">{t('zones.output.airplay')}</span>}
                        actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                      />
                    );
                  }
                  const friendly = parseFriendlyName(device.name);
                  const typeLabel = friendly.secondary || (device.protocol === 'airplay' ? t('zones.output.airplay2') : t('zones.output.airplay'));
                  if (
                    !matchesDeviceQuery(friendly.primary, friendly.secondary, device.name, device.address, device.host, typeLabel)
                  ) {
                    return null;
                  }
                  return (
                    <Row
                      key={device.id}
                      as="button"
                      type="button"
                      className={`zone-device-row${item.active ? ' is-active' : ''}`}
                      onClick={() => applyAirplayDevice(device)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{typeLabel}</span>}
                      actions={item.active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringAirplay || (!airplayLoaded && airplayDeviceItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`airplay-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringAirplay ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.airplayDevice')}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.discovering')}</span>}
                    />
                  ))}
              </div>
              {activeAirplayHost && (
                <label className="zone-output-field">
                  <span>{t('zones.output.airplayBuffer')}</span>
                  <input
                    type="number"
                    min={250}
                    max={5000}
                    step={50}
                    inputMode="numeric"
                    placeholder="750"
                    value={fieldValues.bufferMs ?? String((primary as Record<string, unknown> | null)?.bufferMs ?? '')}
                    onChange={(event) =>
                      setFieldValues((prev) => ({ ...prev, bufferMs: event.target.value }))
                    }
                    onBlur={() => commitAirplayBuffer()}
                    disabled={saving}
                  />
                  <span className="zone-output-discovery-panel__copy">
                    {t('zones.output.airplayBufferHint')}
                  </span>
                </label>
              )}
            </div>
          </div>
        )}
        {isGoogleCast && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.devices')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.selectDevice')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(castLoaded, discoveringCast, castDeviceItems.length)}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {castError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleGoogleCastDiscovery()}
                    disabled={saving || discoveringCast}
                  >
                    {discoveringCast ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {castTiles.map((item, index) => {
                  const device = item.device;
                  if (!device) {
                    return (
                      <Row
                        key={`cast-active-${item.host || index}`}
                        className="zone-device-row is-active zone-device-row--static"
                        title={<span className="row__name">{activeCastLabel}</span>}
                        subtitle={<span className="row__subtle">{t('zones.output.googleCast')}</span>}
                        actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                      />
                    );
                  }
                  const friendly = parseFriendlyName(device.name);
                  const typeLabel = friendly.secondary || tailLabel(device.manufacturer || device.model || t('zones.output.googleCast'));
                  if (
                    !matchesDeviceQuery(friendly.primary, friendly.secondary, device.name, device.address, device.host, typeLabel)
                  ) {
                    return null;
                  }
                  return (
                    <Row
                      key={device.id}
                      as="button"
                      type="button"
                      className={`zone-device-row${item.active ? ' is-active' : ''}`}
                      onClick={() => applyGoogleCastDevice(device)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{typeLabel}</span>}
                      actions={item.active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringCast || (!castLoaded && castDeviceItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`cast-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringCast ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.castDevice')}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.discovering')}</span>}
                    />
                  ))}
              </div>
            </div>
            {(!castDevices || castDevices.length === 0) && !discoveringCast && (
              <>
                <p className="zone-output-status">{t('zones.output.noCast')}</p>
                <div className="zone-output-manual">
                  <p className="zone-output-manual__eyebrow">{t('zones.output.manualCast')}</p>
                  <p className="zone-output-manual__title">{t('zones.output.probeTitle')}</p>
                  <div className="zone-output-manual__row">
                    <label className="zone-output-manual__field">
                      <span>{t('zones.output.castIp')}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.]*"
                        placeholder={t('zones.output.castIpPlaceholder')}
                        value={fieldValues.host ?? ''}
                        onChange={(event) => handleFieldChange('host', event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void applyGoogleCastManual();
                          }
                        }}
                        disabled={saving}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn--primary btn--compact"
                      onClick={() => void applyGoogleCastManual()}
                      disabled={saving || !fieldValues.host?.trim()}
                    >
                      {t('zones.output.discover')}
                    </button>
                  </div>
                  <p className="zone-output-manual__hint">
                    {t('zones.output.manualHint')}
                  </p>
                </div>
              </>
            )}
        </div>
      )}
        {isSonos && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.devices')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.selectDevice')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(sonosLoaded, discoveringSonos, sonosDeviceItems.length)}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {sonosError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleSonosDiscovery()}
                    disabled={saving || discoveringSonos}
                  >
                    {discoveringSonos ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {sonosTiles.map((item, index) => {
                  const device = item.device;
                  if (!device) {
                    return (
                      <Row
                        key={`sonos-active-${item.host || index}`}
                        className="zone-device-row is-active zone-device-row--static"
                        title={<span className="row__name">{activeSonosLabel}</span>}
                        subtitle={<span className="row__subtle">{t('zones.output.sonos')}</span>}
                        actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                      />
                    );
                  }
                  const friendly = parseFriendlyName(device.name || device.roomName || device.host);
                  const typeLabel = friendly.secondary || (device.householdId ? `${t('zones.output.sonos')} ${device.householdId}` : t('zones.output.sonos'));
                  if (!matchesDeviceQuery(friendly.primary, friendly.secondary, device.name, device.roomName, device.host, typeLabel)) {
                    return null;
                  }
                  return (
                    <Row
                      key={device.id}
                      as="button"
                      type="button"
                      className={`zone-device-row${item.active ? ' is-active' : ''}`}
                      onClick={() => applySonosDevice(device)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{typeLabel}</span>}
                      actions={item.active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringSonos || (!sonosLoaded && sonosDeviceItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`sonos-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringSonos ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.sonosDevice')}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.discovering')}</span>}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
        {isDlna && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
                <div className="zone-output-discovery-panel__title-stack">
                  <p className="zone-output-discovery-panel__title">{t('zones.output.devices')}</p>
                  <p className="zone-output-discovery-panel__copy">{t('zones.output.selectDevice')}</p>
                  <p className="zone-output-discovery-panel__meta">
                    {discoveredSummary(dlnaLoaded, discoveringDlna, dlnaDeviceItems.length)}
                  </p>
                  <p className="zone-output-discovery-panel__error" aria-live="polite">
                    {dlnaError || ''}
                  </p>
                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleDlnaDiscovery()}
                    disabled={saving || discoveringDlna}
                  >
                    {discoveringDlna ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {dlnaTiles.map((item, index) => {
                  const device = item.device;
                  if (!device) {
                    return (
                      <Row
                        key={`dlna-active-${item.host || index}`}
                        className="zone-device-row is-active zone-device-row--static"
                        title={<span className="row__name">{activeDlnaLabel}</span>}
                        subtitle={<span className="row__subtle">{t('zones.output.dlna')}</span>}
                        actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                      />
                    );
                  }
                  const friendly = parseFriendlyName(device.name || device.host);
                  const typeLabel = friendly.secondary || t('zones.output.dlna');
                  if (!matchesDeviceQuery(friendly.primary, friendly.secondary, device.name, device.host, typeLabel)) {
                    return null;
                  }
                  return (
                    <Row
                      key={device.id}
                      as="button"
                      type="button"
                      className={`zone-device-row${item.active ? ' is-active' : ''}`}
                      onClick={() => applyDlnaDevice(device)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{typeLabel}</span>}
                      actions={item.active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringDlna || (!dlnaLoaded && dlnaDeviceItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`dlna-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringDlna ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.dlnaDevice')}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.discovering')}</span>}
                    />
                  ))}
              </div>
            </div>
            {(!dlnaDevices || dlnaDevices.length === 0) && !discoveringDlna && (
              <>
                <p className="zone-output-status">{t('zones.output.noDlna')}</p>
                <div className="zone-output-manual">
                  <p className="zone-output-manual__eyebrow">{t('zones.output.manualDlna')}</p>
                  <p className="zone-output-manual__title">{t('zones.output.probeTitle')}</p>
                  <div className="zone-output-manual__row">
                    <label className="zone-output-manual__field">
                      <span>{t('zones.output.dlnaIp')}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.]*"
                        placeholder={t('zones.output.dlnaIpPlaceholder')}
                        value={dlnaManualHost}
                        onChange={(event) => setDlnaManualHost(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleDlnaDiscovery(dlnaManualHost.trim());
                          }
                        }}
                        disabled={saving}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn--primary btn--compact"
                      onClick={() => void handleDlnaDiscovery(dlnaManualHost.trim())}
                      disabled={saving || !dlnaManualHost.trim()}
                    >
                      {t('zones.output.discover')}
                    </button>
                  </div>
                  <p className="zone-output-manual__hint">
                    {t('zones.output.manualHint')}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        {isMusicAssistant && (() => {
          const bridgeIsSource =
            maBridges !== null && !!maSelectedBridgeId && maBridgeMode !== 'sink';
          return (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
                <div className="zone-output-discovery-panel__title-stack">
                  <p className="zone-output-discovery-panel__title">{t('zones.output.maPlayers')}</p>
                  <p className="zone-output-discovery-panel__copy">
                    {t('zones.output.maDesc')}
                  </p>
                  {!bridgeIsSource && (
                    <p className="zone-output-discovery-panel__meta">
                      {discoveredSummary(maPlayersLoaded, discoveringMa, maPlayerItems.length)}
                      {(() => {
                        if ((maBridges?.length ?? 0) !== 1) return null;
                        const single = maBridges?.[0];
                        if (!single) return null;
                        return <> · {single.label}</>;
                      })()}
                    </p>
                  )}
                  {!bridgeIsSource && maError && (
                    <p className="zone-output-discovery-panel__error" aria-live="polite">
                      {maError}
                    </p>
                  )}
                </div>
                {!bridgeIsSource && (
                  <div className="zone-output-discovery-panel__controls">
                    <label className="zone-output-search">
                      <span className="sr-only">{t('zones.output.filterPlayers')}</span>
                      <input
                        type="search"
                        placeholder={t('zones.output.filterPlayersPlaceholder')}
                        value={deviceQuery}
                        onChange={(event) => setDeviceQuery(event.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn--secondary btn--compact"
                      onClick={() => void handleMusicAssistantDiscovery()}
                      disabled={saving || discoveringMa || !maSelectedBridgeId}
                    >
                      {discoveringMa ? t('zones.output.refreshing') : t('zones.output.refresh')}
                    </button>
                  </div>
                )}
              </div>
              {(maBridges?.length ?? 0) > 1 && (
                <div className="zone-output-ma-bridge-tabs" role="tablist" aria-label={t('zones.output.maBridgeAriaLabel')}>
                  {(maBridges ?? []).map((bridge) => {
                    const usable = bridge.mode === 'sink' && bridge.enabled;
                    const isActive = bridge.id === maSelectedBridgeId;
                    return (
                      <button
                        key={bridge.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`zone-output-ma-bridge-tab${isActive ? ' is-active' : ''}${!usable ? ' is-disabled' : ''}`}
                        disabled={saving || !usable}
                        onClick={() => {
                          setMaSelectedBridgeId(bridge.id);
                          setMaBridgeMode(bridge.mode);
                          setMaPlayers(null);
                        }}
                      >
                        <span className="zone-output-ma-bridge-tab__label">{bridge.label}</span>
                        {bridge.mode !== 'sink' && (
                          <span className="zone-output-ma-bridge-tab__hint">{t('zones.output.maSourceModeShort')}</span>
                        )}
                        {!bridge.enabled && (
                          <span className="zone-output-ma-bridge-tab__hint">{t('zones.output.maDisabledShort')}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {bridgeIsSource && (
                <div className="zone-output-ma-source-notice" role="alert">
                  <p className="zone-output-ma-source-notice__title">
                    {t('zones.output.maSourceTitle')}
                  </p>
                  <p className="zone-output-ma-source-notice__body">
                    <Trans
                      i18nKey="zones.output.maSourceBody"
                      components={{ 1: <strong />, 3: <strong /> }}
                    />
                  </p>
                </div>
              )}
              {!bridgeIsSource && (
              <div className="zone-device-list zone-device-list--ma list-dividers">
                {maPlayerItems.map((player) => {
                  const label = player.name || player.id;
                  const providerLabel = formatMaProviderLabel(player.provider);
                  const idTail = player.id.length > 8 ? `…${player.id.slice(-6)}` : player.id;
                  if (!matchesDeviceQuery(label, player.provider, player.id)) {
                    return null;
                  }
                  const isActive = activeMaPlayerId === player.id;
                  const unavailable = player.available === false;
                  const disabledRow = saving || maBridgeMode !== 'sink' || unavailable || player.enabled === false;
                  return (
                    <Row
                      key={player.id}
                      as="button"
                      type="button"
                      className={`zone-device-row zone-device-row--ma${isActive ? ' is-active' : ''}${unavailable ? ' is-unavailable' : ''}`}
                      onClick={() => applyMusicAssistantPlayer(player)}
                      disabled={disabledRow}
                      leading={
                        <span
                          className={`zone-device-row__avatar zone-device-row__avatar--ma zone-device-row__avatar--${(player.provider || 'generic').toLowerCase()}`}
                          aria-hidden="true"
                        >
                          {maProviderInitial(player.provider, label)}
                        </span>
                      }
                      title={<span className="row__name">{label}</span>}
                      subtitle={
                        <span className="row__subtle zone-device-row__meta">
                          {providerLabel && <span className="zone-device-row__provider">{providerLabel}</span>}
                          <span className="zone-device-row__id">{idTail}</span>
                          {unavailable && <span className="chip chip--sm chip--warn">{t('zones.output.maOffline')}</span>}
                          {player.enabled === false && <span className="chip chip--sm chip--muted">{t('zones.output.maDisabledChip')}</span>}
                        </span>
                      }
                      actions={
                        isActive ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null
                      }
                    />
                  );
                })}
                {(discoveringMa || (!maPlayersLoaded && maPlayerItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`ma-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringMa ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.maPlayer')}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.discovering')}</span>}
                    />
                  ))}
              </div>
              )}
            </div>
          </div>
          );
        })()}
        {isSendspin && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.sendspinTitle')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.sendspinCopy')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(
	                      sendspinLoaded || castLoaded,
	                      discoveringSendspin || discoveringCast,
	                      (sendspinLoaded ? sendspinDeviceItems.length : 0) + (castLoaded ? castDeviceItems.length : 0),
	                    )}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {sendspinError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleSendspinDiscovery()}
                    disabled={saving || discoveringSendspin}
                  >
                    {discoveringSendspin ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              {(() => {
                const findClient = (id: string): SendspinClient | null =>
                  sendspinDeviceItems.find((c) => c.clientId === id) ?? null;
                const signalClass = (c: SendspinClient | null): string => {
                  if (!c) return '';
                  if (c.sourceState === 'error') return ' is-error';
                  if (c.sourceState === 'streaming' || c.sourceSignal === 'present') return ' is-on';
                  return '';
                };
                const hasMain = Boolean(activeSendspinId || activeSendspinCastHost);
                const mainLatency =
                  typeof (primary as Record<string, unknown> | null)?.latencyMs === 'number'
                    ? ((primary as Record<string, unknown>).latencyMs as number)
                    : undefined;
                // Satellites are optional: any discovered client other than the chosen main output.
                const satelliteCandidates = sendspinDeviceItems.filter((c) => c.clientId !== activeSendspinId);
                const showLoading =
                  discoveringSendspin ||
                  (!sendspinLoaded && sendspinDeviceItems.length === 0 && castDeviceItems.length === 0 && !hasMain);

                return (
                  <>
                    {/* Main output — pick one device, like the other transports. */}
                    <div className="zone-device-list list-dividers">
                      {sendspinDeviceItems.map((client) => {
                        const friendly = parseFriendlyName(client.name || client.clientId);
                        if (!matchesDeviceQuery(friendly.primary, client.name, client.clientId, client.address, client.host)) {
                          return null;
                        }
                        const isActive = activeSendspinId === client.clientId;
                        return (
                          <Row
                            key={client.id}
                            as="button"
                            type="button"
                            className={`zone-device-row${isActive ? ' is-active' : ''}`}
                            onClick={() => setSendspinMainClient(client)}
                            disabled={saving}
                            title={
                              <span className="row__name">
                                <i className={`spk-dot${signalClass(client)}`} aria-hidden="true" />
                                {friendly.primary}
                              </span>
                            }
                            subtitle={<span className="row__subtle">{client.address || client.host || t('zones.output.sendspin')}</span>}
                            actions={isActive ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                          />
                        );
                      })}
                      {activeSendspinId && !findClient(activeSendspinId) && (
                        <Row
                          className="zone-device-row is-active zone-device-row--static"
                          title={<span className="row__name">{activeSendspinLabel}</span>}
                          subtitle={<span className="row__subtle">{t('zones.output.sendspin')}</span>}
                          actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                        />
                      )}
                      {castDeviceItems.map((device) => {
                        const friendly = parseFriendlyName(device.name);
                        const isActive = activeSendspinCastHost === (device.address || device.host);
                        if (!matchesDeviceQuery(friendly.primary, device.name, device.address, device.host)) {
                          return null;
                        }
                        return (
                          <Row
                            key={`sendspin-cast-${device.id}`}
                            as="button"
                            type="button"
                            className={`zone-device-row${isActive ? ' is-active' : ''}`}
                            onClick={() => setSendspinMainCast(device)}
                            disabled={saving}
                            title={
                              <span className="row__name">
                                {friendly.primary}
                                <span className="spk-tag">{t('zones.output.castTag')}</span>
                              </span>
                            }
                            subtitle={<span className="row__subtle">{device.address || device.host || t('zones.output.castSendspin')}</span>}
                            actions={isActive ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                          />
                        );
                      })}
                      {activeSendspinCastHost &&
                        !castDeviceItems.some((d) => (d.address || d.host) === activeSendspinCastHost) && (
                          <Row
                            className="zone-device-row is-active zone-device-row--static"
                            title={<span className="row__name">{activeSendspinCastLabel}</span>}
                            subtitle={<span className="row__subtle">{t('zones.output.castSendspin')}</span>}
                            actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                          />
                        )}
                      {showLoading &&
                        Array.from({ length: 3 }).map((_, idx) => (
                          <Row
                            key={`sendspin-placeholder-${idx}`}
                            className={`zone-device-row zone-device-row--placeholder${discoveringSendspin ? ' zone-device-row--discovering' : ''}`}
                            title={<span className="row__name">{t('zones.output.sendspinClient')}</span>}
                            subtitle={
                              <span className="row__subtle">
                                {discoveringSendspin ? t('zones.output.discovering') : t('zones.output.noSendspinClients')}
                              </span>
                            }
                          />
                        ))}
                    </div>

                    {/* Main output delay — live, applied without rebuilding the output. */}
                    {hasMain && (
                      <div className="spk-mainlatency">
                        <span className="spk-mainlatency__label">{t('zones.output.mainDelay')}</span>
                        <label className="spk-latency" title={t('zones.output.mainDelayHint')}>
                          <input
                            key={`mainlat-${mainLatency ?? ''}`}
                            type="number"
                            min={0}
                            max={5000}
                            step={10}
                            defaultValue={typeof mainLatency === 'number' ? mainLatency : ''}
                            placeholder="0"
                            disabled={saving}
                            onBlur={(e) => commitLatency(null, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                          <span>ms</span>
                        </label>
                      </div>
                    )}

                    {/* Satellites — optional extra synced speakers. Only once a main output is chosen. */}
                    {hasMain && satelliteCandidates.length > 0 && (
                      <div className="zone-output-satellites">
                        <p className="spk-group__head">
                          {t('zones.output.sendspinSatellitesTitle')}
                          <span className="spk-tag">{t('zones.output.optional')}</span>
                        </p>
                        <p className="zone-output-discovery-panel__copy">{t('zones.output.sendspinSatellitesCopy')}</p>
                        <div className="zone-device-list list-dividers">
                          {satelliteCandidates.map((client) => {
                            const friendly = parseFriendlyName(client.name || client.clientId);
                            if (!matchesDeviceQuery(friendly.primary, client.name, client.clientId, client.address, client.host)) {
                              return null;
                            }
                            const sat = activeSendspinSatellites.find((s) => s.clientId === client.clientId);
                            const isSatellite = Boolean(sat);
                            return (
                              <Row
                                key={`spk-sat-${client.id}`}
                                className={`zone-device-row${isSatellite ? ' is-active' : ''}`}
                                title={
                                  <span className="row__name">
                                    <i className={`spk-dot${signalClass(client)}`} aria-hidden="true" />
                                    {friendly.primary}
                                  </span>
                                }
                                subtitle={<span className="row__subtle">{client.address || client.host || t('zones.output.sendspin')}</span>}
                                actions={
                                  <div className="spk-actions">
                                    {isSatellite && (
                                      <label className="spk-latency" title={t('zones.output.satelliteLatency')}>
                                        <input
                                          key={`lat-${client.clientId}-${sat?.latencyMs ?? ''}`}
                                          type="number"
                                          min={0}
                                          max={5000}
                                          step={10}
                                          defaultValue={typeof sat?.latencyMs === 'number' ? sat.latencyMs : ''}
                                          placeholder="0"
                                          disabled={saving}
                                          onBlur={(e) => commitLatency(client.clientId, e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              (e.target as HTMLInputElement).blur();
                                            }
                                          }}
                                        />
                                        <span>ms</span>
                                      </label>
                                    )}
                                    <button
                                      type="button"
                                      className={`chip chip--sm${isSatellite ? ' chip--static is-active' : ' chip--ghost'}`}
                                      disabled={saving}
                                      onClick={() => toggleSendspinSatellite(client)}
                                    >
                                      {isSatellite ? t('zones.output.satelliteActive') : t('zones.output.addSatellite')}
                                    </button>
                                  </div>
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
        {isSqueezelite && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.squeezeliteTitle')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.squeezeliteCopy')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(squeezeliteLoaded, discoveringSqueezelite, squeezeliteDeviceItems.length)}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {squeezeliteError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleSqueezeliteDiscovery()}
                    disabled={saving || discoveringSqueezelite}
                  >
                    {discoveringSqueezelite ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {squeezeliteTiles.map((item, index) => {
                  const client = item.device;
                  if (!client) {
                    return (
                      <Row
                        key={`squeezelite-active-${item.host || index}`}
                        className="zone-device-row is-active zone-device-row--static"
                        title={<span className="row__name">{activeSqueezeliteLabel || t('zones.output.squeezelitePlayer')}</span>}
                        subtitle={<span className="row__subtle">{t('zones.output.squeezelite')}</span>}
                        actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                      />
                    );
                  }
                  const friendly = parseFriendlyName(client.name || client.playerId);
                  const meta = friendly.secondary || formatSqueezeliteMeta(client);
                  if (!matchesDeviceQuery(friendly.primary, friendly.secondary, client.name, client.playerId, meta, t('zones.output.squeezelite'))) {
                    return null;
                  }
                  return (
                    <Row
                      key={client.playerId}
                      as="button"
                      type="button"
                      className={`zone-device-row${item.active ? ' is-active' : ''}`}
                      onClick={() => applySqueezeliteClient(client)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{meta}</span>}
                      actions={item.active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringSqueezelite ||
                  (!squeezeliteLoaded && squeezeliteDeviceItems.length === 0)) &&
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Row
                      key={`squeezelite-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringSqueezelite ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.squeezelitePlayer')}</span>}
                      subtitle={
                        <span className="row__subtle">
                          {discoveringSqueezelite ? t('zones.output.discovering') : t('zones.output.noSqueezeliteShort')}
                        </span>
                      }
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
        {isSnapcast && (
          <div className="zone-output-discovery">
            <div className="card card--pad-sm zone-output-discovery-panel zone-output-discovery-panel--visible">
              <div className="zone-output-discovery-panel__header">
	                <div className="zone-output-discovery-panel__title-stack">
	                  <p className="zone-output-discovery-panel__title">{t('zones.output.snapcastTitle')}</p>
	                  <p className="zone-output-discovery-panel__copy">{t('zones.output.snapcastCopy')}</p>
	                  <p className="zone-output-discovery-panel__meta">
	                    {discoveredSummary(
	                      snapcastLoaded || castLoaded,
	                      discoveringSnapcast || discoveringCast,
	                      (snapcastLoaded ? snapcastDeviceItems.length : 0) + (castLoaded ? castDeviceItems.length : 0),
	                    )}
	                  </p>
	                  <p className="zone-output-discovery-panel__error" aria-live="polite">
	                    {snapcastError || ''}
	                  </p>
	                </div>
                <div className="zone-output-discovery-panel__controls">
                  <label className="zone-output-search">
                    <span className="sr-only">{t('zones.output.filterDevices')}</span>
                    <input
                      type="search"
                      placeholder={t('zones.output.filterPlaceholder')}
                      value={deviceQuery}
                      onChange={(event) => setDeviceQuery(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary btn--compact"
                    onClick={() => void handleSnapcastDiscovery()}
                    disabled={saving || discoveringSnapcast}
                  >
                    {discoveringSnapcast ? t('zones.output.refreshing') : t('zones.output.refresh')}
                  </button>
                </div>
              </div>
              <div className="zone-device-list list-dividers">
                {snapcastDeviceItems.map((client, index) => {
                  const label = client.clientId || client.id || `client-${index}`;
                  const active = activeSnapcastIds.includes(label);
                  const typeLabel = client.streamId ? t('zones.output.streamPrefix', { id: client.streamId }) : t('zones.output.snapcast');
                  if (!matchesDeviceQuery(label, client.clientId, client.id, typeLabel, client.streamId, t('zones.output.snapcast'))) {
                    return null;
                  }
                  return (
                    <Row
                      key={`snapcast-${label}-${index}`}
                      as="button"
                      type="button"
                      className={`zone-device-row${active ? ' is-active' : ''}`}
                      onClick={() => applySnapcastClient(label)}
                      disabled={saving}
                      aria-pressed={active}
                      title={<span className="row__name">{label || t('zones.output.unknownClient')}</span>}
                      subtitle={<span className="row__subtle">{typeLabel}</span>}
                      actions={active ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {activeSnapcastCastHost &&
                  !castDeviceItems.some(
                    (device) => (device.address || device.host) === activeSnapcastCastHost,
                  ) && (
                    <Row
                      className="zone-device-row is-active zone-device-row--static"
                      title={<span className="row__name">{activeSnapcastCastLabel}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.castSnapcast')}</span>}
                      actions={<span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span>}
                    />
                  )}
                {castDeviceItems.map((device) => {
                  const friendly = parseFriendlyName(device.name);
                  const isActive =
                    activeSnapcastCastHost &&
                    (device.address || device.host) === activeSnapcastCastHost;
                  if (
                    !matchesDeviceQuery(
                      friendly.primary,
                      friendly.secondary,
                      device.name,
                      device.address,
                      device.host,
                      t('zones.output.castSnapcast'),
                    )
                  ) {
                    return null;
                  }
                  return (
                    <Row
                      key={`snapcast-cast-${device.id}`}
                      as="button"
                      type="button"
                      className={`zone-device-row${isActive ? ' is-active' : ''}`}
                      onClick={() => applySnapcastCastDevice(device)}
                      disabled={saving}
                      title={<span className="row__name">{friendly.primary}</span>}
                      subtitle={<span className="row__subtle">{t('zones.output.castSnapcast')}</span>}
                      actions={isActive ? <span className="chip chip--sm chip--static is-active">{t('zones.output.active')}</span> : null}
                    />
                  );
                })}
                {(discoveringSnapcast ||
                  (!snapcastLoaded &&
                    snapcastDeviceItems.length === 0 &&
                    castDeviceItems.length === 0 &&
                    !activeSnapcastCastHost)) &&
                  Array.from({ length: 2 }).map((_, idx) => (
                    <Row
                      key={`snapcast-placeholder-${idx}`}
                      className={`zone-device-row zone-device-row--placeholder${discoveringSnapcast ? ' zone-device-row--discovering' : ''}`}
                      title={<span className="row__name">{t('zones.output.snapclient')}</span>}
                      subtitle={
                        <span className="row__subtle">
                          {discoveringSnapcast ? t('zones.output.discovering') : t('zones.output.noSnapcastShort')}
                        </span>
                      }
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ZoneSpotifyConnectSection({
  zone,
  config,
  saving,
  hasAccount,
  soloistInUse,
  onConnectToggle,
}: ZoneSpotifyConnectProps): JSX.Element {
  const { t } = useTranslation();
  const effectiveConfig = config ?? { enabled: true, publishName: zone.name };
  // Soloist has no way not to advertise: running at all puts the room in the device list, and
  // `deactivate` only gives up being the active one. So while it is the player, this is not a
  // choice — shown on and locked, rather than a switch that quietly does nothing.
  const inputEnabled = soloistInUse || (hasAccount && effectiveConfig.enabled !== false);

  return (
    <div className="zset-row">
      <span className="zset-row__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M7 9.5c3.2-1 6.8-.7 9.5 1" />
          <path d="M7.5 13c2.6-.8 5.5-.5 7.7 1" />
          <path d="M8 16c2-.6 4.2-.4 5.9.8" />
        </svg>
      </span>
      <div className="zset-row__text">
        <span className="zset-row__title">{t('zones.spotify.connectTitle')}</span>
        <span className="zset-row__desc">
          {soloistInUse
            ? t('zones.spotify.connectAlways')
            : hasAccount
              ? t('zones.spotify.connectCopy')
              : t('zones.spotify.needAccount')}
        </span>
      </div>
      <button
        type="button"
        className={`zones-hub__toggle${inputEnabled ? ' is-on' : ''}`}
        aria-label={t('zones.spotify.connectTitle')}
        disabled={saving || !hasAccount || soloistInUse}
        title={
          soloistInUse
            ? t('zones.spotify.connectAlways')
            : hasAccount
              ? undefined
              : t('zones.spotify.needAccount')
        }
        onClick={() => !soloistInUse && onConnectToggle(!inputEnabled)}
      />
    </div>
  );
}

const POWER_URL_METHODS = ['GET', 'POST', 'PUT'] as const;

function powerUrlMethodOptions(value: unknown): string[] {
  const current = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!current || POWER_URL_METHODS.includes(current as (typeof POWER_URL_METHODS)[number])) {
    return [...POWER_URL_METHODS];
  }
  return [...POWER_URL_METHODS, current];
}

function ZonePowerManagerSection({
  zone,
  config,
  powerGroups,
  saving,
  onChange,
  onSavePowerGroups,
  registerSave,
  onCancel,
}: ZonePowerManagerProps): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<ZonePowerManagerConfig>(() => clonePowerManager(config));
  const [groupDrafts, setGroupDrafts] = React.useState<PowerGroupConfig[]>(() => clonePowerGroups(powerGroups));
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<'disabled' | 'gpio' | 'url' | 'udp' | 'crelay'>(() =>
    detectPowerMethod(config),
  );
  const selectedPowerGroup = powerGroups.find((group) => group.id === (draft.powerGroupId ?? '').trim()) ?? null;
  const editingGroup = groupDrafts.find((group) => group.id === editingGroupId) ?? null;

  React.useEffect(() => {
    setDraft(clonePowerManager(config));
    setMethod(detectPowerMethod(config));
  }, [config, zone.id]);

  React.useEffect(() => {
    setGroupDrafts(clonePowerGroups(powerGroups));
  }, [powerGroups]);

  const setBool = (path: string, value: boolean): void => {
    setDraft((prev) => setDraftValue(prev, path, value));
  };
  const setString = (path: string, value: string): void => {
    setDraft((prev) => setDraftValue(prev, path, value));
  };
  const setNumber = (path: string, value: string): void => {
    setDraft((prev) => setDraftValue(prev, path, value));
  };

  const save = async (): Promise<void> => {
    await onChange(normalizePowerManagerForSave(clonePowerManager(draft)));
  };

  // Keep the registered callback pointing at the current draft, so the modal footer
  // saves what is on screen rather than a stale closure.
  React.useEffect(() => {
    registerSave?.(save);
    return () => registerSave?.(null);
  }, [registerSave, draft]);
  const methodDescriptions: Record<'gpio' | 'url' | 'udp' | 'crelay', string> = {
    gpio: t('zones.power.descriptions.gpio'),
    url: t('zones.power.descriptions.url'),
    udp: t('zones.power.descriptions.udp'),
    crelay: t('zones.power.descriptions.crelay'),
  };
  const setSwitchingMethod = (nextMethod: 'disabled' | 'gpio' | 'url' | 'udp' | 'crelay'): void => {
    setMethod(nextMethod);
    setDraft((prev) => {
      const next = clonePowerManager(prev);
      next.gpio = { ...(next.gpio ?? {}), enabled: false };
      next.url = { ...(next.url ?? {}), enabled: false };
      next.udp = { ...(next.udp ?? {}), enabled: false };
      next.crelay = { ...(next.crelay ?? {}), enabled: false };
      if (nextMethod !== 'disabled') {
        (next as any)[nextMethod] = {
          ...((next as any)[nextMethod] ?? {}),
          enabled: true,
        };
      }
      return next;
    });
  };

  const startNewGroup = (): void => {
    const nextIndex = groupDrafts.length + 1;
    const nextName = t('zones.power.defaultGroupName', { index: nextIndex });
    const nextId = buildPowerGroupId(nextName, groupDrafts);
    const nextGroup: PowerGroupConfig = {
      id: nextId,
      name: nextName,
      powerManager: {},
    };
    setGroupDrafts((prev) => [...prev, nextGroup]);
    setDraft((prev) => ({ ...prev, powerGroupId: nextId }));
    setEditingGroupId(nextId);
  };

  const updateEditingGroup = (nextGroup: PowerGroupConfig): void => {
    setGroupDrafts((prev) => prev.map((group) => (group.id === editingGroupId ? nextGroup : group)));
    if ((draft.powerGroupId ?? '').trim() === editingGroupId) {
      setDraft((prev) => ({ ...prev, powerGroupId: nextGroup.id ?? '' }));
      setEditingGroupId(nextGroup.id ?? null);
    }
  };

  const removeEditingGroup = async (): Promise<void> => {
    if (!editingGroupId) return;
    const removedGroupId = editingGroupId;
    const nextGroups = groupDrafts.filter((group) => group.id !== removedGroupId);
    const ok = await onSavePowerGroups(nextGroups);
    if (!ok) {
      return;
    }
    setGroupDrafts(nextGroups);
    if ((draft.powerGroupId ?? '').trim() === removedGroupId) {
      setDraft((prev) => ({ ...prev, powerGroupId: '' }));
    }
    setEditingGroupId(null);
  };

  const saveGroups = async (): Promise<void> => {
    const ok = await onSavePowerGroups(groupDrafts);
    if (ok) {
      const currentGroupId = (draft.powerGroupId ?? '').trim();
      setEditingGroupId(currentGroupId || null);
    }
  };

  return (
    <div className="zone-power-manager">
      <section className="zone-power-panel">
        <div className="zone-power-panel__header">
          <div>
            <p className="zone-power-panel__eyebrow">{t('zones.power.sharedEyebrow')}</p>
            <p className="zone-power-panel__title">{t('zones.power.sharedTitle')}</p>
            <p className="zone-power-panel__subtitle">{t('zones.power.sharedSubtitle')}</p>
          </div>
        </div>
        <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--shared">
          <label className="zone-output-field">
            <span>{t('zones.power.sharedGroup')}</span>
            <div className="zone-power-group-row">
              <select
                value={draft.powerGroupId ?? ''}
                onChange={(event) => {
                  setString('powerGroupId', event.target.value);
                  setEditingGroupId(null);
                }}
                disabled={saving}
              >
                <option value="">{t('zones.power.none')}</option>
                {powerGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name?.trim() || group.id}
                  </option>
                ))}
              </select>
              <div className="zone-power-group-row__actions">
                <button type="button" className="btn btn--secondary btn--compact" onClick={startNewGroup} disabled={saving}>
                  {t('zones.power.new')}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--compact"
                  onClick={() => setEditingGroupId((draft.powerGroupId ?? '').trim() || null)}
                  disabled={saving || !(draft.powerGroupId ?? '').trim()}
                >
                  {t('zones.power.edit')}
                </button>
              </div>
            </div>
          </label>
        </div>
        <p className="zone-power-panel__method-copy">
          <Trans
            i18nKey="zones.power.currentGroup"
            values={{ name: selectedPowerGroup?.name?.trim() || selectedPowerGroup?.id || t('zones.power.noneGroup') }}
            components={{ 1: <strong /> }}
          />
        </p>
      </section>

      {editingGroup ? (
        <section className="zone-power-panel zone-power-panel--embedded">
          <div className="zone-power-panel__header">
            <div>
              <p className="zone-power-panel__eyebrow">{t('zones.power.sharedGroupEyebrow')}</p>
              <p className="zone-power-panel__title">{t('zones.power.editGroupTitle')}</p>
              <p className="zone-power-panel__subtitle">{t('zones.power.editGroupSub')}</p>
            </div>
          </div>
          <PowerGroupEditorCard
            group={editingGroup}
            saving={saving}
            onChange={updateEditingGroup}
            onRemove={() => void removeEditingGroup()}
            onSave={() => void saveGroups()}
          />
        </section>
      ) : null}

      <section className="zone-power-panel zone-power-panel--accent">
        <div className="zone-power-panel__header">
          <div>
            <p className="zone-power-panel__eyebrow">{t('zones.power.localEyebrow')}</p>
            <p className="zone-power-panel__title">{t('zones.power.localTitle')}</p>
            <p className="zone-power-panel__subtitle">{t('zones.power.localSubtitle')}</p>
          </div>
        </div>
        <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--general">
          <label className="zone-output-field">
            <span>{t('zones.power.preDelay')}</span>
            <input
              type="number"
              min={0}
              value={stringifyNumber(draft.playbackPreDelayMs)}
              onChange={(event) => setNumber('playbackPreDelayMs', event.target.value)}
              disabled={saving}
            />
            <small className="zone-output-field__hint">{t('zones.power.preDelayHelp')}</small>
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.offDelay')}</span>
            <input
              type="number"
              min={0}
              value={stringifyNumber(draft.offDelayMs)}
              onChange={(event) => setNumber('offDelayMs', event.target.value)}
              disabled={saving}
            />
            <small className="zone-output-field__hint">{t('zones.power.offDelayHelp')}</small>
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.switchingMethod')}</span>
            <select
              className="zone-power-switching-select"
              value={method}
              onChange={(event) =>
                setSwitchingMethod(
                  event.target.value as 'disabled' | 'gpio' | 'url' | 'udp' | 'crelay',
                )
              }
              disabled={saving}
            >
              <option value="disabled">{t('zones.power.method.disabled')}</option>
              <option value="gpio">{t('zones.power.method.gpio')}</option>
              <option value="url">{t('zones.power.method.url')}</option>
              <option value="udp">{t('zones.power.method.udp')}</option>
              <option value="crelay">{t('zones.power.method.crelay')}</option>
            </select>
          </label>
        </div>
        {method !== 'disabled' ? (
          <>
            <p className="zone-power-panel__method-copy">
              {methodDescriptions[method]}
            </p>
            {method === 'gpio' && (
              <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--gpio">
                <label className="zone-output-field">
                  <span>{t('zones.power.gpio.lineOffset')}</span>
                  <input
                    type="number"
                    min={0}
                    value={stringifyNumber(draft.gpio?.pin)}
                    onChange={(event) => setNumber('gpio.pin', event.target.value)}
                    disabled={saving}
                    placeholder="22"
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.gpio.activeHigh')}</span>
                  <select
                    value={draft.gpio?.activeHigh === false ? 'false' : 'true'}
                    onChange={(event) => setBool('gpio.activeHigh', event.target.value !== 'false')}
                    disabled={saving}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.gpio.chip')}</span>
                  <input
                    type="text"
                    value={draft.gpio?.chip ?? ''}
                    onChange={(event) => setString('gpio.chip', event.target.value)}
                    disabled={saving}
                    placeholder="gpiochip0"
                  />
                </label>
                <p className="zone-power-panel__method-copy">
                  <Trans
                    i18nKey="zones.power.gpio.example"
                    components={{ 1: <code />, 3: <code /> }}
                  />
                </p>
              </div>
            )}

            {method === 'url' && (
              <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--url">
                <label className="zone-output-field">
                  <span>{t('zones.power.url.onUrl')}</span>
                  <input
                    type="text"
                    value={draft.url?.onUrl ?? ''}
                    onChange={(event) => setString('url.onUrl', event.target.value)}
                    disabled={saving}
                    placeholder="http://device/on"
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.url.offUrl')}</span>
                  <input
                    type="text"
                    value={draft.url?.offUrl ?? ''}
                    onChange={(event) => setString('url.offUrl', event.target.value)}
                    disabled={saving}
                    placeholder="http://device/off"
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.url.onMethod')}</span>
                  <select
                    className="zone-power-switching-select"
                    value={(draft.url?.onMethod ?? '').trim().toUpperCase() || 'GET'}
                    onChange={(event) => setString('url.onMethod', event.target.value)}
                    disabled={saving}
                  >
                    {powerUrlMethodOptions(draft.url?.onMethod).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.url.offMethod')}</span>
                  <select
                    className="zone-power-switching-select"
                    value={(draft.url?.offMethod ?? '').trim().toUpperCase() || 'GET'}
                    onChange={(event) => setString('url.offMethod', event.target.value)}
                    disabled={saving}
                  >
                    {powerUrlMethodOptions(draft.url?.offMethod).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.url.onBody')}</span>
                  <textarea
                    value={formatRequestBody(draft.url?.onBody)}
                    onChange={(event) => setString('url.onBody', event.target.value)}
                    disabled={saving}
                    placeholder='{"power":"on"}'
                    rows={3}
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.url.offBody')}</span>
                  <textarea
                    value={formatRequestBody(draft.url?.offBody)}
                    onChange={(event) => setString('url.offBody', event.target.value)}
                    disabled={saving}
                    placeholder='{"standby":{"powerState":"standby"}}'
                    rows={3}
                  />
                </label>
              </div>
            )}

            {method === 'udp' && (
              <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--udp">
                <label className="zone-output-field">
                  <span>{t('zones.power.udp.host')}</span>
                  <input
                    type="text"
                    value={draft.udp?.host ?? ''}
                    onChange={(event) => setString('udp.host', event.target.value)}
                    disabled={saving}
                    placeholder="192.168.1.50"
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.udp.port')}</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={stringifyNumber(draft.udp?.port)}
                    onChange={(event) => setNumber('udp.port', event.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.udp.onPayload')}</span>
                  <input
                    type="text"
                    value={draft.udp?.onPayload ?? ''}
                    onChange={(event) => setString('udp.onPayload', event.target.value)}
                    disabled={saving}
                    placeholder="ON"
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.udp.offPayload')}</span>
                  <input
                    type="text"
                    value={draft.udp?.offPayload ?? ''}
                    onChange={(event) => setString('udp.offPayload', event.target.value)}
                    disabled={saving}
                    placeholder="OFF"
                  />
                </label>
              </div>
            )}

            {method === 'crelay' && (
              <div className="zone-output-fields zone-power-panel__fields zone-power-panel__fields--crelay">
                <label className="zone-output-field">
                  <span>{t('zones.power.crelay.serial')}</span>
                  <input
                    type="text"
                    value={draft.crelay?.serial ?? ''}
                    onChange={(event) => setString('crelay.serial', event.target.value)}
                    disabled={saving}
                    placeholder={t('zones.power.crelay.serialPlaceholder')}
                  />
                </label>
                <label className="zone-output-field">
                  <span>{t('zones.power.crelay.relay')}</span>
                  <input
                    type="text"
                    value={draft.crelay?.relay ?? ''}
                    onChange={(event) => setString('crelay.relay', event.target.value)}
                    disabled={saving}
                    placeholder="1"
                  />
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="zone-power-panel__method-copy">
            {t('zones.power.noLocal')}
          </p>
        )}
      </section>

      <div className="zone-output-modal__footer">
        <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
          {t('zones.power.cancel')}
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
          {t('zones.power.save')}
        </button>
      </div>
    </div>
  );
}

type PowerGroupEditorCardProps = {
  group: PowerGroupConfig;
  saving: boolean;
  onChange: (group: PowerGroupConfig) => void;
  onRemove: () => void;
  onSave: () => void;
};

function PowerGroupEditorCard({
  group,
  saving,
  onChange,
  onRemove,
  onSave,
}: PowerGroupEditorCardProps): JSX.Element {
  const { t } = useTranslation();
  const draft = React.useMemo(() => clonePowerGroup(group), [group]);
  const method = detectPowerMethod(group.powerManager ?? null);

  const updateGroup = (patch: Partial<PowerGroupConfig>): void => {
    onChange({
      ...draft,
      ...patch,
    });
  };

  const updatePowerManager = (patch: Partial<ZonePowerManagerConfig>): void => {
    onChange({
      ...draft,
      powerManager: {
        ...(draft.powerManager ?? {}),
        ...patch,
      },
    });
  };

  const setMethod = (nextMethod: 'disabled' | 'gpio' | 'url' | 'udp' | 'crelay'): void => {
    const next = cloneGroupPowerManager(draft.powerManager ?? null);
    next.gpio = { ...(next.gpio ?? {}), enabled: false };
    next.url = { ...(next.url ?? {}), enabled: false };
    next.udp = { ...(next.udp ?? {}), enabled: false };
    next.crelay = { ...(next.crelay ?? {}), enabled: false };
    if (nextMethod !== 'disabled') {
      (next as any)[nextMethod] = {
        ...((next as any)[nextMethod] ?? {}),
        enabled: true,
      };
    }
    updateGroup({ powerManager: next });
  };

  return (
    <div className="zone-power-group-editor">
      <div className="zone-power-group-editor__grid">
        <label className="zone-output-field">
          <span>{t('zones.power.name')}</span>
          <input
            type="text"
            value={draft.name ?? ''}
            onChange={(event) => updateGroup({ name: event.target.value })}
            disabled={saving}
            placeholder={t('zones.power.namePlaceholder')}
          />
        </label>
        <label className="zone-output-field">
          <span>{t('zones.power.switchingMethod')}</span>
          <select
            className="zone-power-switching-select"
            value={method}
            onChange={(event) => setMethod(event.target.value as any)}
            disabled={saving}
          >
            <option value="disabled">{t('zones.power.method.disabled')}</option>
            <option value="gpio">{t('zones.power.method.gpio')}</option>
            <option value="url">{t('zones.power.method.url')}</option>
            <option value="udp">{t('zones.power.method.udp')}</option>
            <option value="crelay">{t('zones.power.method.crelay')}</option>
          </select>
        </label>
        <label className="zone-output-field">
          <span>{t('zones.power.offDelay')}</span>
          <input
            type="number"
            min={0}
            value={stringifyNumber(draft.powerManager?.offDelayMs)}
            onChange={(event) =>
              updatePowerManager({
                offDelayMs: event.target.value as any,
              })
            }
            disabled={saving}
            placeholder="300000"
          />
        </label>
      </div>

      {method === 'gpio' && (
        <div className="zone-power-group-editor__grid zone-power-group-editor__grid--gpio">
          <label className="zone-output-field">
            <span>{t('zones.power.gpio.lineOffset')}</span>
            <input
              type="number"
              min={0}
              value={stringifyNumber(draft.powerManager?.gpio?.pin)}
              onChange={(event) =>
                updatePowerManager({
                  gpio: {
                    ...(draft.powerManager?.gpio ?? {}),
                    enabled: true,
                    pin: event.target.value as any,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.gpio.chipShort')}</span>
            <input
              type="text"
              value={draft.powerManager?.gpio?.chip ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  gpio: {
                    ...(draft.powerManager?.gpio ?? {}),
                    enabled: true,
                    chip: event.target.value,
                  },
                })
              }
              disabled={saving}
              placeholder="gpiochip0"
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.gpio.activeHigh')}</span>
            <select
              className="zone-power-switching-select"
              value={draft.powerManager?.gpio?.activeHigh === false ? 'false' : 'true'}
              onChange={(event) =>
                updatePowerManager({
                  gpio: {
                    ...(draft.powerManager?.gpio ?? {}),
                    enabled: true,
                    activeHigh: event.target.value !== 'false',
                  },
                })
              }
              disabled={saving}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </div>
      )}

      {method === 'url' && (
        <div className="zone-power-group-editor__grid">
          <label className="zone-output-field">
            <span>{t('zones.power.url.onUrl')}</span>
            <input
              type="text"
              value={draft.powerManager?.url?.onUrl ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    onUrl: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.url.offUrl')}</span>
            <input
              type="text"
              value={draft.powerManager?.url?.offUrl ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    offUrl: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.url.onMethod')}</span>
            <select
              className="zone-power-switching-select"
              value={(draft.powerManager?.url?.onMethod ?? '').trim().toUpperCase() || 'GET'}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    onMethod: event.target.value,
                  },
                })
              }
              disabled={saving}
            >
              {powerUrlMethodOptions(draft.powerManager?.url?.onMethod).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.url.offMethod')}</span>
            <select
              className="zone-power-switching-select"
              value={(draft.powerManager?.url?.offMethod ?? '').trim().toUpperCase() || 'GET'}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    offMethod: event.target.value,
                  },
                })
              }
              disabled={saving}
            >
              {powerUrlMethodOptions(draft.powerManager?.url?.offMethod).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.url.onBody')}</span>
            <textarea
              value={formatRequestBody(draft.powerManager?.url?.onBody)}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    onBody: event.target.value,
                  },
                })
              }
              disabled={saving}
              placeholder='{"power":"on"}'
              rows={3}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.url.offBody')}</span>
            <textarea
              value={formatRequestBody(draft.powerManager?.url?.offBody)}
              onChange={(event) =>
                updatePowerManager({
                  url: {
                    ...(draft.powerManager?.url ?? {}),
                    enabled: true,
                    offBody: event.target.value,
                  },
                })
              }
              disabled={saving}
              placeholder='{"standby":{"powerState":"standby"}}'
              rows={3}
            />
          </label>
        </div>
      )}

      {method === 'udp' && (
        <div className="zone-power-group-editor__grid">
          <label className="zone-output-field">
            <span>{t('zones.power.udp.host')}</span>
            <input
              type="text"
              value={draft.powerManager?.udp?.host ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  udp: {
                    ...(draft.powerManager?.udp ?? {}),
                    enabled: true,
                    host: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.udp.port')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={stringifyNumber(draft.powerManager?.udp?.port)}
              onChange={(event) =>
                updatePowerManager({
                  udp: {
                    ...(draft.powerManager?.udp ?? {}),
                    enabled: true,
                    port: event.target.value as any,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.udp.onPayload')}</span>
            <input
              type="text"
              value={draft.powerManager?.udp?.onPayload ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  udp: {
                    ...(draft.powerManager?.udp ?? {}),
                    enabled: true,
                    onPayload: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.udp.offPayload')}</span>
            <input
              type="text"
              value={draft.powerManager?.udp?.offPayload ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  udp: {
                    ...(draft.powerManager?.udp ?? {}),
                    enabled: true,
                    offPayload: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
        </div>
      )}

      {method === 'crelay' && (
        <div className="zone-power-group-editor__grid">
          <label className="zone-output-field">
            <span>{t('zones.power.crelay.serial')}</span>
            <input
              type="text"
              value={draft.powerManager?.crelay?.serial ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  crelay: {
                    ...(draft.powerManager?.crelay ?? {}),
                    enabled: true,
                    serial: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
          <label className="zone-output-field">
            <span>{t('zones.power.crelay.relay')}</span>
            <input
              type="text"
              value={draft.powerManager?.crelay?.relay ?? ''}
              onChange={(event) =>
                updatePowerManager({
                  crelay: {
                    ...(draft.powerManager?.crelay ?? {}),
                    enabled: true,
                    relay: event.target.value,
                  },
                })
              }
              disabled={saving}
            />
          </label>
        </div>
      )}

      <div className="zone-power-group-editor__actions">
        <button type="button" className="btn btn--danger btn--compact" onClick={onRemove} disabled={saving}>
          {t('zones.power.removeGroup')}
        </button>
        <button type="button" className="btn btn--primary btn--compact" onClick={onSave} disabled={saving}>
          {t('zones.power.saveGroup')}
        </button>
      </div>
    </div>
  );
}

function clonePowerGroup(group: PowerGroupConfig): PowerGroupConfig {
  return {
    id: group.id ?? '',
    name: group.name ?? '',
    powerManager: cloneGroupPowerManager(group.powerManager ?? null),
  };
}

function clonePowerGroups(groups: PowerGroupConfig[] | null | undefined): PowerGroupConfig[] {
  return Array.isArray(groups) ? groups.map((group) => clonePowerGroup(group)) : [];
}

function cloneGroupPowerManager(config: ZonePowerManagerConfig | null | undefined): ZonePowerManagerConfig {
  return {
    offDelayMs:
      typeof config?.offDelayMs === 'number' && Number.isFinite(config.offDelayMs)
        ? config.offDelayMs
        : typeof config?.offDelayMs === 'string'
          ? config.offDelayMs
          : 300000,
    gpio: { ...(config?.gpio ?? {}) },
    url: { ...(config?.url ?? {}) },
    udp: { ...(config?.udp ?? {}) },
    crelay: { ...(config?.crelay ?? {}) },
  };
}

function normalizePowerGroupsForSave(groups: PowerGroupConfig[]): PowerGroupConfig[] {
  return groups
    .map((group): PowerGroupConfig | null => {
      const id = typeof group.id === 'string' ? group.id.trim() : '';
      if (!id) return null;
      const normalizedPowerManager = normalizeGroupPowerManagerForSave(group.powerManager ?? null);
      return {
        id,
        name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : undefined,
        powerManager: normalizedPowerManager,
      };
    })
    .filter((group): group is PowerGroupConfig => group !== null);
}

function normalizeGroupPowerManagerForSave(
  config: ZonePowerManagerConfig | null | undefined,
): ZonePowerManagerConfig | null {
  if (!config) return null;
  const normalized: ZonePowerManagerConfig = {
    offDelayMs: toOptionalNumber(config.offDelayMs),
  };
  if (config.gpio?.enabled === true) {
    normalized.gpio = {
      enabled: true,
      pin: toOptionalNumber(config.gpio.pin),
      chip: trimOrUndefined(config.gpio.chip),
      activeHigh: config.gpio.activeHigh,
    };
  }
  if (config.url?.enabled === true) {
      normalized.url = {
        enabled: true,
        onUrl: trimOrUndefined(config.url.onUrl),
        offUrl: trimOrUndefined(config.url.offUrl),
        onMethod: trimOrUndefined(config.url.onMethod),
        offMethod: trimOrUndefined(config.url.offMethod),
        onBody: trimOrUndefined(config.url.onBody),
        offBody: trimOrUndefined(config.url.offBody),
      };
  }
  if (config.udp?.enabled === true) {
    normalized.udp = {
      enabled: true,
      host: trimOrUndefined(config.udp.host),
      port: toOptionalNumber(config.udp.port),
      onPayload: trimOrUndefined(config.udp.onPayload),
      offPayload: trimOrUndefined(config.udp.offPayload),
    };
  }
  if (config.crelay?.enabled === true) {
    normalized.crelay = {
      enabled: true,
      serial: trimOrUndefined(config.crelay.serial),
      relay: trimOrUndefined(config.crelay.relay),
    };
  }
  if (!normalized.gpio && !normalized.url && !normalized.udp && !normalized.crelay) {
    return null;
  }
  return normalized;
}

function buildPowerGroupId(name: string, groups: PowerGroupConfig[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'power-group';
  const used = new Set(
    groups
      .map((group) => (typeof group.id === 'string' ? group.id.trim().toLowerCase() : ''))
      .filter(Boolean),
  );
  if (!used.has(base)) {
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function detectPowerMethod(
  config: ZonePowerManagerConfig | null | undefined,
): 'disabled' | 'gpio' | 'url' | 'udp' | 'crelay' {
  if (config?.gpio?.enabled) return 'gpio';
  if (config?.url?.enabled) return 'url';
  if (config?.udp?.enabled) return 'udp';
  if (config?.crelay?.enabled) return 'crelay';
  return 'disabled';
}

function clonePowerManager(config: ZonePowerManagerConfig | null | undefined): ZonePowerManagerConfig {
  const withDefault = (value: unknown, fallback: number): number | string =>
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string'
        ? value
        : fallback;
  return {
    powerGroupId: typeof config?.powerGroupId === 'string' ? config.powerGroupId : '',
    playbackPreDelayMs: withDefault(config?.playbackPreDelayMs, 0) as any,
    offDelayMs: withDefault(config?.offDelayMs, 300000) as any,
    gpio: { ...(config?.gpio ?? {}) },
    url: { ...(config?.url ?? {}) },
    udp: { ...(config?.udp ?? {}) },
    crelay: { ...(config?.crelay ?? {}) },
  };
}

function setDraftValue(prev: ZonePowerManagerConfig, path: string, raw: string | boolean): ZonePowerManagerConfig {
  const next = clonePowerManager(prev);
  const parts = path.split('.');
  if (parts.length === 1) {
    const key = parts[0] as keyof ZonePowerManagerConfig;
    (next as any)[key] = raw;
    return next;
  }
  const [section, key] = parts;
  const target = { ...((next as any)[section] ?? {}) };
  if (typeof raw === 'string' && (key === 'pin' || key === 'offDelayMs' || key === 'port')) {
    (target as any)[key] = raw;
  } else {
    (target as any)[key] = raw;
  }
  (next as any)[section] = target;
  return next;
}

function stringifyNumber(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function formatRequestBody(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function normalizePowerManagerForSave(
  config: ZonePowerManagerConfig | null | undefined,
): ZonePowerManagerConfig | null {
  if (!config) {
    return null;
  }
  const normalized: ZonePowerManagerConfig = {
    powerGroupId: trimOrUndefined(config.powerGroupId),
    playbackPreDelayMs: toOptionalNumber(config.playbackPreDelayMs),
    offDelayMs: toOptionalNumber(config.offDelayMs),
  };

  const gpio = config.gpio ?? null;
  if (gpio?.enabled === true) {
    normalized.gpio = {
      enabled: true,
      pin: toOptionalNumber(gpio.pin),
      activeHigh: gpio.activeHigh,
      chip: trimOrUndefined(gpio.chip),
    };
  }

  const url = config.url ?? null;
  if (url?.enabled === true) {
      normalized.url = {
        enabled: true,
        onUrl: trimOrUndefined(url.onUrl),
        offUrl: trimOrUndefined(url.offUrl),
        onMethod: trimOrUndefined(url.onMethod),
        offMethod: trimOrUndefined(url.offMethod),
        onBody: trimOrUndefined(url.onBody),
        offBody: trimOrUndefined(url.offBody),
        insecure: url.insecure,
        curlPath: trimOrUndefined(url.curlPath),
      };
  }

  const udp = config.udp ?? null;
  if (udp?.enabled === true) {
    normalized.udp = {
      enabled: true,
      host: trimOrUndefined(udp.host),
      port: toOptionalNumber(udp.port),
      onPayload: trimOrUndefined(udp.onPayload),
      offPayload: trimOrUndefined(udp.offPayload),
    };
  }

  const crelay = config.crelay ?? null;
  if (crelay?.enabled === true) {
    normalized.crelay = {
      enabled: true,
      serial: trimOrUndefined(crelay.serial),
      relay: trimOrUndefined(crelay.relay),
      binaryPath: trimOrUndefined(crelay.binaryPath),
    };
  }

  const hasAnyAction = Boolean(normalized.gpio || normalized.url || normalized.udp || normalized.crelay);
  const hasGlobalTiming =
    Boolean(normalized.powerGroupId) ||
    (typeof normalized.playbackPreDelayMs === 'number' && normalized.playbackPreDelayMs > 0) ||
    (typeof normalized.offDelayMs === 'number' && normalized.offDelayMs > 0);
  if (!hasAnyAction && !hasGlobalTiming) {
    return null;
  }
  return normalized;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function describePowerManager(
  powerManager: ZonePowerManagerConfig | null | undefined,
  currentPowerState?: 'on' | 'off',
): string {
  const runtimeState = currentPowerState === 'on' ? 'on' : 'off';
  if (!powerManager) {
    return runtimeState;
  }
  const active: string[] = [];
  if (powerManager.gpio?.enabled) active.push('GPIO');
  if (powerManager.url?.enabled) active.push('URL');
  if (powerManager.udp?.enabled) active.push('UDP');
  if (powerManager.crelay?.enabled) active.push('CRelay');
  if (powerManager.powerGroupId?.trim()) active.push(`Group ${powerManager.powerGroupId.trim()}`);
  if (typeof powerManager.playbackPreDelayMs === 'number' && powerManager.playbackPreDelayMs > 0) {
    active.push(`Wake-up ${Math.round(powerManager.playbackPreDelayMs)}ms`);
  }
  if (active.length < 1) {
    return runtimeState;
  }
  return active.join(' + ');
}


function deriveZoneInputs(zone: Zone): ZoneInputConfig {
  return zone.inputs ? { ...buildDefaultInputs(zone), ...zone.inputs } : buildDefaultInputs(zone);
}

function resolveZoneStateController(zone: Zone): string {
  const raw = typeof zone.state?.controller === 'string' ? zone.state.controller.trim().toLowerCase() : '';
  const normalized = raw.replace(/[\s_-]+/g, '');
  if (normalized === 'beolink') return 'beolink';
  if (normalized === 'sonos') return 'sonos';
  if (normalized === 'musicassistant' || normalized === 'ma') return 'musicassistant';
  return 'internal';
}

function resolveStateControllerBinding(zone: Zone): { selectable: boolean; outputIp: string | null } {
  const primary = getPrimaryTransport(zone);
  // MA state controller binds to the zone's MA output by id, not by IP.
  if ((primary?.id ?? '').toLowerCase() === 'musicassistant') {
    return { selectable: true, outputIp: null };
  }
  const outputIp = extractOutputHostOrIp(primary);
  return {
    selectable: Boolean(outputIp),
    outputIp,
  };
}

function buildNextZoneState(
  previous: ZoneStateConfig | undefined,
  controller: string,
  outputIp: string | null,
): ZoneStateConfig {
  const next: ZoneStateConfig = { ...(previous ?? {}) };
  if (controller === 'musicassistant') {
    next.controller = 'musicassistant';
    delete (next as Record<string, unknown>).ip;
    return next;
  }
  if ((controller === 'beolink' || controller === 'sonos') && outputIp) {
    next.controller = controller;
    delete (next as Record<string, unknown>).ip;
    return next;
  }
  next.controller = 'internal';
  delete (next as Record<string, unknown>).ip;
  return next;
}

function resolveControllerForTransport(
  transport: ZoneTransportConfig | null,
  currentController: string,
  outputIp: string | null,
): string {
  if (!outputIp) return 'internal';
  const id = (readStringField(transport as Record<string, unknown>, 'id') ?? '').toLowerCase();
  if (id === 'sonos') return 'sonos';
  if (currentController === 'sonos') return 'internal';
  return currentController;
}

function extractOutputHostOrIp(transport: ZoneTransportConfig | null): string | null {
  if (!transport) return null;
  const record = transport as Record<string, unknown>;
  const direct =
    pickNonEmptyString(record.host) ??
    pickNonEmptyString(record.ip) ??
    pickNonEmptyString(record.address);
  if (direct) return direct;

  const controlUrl = pickNonEmptyString(record.controlUrl);
  if (!controlUrl) return null;
  try {
    const parsed = new URL(controlUrl);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function pickNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Receivers are opt-in per player, so every one starts off. */
function buildDefaultInputs(zone: Zone): ZoneInputConfig {
  return {
    airplay: {
      enabled: false,
      model: 'generic',
    },
    spotify: {
      enabled: false,
      publishName: zone.name,
    },
    lineIn: null,
  };
}

/**
 * The Sendspin client this room plays through, if it plays through one.
 *
 * Both radio sections ask this to work out which device a room means when it has not named one, and
 * the server resolves it the same way — so what the screen offers is what will happen.
 */
function sendspinOutputClientId(zone: Zone): string | undefined {
  const transport = getPrimaryTransport(zone);
  if (!transport || (transport.id ?? '').toLowerCase() !== 'sendspin') return undefined;
  const clientId = readStringField(transport as any, 'clientId');
  return clientId?.trim() || undefined;
}

function getPrimaryTransport(zone: Zone): ZoneTransportConfig | null {
  if (zone.transport) return zone.transport;
  if (Array.isArray(zone.transports) && zone.transports.length > 0) {
    return zone.transports[0] ?? null;
  }
  return null;
}

// Maps a stored transport to the base transport it should be recognised as in the UI. Sendspin-
// and Snapcast-over-Cast are persisted on the Google Cast config (id 'googleCast' + a useSendspin/
// useSnapcast flag, or the dedicated 'snapcast-cast' id), but the admin presents and configures
// them under the Sendspin/Snapcast sections — so for section selection and labels we resolve them
// back. Purely cosmetic: the saved config (and playback) is unchanged.
function effectiveTransportId(config: ZoneTransportConfig | null): string {
  if (!config?.id) return '';
  const id = String(config.id);
  if (id === 'snapcast-cast') return 'snapcast';
  if (id === 'googleCast' && (config as Record<string, unknown>).useSendspin) return 'sendspin';
  if (id === 'googleCast' && (config as Record<string, unknown>).useSnapcast) return 'snapcast';
  return id;
}

function zoneHasWebPlayer(zone: Zone): boolean {
  if (!Array.isArray(zone.transports)) return false;
  return zone.transports.some((transport) => {
    const id = (transport?.id || '').toLowerCase();
    const castSendspin = id === 'googlecast' && (transport as any)?.useSendspin;
    const castSnapcast = id === 'googlecast' && (transport as any)?.useSnapcast;
    return (
      id === 'snapcast' ||
      id === 'snapcast-cast' ||
      id === 'sendspin' ||
      id === 'sendspin-cast' ||
      castSendspin ||
      castSnapcast
    );
  });
}

function extractClientIds(config: ZoneTransportConfig | null): string[] {
  if (!config) return [];
  const record = config as Record<string, unknown>;
  const raw = record.clientIds;
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

const MA_PROVIDER_LABELS: Record<string, string> = {
  airplay: 'AirPlay',
  sonos: 'Sonos',
  chromecast: 'Chromecast',
  googlecast: 'Chromecast',
  snapcast: 'Snapcast',
  squeezelite: 'Squeezelite',
  slimproto: 'Squeezebox',
  dlna: 'DLNA',
  upnp: 'DLNA',
  bluesound: 'Bluesound',
  heos: 'HEOS',
  builtin_player: 'Built-in player',
  sendspin: 'Sendspin',
  player_group: 'Player group',
};

function formatMaProviderLabel(provider?: string): string {
  if (!provider) return '';
  const key = provider.toLowerCase();
  if (MA_PROVIDER_LABELS[key]) return MA_PROVIDER_LABELS[key];
  return provider
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function maProviderInitial(provider?: string, fallback?: string): string {
  const source = (provider && provider.trim()) || (fallback && fallback.trim()) || '?';
  const cleaned = source.replace(/^[^a-z0-9]+/i, '');
  return (cleaned.charAt(0) || '?').toUpperCase();
}

function describeTransport(config: ZoneTransportConfig | null): string {
  if (!config) return '';
  const record = config as Record<string, unknown>;
  const id = (config.id ?? '').toLowerCase();
  if (id === 'sendspin') {
    const clientId = readStringField(record, 'clientId');
    if (clientId) return normalizeOutputName(clientId);
  }
  if (id === 'snapcast') {
    const clientIds = readStringField(record, 'clientIds');
    if (clientIds) {
      const first = clientIds.split(',')[0]?.trim();
      if (first) return normalizeOutputName(first);
    }
  }
  if (id === 'squeezelite') {
    const playerName = readStringField(record, 'playerName');
    if (playerName) return normalizeOutputName(playerName);
    const playerId = readStringField(record, 'playerId');
    if (playerId) return normalizeOutputName(playerId);
  }
  if (id === 'dlna') {
    const host = readStringField(record, 'host');
    if (host) return normalizeOutputName(host);
    const controlUrl = readStringField(record, 'controlUrl');
    if (controlUrl) return normalizeOutputName(controlUrl);
  }
  if (id === 'sonos') {
    const host = readStringField(record, 'host');
    if (host) return normalizeOutputName(host);
    const controlUrl = readStringField(record, 'controlUrl');
    if (controlUrl) return normalizeOutputName(controlUrl);
  }
  if (id === 'musicassistant') {
    const playerName = readStringField(record, 'playerName');
    if (playerName) return normalizeOutputName(playerName);
    const playerId = readStringField(record, 'playerId');
    if (playerId) return normalizeOutputName(playerId);
  }
  const name = readStringField(record, 'name');
  if (name) return normalizeOutputName(name);
  const label = readStringField(record, 'label');
  if (label) return normalizeOutputName(label);
  return config.id ?? 'Output';
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const raw = record[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOutputName(value: string): string {
  const trimmed = value.trim();
  let normalized = trimmed;
  const prefix = 'sendspin-cli-';
  if (normalized.toLowerCase().startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }
  if (normalized.toLowerCase().endsWith('.localdomain')) {
    normalized = normalized.slice(0, -12);
  }
  return normalized || trimmed;
}

function extractTransportFields(config: ZoneTransportConfig | null): Record<string, string> {
  if (!config) return {};
  const record = config as Record<string, unknown>;
  return Object.entries(record).reduce<Record<string, string>>((acc, [key, value]) => {
    if (key === 'id') return acc;
    if (typeof value === 'string') {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function extractDefaultFieldValues(
  transportId: string,
  definitions: Map<string, TransportConfigDefinition>,
): Record<string, string> {
  const definition = definitions.get(transportId);
  if (!definition) return {};
  return definition.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.id] = '';
    return acc;
  }, {});
}
