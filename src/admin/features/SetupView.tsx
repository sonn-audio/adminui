import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import './SetupView.css';
import { fetchStatus, StatusResponse } from '../services/statusApi';
import {
  clearServerConfig,
  getConfig,
  importServerConfig,
  reinitializeServer,
  updateAdminUi,
  updateComponentPackage,
  updateCrossfadeSec,
  updatePlayer,
  updateServer,
  updateGroupsConfig,
} from '../services/setupApi';
import { updateContentConfig } from '../services/contentApi';
import { uploadEventSound } from '../services/eventSoundsApi';
import { usePolling } from '../hooks/usePolling';
import { useGlobalAlert } from '../components/GlobalAlert';
import { useUpdateCheck } from '../components/UpdateCheckContext';
import { componentPackageNames, compareSemver, normalizeTag } from '../services/updateCheck';
import SubTabs from '../components/SubTabs';
import SonnClientsSection from './SonnClientsSection';
import { SubPanel, useSubPanelTransition } from '../components/SubPanel';
import { useConfirm } from '../components/ConfirmDialog';
import { useServerControl } from '../components/ServerControl';
import InlineState from '../components/InlineState';
import type { OpenAiTtsFormat, RootConfig } from '../types/config';
import { copyText } from '../utils/clipboard';
import { formatDuration, formatTimestamp } from '../utils/format';
import AlertsManager from './alerts/AlertsManager';

type SetupConfig = {
  config: RootConfig;
};

// 'loxone' only exists when the server runs in Loxone mode — see loxoneMode below.
type SetupTabKey = 'config' | 'loxone' | 'system' | 'devices' | 'updates';

type TtsProviderKind = 'internal' | 'loxberry-tts' | 'openai-tts';

// Each provider keeps its own fields, so switching cards to compare them does
// not throw away what was already typed into the other one.
type LoxBerryTtsDraft = {
  host: string;
  mqttPort: string;
  protocol: 'mqtt' | 'mqtts';
  username: string;
  password: string;
};

type OpenAiTtsDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  format: OpenAiTtsFormat;
};

type TtsDraft = {
  type: TtsProviderKind;
  loxberry: LoxBerryTtsDraft;
  openai: OpenAiTtsDraft;
  fallbackToInternal: boolean;
};

const OPENAI_TTS_FORMATS: OpenAiTtsFormat[] = ['mp3', 'opus', 'aac', 'flac', 'wav'];

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Small "i" used by the inline explainer notes.
function InfoGlyph(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.5" x2="12" y2="7.6" />
    </svg>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function buildTtsDraft(config: RootConfig | undefined): TtsDraft {
  const tts = config?.content?.tts;
  const provider = tts?.provider;
  const draft: TtsDraft = {
    type: provider?.type === 'loxberry-tts' || provider?.type === 'openai-tts' ? provider.type : 'internal',
    loxberry: { host: '', mqttPort: '1883', protocol: 'mqtt', username: '', password: '' },
    openai: { baseUrl: '', apiKey: '', model: '', voice: '', format: 'mp3' },
    fallbackToInternal: tts?.fallbackToInternal !== false,
  };
  if (provider?.type === 'loxberry-tts') {
    draft.loxberry = {
      host: provider.host ?? '',
      mqttPort: provider.mqttPort ? String(provider.mqttPort) : '1883',
      protocol: provider.protocol === 'mqtts' ? 'mqtts' : 'mqtt',
      username: provider.username ?? '',
      password: provider.password ?? '',
    };
  }
  if (provider?.type === 'openai-tts') {
    draft.openai = {
      baseUrl: provider.baseUrl ?? '',
      apiKey: provider.apiKey ?? '',
      model: provider.model ?? '',
      voice: provider.voice ?? '',
      format: provider.format ?? 'mp3',
    };
  }
  return draft;
}

export default function SetupView(): JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = React.useState<SetupConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [restarting, setRestarting] = React.useState(false);
  const [mixedGroupEnabled, setMixedGroupEnabled] = React.useState(true);
  const [groupsSaving, setGroupsSaving] = React.useState(false);
  const [playerUpdating, setPlayerUpdating] = React.useState(false);
  const [playerUpdatedAt, setPlayerUpdatedAt] = React.useState<string | null>(null);
  const [playerUpdateRelease, setPlayerUpdateRelease] = React.useState<string | null>(null);
  // Update-check state lives in UpdateCheckContext so the shell chip and the
  // startup auto-check share one source of truth; this view reads the latest
  // versions and triggers a forced re-check from the manual button.
  const {
    latest,
    checking: updatesChecking,
    checkedAt: updatesCheckedAt,
    recheck,
    patchComponentLatest,
    pendingUpdatesFocus,
    clearUpdatesFocus,
  } = useUpdateCheck();
  const latestCoreRelease = latest.core;
  const latestCorePrerelease = latest.corePrerelease;
  const latestUiRelease = latest.ui;
  const latestPlayerRelease = latest.player;
  const componentLatest = latest.components;
  const componentDescriptions = latest.componentDescriptions;
  const [adminUiUpdating, setAdminUiUpdating] = React.useState(false);
  const [crossfadeDraft, setCrossfadeDraft] = React.useState('');
  const [crossfadeSaving, setCrossfadeSaving] = React.useState(false);
  const [adminUiUpdatedAt, setAdminUiUpdatedAt] = React.useState<string | null>(null);
  const [adminUiUpdateRelease, setAdminUiUpdateRelease] = React.useState<string | null>(null);
  const [serverUpdating, setServerUpdating] = React.useState(false);
  const [serverUpdatedAt, setServerUpdatedAt] = React.useState<string | null>(null);
  const [componentUpdatingByName, setComponentUpdatingByName] = React.useState<Record<string, boolean>>({});
  const [setupTab, setSetupTab] = React.useState<SetupTabKey>('config');
  const { displayed: displayedSetupTab, isLeaving: setupPanelLeaving } = useSubPanelTransition(setupTab, 200);
  const [diagnosticsCopied, setDiagnosticsCopied] = React.useState(false);
  const [eventSoundUploading, setEventSoundUploading] = React.useState(false);
  const [eventSoundFilename, setEventSoundFilename] = React.useState('');
  const [ttsDraft, setTtsDraft] = React.useState<TtsDraft>(() => buildTtsDraft(undefined));
  const [ttsDirty, setTtsDirty] = React.useState(false);
  const [ttsSaving, setTtsSaving] = React.useState(false);
  const eventSoundInputRef = React.useRef<HTMLInputElement | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const { push: pushAlert } = useGlobalAlert();
  const { confirm } = useConfirm();
  const { resetServer } = useServerControl();

  const refreshConfig = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const cfg = (await getConfig()) as SetupConfig;
      setData(cfg);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // Manual "check for updates" — forces a fresh fetch (bypassing the cache) and
  // surfaces a toast when the sources are unreachable. The startup auto-check
  // and the shell "updates available" chip run off the same UpdateCheckContext.
  const handleManualCheck = React.useCallback(async (): Promise<void> => {
    const ok = await recheck({ force: true });
    if (!ok) {
      pushAlert({
        tone: 'warn',
        title: t('setup.updates.checkSkippedTitle'),
        message: t('setup.updates.checkSkippedMessage'),
      });
    }
  }, [recheck, pushAlert, t]);

  // Open the Updates sub-tab when the user clicks the shell's "updates available"
  // chip (works even when this view is mounting fresh from another top-level tab).
  React.useEffect(() => {
    if (!pendingUpdatesFocus) return;
    setSetupTab('updates');
    clearUpdatesFocus();
  }, [pendingUpdatesFocus, clearUpdatesFocus]);

  const pollStatus = React.useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const info = await fetchStatus(signal);
      if (signal?.aborted) return;
      setStatus(info);
    } catch {
      // ignore; setup tab can still show config data
    } finally {
      if (!signal?.aborted) {
        setStatusLoading(false);
      }
    }
  }, []);

  usePolling(pollStatus, { delay: 5000 });

  // Keep polling pairing state until paired (mirrors legacy behaviour).
  const pairingEnabled = Boolean(data) && !data?.config?.system?.audioserver?.paired;
  const pollPairing = React.useCallback(async (signal?: AbortSignal): Promise<number | void> => {
    try {
      const cfg = (await getConfig()) as SetupConfig;
      if (signal?.aborted) return undefined;
      setData(cfg);
      const nowPaired = Boolean(cfg.config?.system?.audioserver?.paired);
      if (!nowPaired) return 5000;
      return undefined;
    } catch {
      return 10000;
    }
  }, []);

  usePolling(pollPairing, { delay: 5000, enabled: pairingEnabled, immediate: false });

  // Sync config when pairing state changes (from status endpoint)
  React.useEffect(() => {
    if (!status) return;
    const statusPaired = Boolean(status.paired);
    const configPaired = Boolean(data?.config?.system?.audioserver?.paired);
    if (statusPaired === configPaired) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const fresh = (await getConfig()) as SetupConfig;
        if (!cancelled) setData(fresh);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [status, data]);

  const configuredMacId = data?.config?.system?.audioserver?.macId ?? '';
  const mixedGroupConfigured = data?.config?.groups?.mixedGroupEnabled;

  React.useEffect(() => {
    if (typeof mixedGroupConfigured === 'boolean') {
      setMixedGroupEnabled(mixedGroupConfigured);
    }
  }, [mixedGroupConfigured]);

  React.useEffect(() => {
    if (!ttsDirty) {
      setTtsDraft(buildTtsDraft(data?.config));
    }
  }, [data?.config, ttsDirty]);

  const isPaired = Boolean(status?.paired);
  // No deployment mode anymore: "standalone" here just means Loxone is not connected.
  const standalone = data?.config?.system?.audioserver?.loxoneEnabled !== true;
  // Everything that only exists because a Miniserver is in the picture (pairing,
  // config push/CRC, Miniserver-backed auth) lives on its own Loxone tab. A
  // standalone install never sees that tab; a legacy config without an explicit
  // mode is treated as Loxone, matching the rest of the UI.
  const loxoneMode = !standalone;

  const globalCrossfadeSec = data?.config?.system?.audioserver?.crossfadeSec;

  React.useEffect(() => {
    setCrossfadeDraft(
      globalCrossfadeSec != null && globalCrossfadeSec > 0 ? String(globalCrossfadeSec) : '',
    );
  }, [globalCrossfadeSec]);

  // Switching a paired server to standalone (or loading a standalone config while
  // the Loxone tab was the last-used one) must not leave the user on a tab that
  // no longer exists.
  React.useEffect(() => {
    if (!loxoneMode && setupTab === 'loxone') {
      setSetupTab('config');
    }
  }, [loxoneMode, setupTab]);

  if (loading) {
    return (
      <div className="setup-layout">
        <div className="setup-shell panel setup-shell--placeholder">
          <InlineState kind="loading" title={t('setup.loading.title')} message={t('setup.loading.message')} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="setup-layout">
        <div className="setup-shell panel setup-shell--placeholder">
          <InlineState
            kind="error"
            title={t('setup.errorState.title')}
            message={error}
            action={{ label: t('setup.errorState.retry'), onClick: () => void refreshConfig() }}
          />
        </div>
      </div>
    );
  }

  const cfg: RootConfig = data?.config ?? {};
  const system = cfg.system ?? {};
  const miniserver = system.miniserver ?? {};
  const audioserver = system.audioserver ?? {};
  const miniserverIp = miniserver.ip ?? '—';
  const miniserverSerial = miniserver.serial ?? '—';
  const audioServerIp = audioserver.ip ?? '—';
  const lastUpdatedRaw =
    typeof cfg.updatedAt === 'string'
      ? cfg.updatedAt
      : typeof status?.timestamp === 'string'
        ? status.timestamp
        : null;
  const lastUpdated = formatTimestamp(lastUpdatedRaw);
  const configCrc =
    cfg.crc32 ??
    cfg.rawAudioConfig?.crc32 ??
    null;

  const contentConfig = cfg.content ?? {};
  const versionLabel = status?.version ?? status?.apiVersion ?? '—';
  const uptimeLabel = formatDuration(status?.uptime);
  const serverName = audioserver.name || status?.name || t('setup.server.title');
  const crossfadeActive = Number(crossfadeDraft) > 0;
  // Zone/extension counts are what the Miniserver pushed down, so they belong
  // to the sync picture on the Loxone tab.
  const zonesCount =
    typeof status?.zones === 'number'
      ? status.zones
      : Array.isArray(cfg.zones)
        ? cfg.zones.length
        : 0;
  const extensionCount = Array.isArray(audioserver.extensions) ? audioserver.extensions.length : 0;
  const isContainerized = status?.containerized !== false;
  // What this build is, next to how it runs. Running from a working copy the
  // channel is derived from the branch, so naming both would say it twice —
  // the channel is appended only when it adds something the branch does not.
  const buildChannel = status?.buildChannel;
  const gitBranch = status?.gitBranch;
  const runtimeBase = isContainerized
    ? t('setup.diagnostics.runtimeDocker')
    : gitBranch
      ? t('setup.diagnostics.runtimeGitBranch', { branch: gitBranch })
      : t('setup.diagnostics.runtimeStandalone');
  const runtimeLabel =
    buildChannel && buildChannel !== gitBranch ? `${runtimeBase} · ${buildChannel}` : runtimeBase;
  // The server-core update always swaps dist/ in place; the only difference is
  // whether the deployment restarts itself (containerized / supervised) or the
  // user has to restart the service to load the new code.
  const restartSupervised = status?.restartSupervised === true;
  const coreUpdateHint = restartSupervised
    ? t('setup.updates.coreUpdateAuto')
    : t('setup.updates.coreUpdateManual');
  const componentUpdateHint = isContainerized
    ? t('setup.updates.componentDocker')
    : t('setup.updates.componentStandalone');
  const coreComparison =
    latestCoreRelease && versionLabel !== '—' ? compareSemver(versionLabel, latestCoreRelease) : null;
  const coreIsPrerelease = typeof versionLabel === 'string' && versionLabel.includes('-');
  const corePrereleaseComparison =
    coreIsPrerelease && latestCorePrerelease && versionLabel !== '—'
      ? compareSemver(versionLabel, latestCorePrerelease)
      : null;
  const coreOutdated = coreComparison === -1 || corePrereleaseComparison === -1;
  const uiOutdated =
    latestUiRelease && compareSemver(__APP_VERSION__, latestUiRelease) === -1;
  const playerInstalled = status?.player?.installed ?? null;
  const playerOutdated = Boolean(
    playerInstalled && latestPlayerRelease && compareSemver(playerInstalled, latestPlayerRelease) === -1,
  );
  const componentOutdated = componentPackageNames(status, latest).some((name) => {
    const current = status?.packages?.[name]?.installed;
    const latestVer = componentLatest[name];
    return current && latestVer ? compareSemver(current, latestVer) === -1 : false;
  });
  const hasUpdates = Boolean(coreOutdated || uiOutdated || playerOutdated || componentOutdated);
  const updatesCheckedLabel = updatesCheckedAt ? formatTimestamp(updatesCheckedAt) ?? updatesCheckedAt : t('setup.updates.notCheckedYet');
  const updatesSummaryTone = !updatesCheckedAt ? 'neutral' : hasUpdates ? 'warn' : 'ok';
  const updatesSummaryLabel = !updatesCheckedAt ? t('setup.updates.notChecked') : hasUpdates ? t('setup.updates.available') : t('setup.updates.upToDate');
  const ttsMqttPort = Number(ttsDraft.loxberry.mqttPort);
  const ttsProviderValid =
    ttsDraft.type === 'internal'
      ? true
      : ttsDraft.type === 'loxberry-tts'
        ? ttsDraft.loxberry.host.trim().length > 0 &&
          Number.isInteger(ttsMqttPort) &&
          ttsMqttPort > 0 &&
          ttsMqttPort <= 65535
        : isHttpUrl(ttsDraft.openai.baseUrl);
  const ttsCurrentProvider =
    contentConfig.tts?.provider?.type === 'loxberry-tts'
      ? t('setup.tts.currentLoxBerry')
      : contentConfig.tts?.provider?.type === 'openai-tts'
        ? t('setup.tts.currentOpenAi')
        : t('setup.tts.currentInternal');
  const showTtsValidation = ttsDirty && !ttsProviderValid;
  const ttsValidationMessage =
    ttsDraft.type === 'openai-tts' ? t('setup.tts.validationOpenAi') : t('setup.tts.validation');

  const componentRows = componentPackageNames(status, latest).map((name) => {
    const latestVer = componentLatest[name] ?? null;
    const pkgInfo = status?.packages?.[name];
    const installed = pkgInfo?.installed ?? null;
    const declared = pkgInfo?.declared ?? null;
    const isOutdated = installed && latestVer ? compareSemver(installed, latestVer) === -1 : false;
    return { name, latest: latestVer, installed, declared, isOutdated };
  })
    .sort((a, b) => {
      if (a.isOutdated === b.isOutdated) return a.name.localeCompare(b.name);
      return a.isOutdated ? -1 : 1;
    });
  const componentsOutdatedCount = componentRows.filter((row) => row.isOutdated).length;
  const componentsInstalledCount = componentRows.filter((row) => row.installed).length;

  const coreCurrentTag = versionLabel !== '—' ? normalizeTag(versionLabel) : '';
  const coreLatestPrereleaseTag = latestCorePrerelease ? normalizeTag(latestCorePrerelease) : '';
  const coreMatchesLatestPrerelease = Boolean(
    coreIsPrerelease &&
    coreCurrentTag &&
    coreLatestPrereleaseTag &&
    coreCurrentTag === coreLatestPrereleaseTag,
  );
  const coreTone =
    !latestCoreRelease
      ? 'neutral'
      : coreOutdated
        ? 'warn'
        : coreMatchesLatestPrerelease
        ? 'ok'
        : coreComparison === 1
          ? 'neutral'
          : 'ok';
  const coreLabel =
    !latestCoreRelease
      ? t('setup.updates.unknown')
      : coreOutdated
        ? t('setup.updates.outdated')
        : coreMatchesLatestPrerelease
        ? t('setup.updates.upToDate')
        : coreComparison === 1
          ? coreIsPrerelease
            ? t('setup.updates.preRelease')
            : t('setup.updates.ahead')
          : t('setup.updates.upToDate');
  // Combined badge for the Web tile (Admin UI + Player).
  const webOutdated = Boolean(uiOutdated || playerOutdated);
  const webTone = webOutdated ? 'warn' : latestUiRelease || latestPlayerRelease ? 'ok' : 'neutral';
  const webLabel = webOutdated
    ? t('setup.updates.outdated')
    : latestUiRelease || latestPlayerRelease
      ? t('setup.updates.upToDate')
      : t('setup.updates.unknown');
  const componentsTone =
    componentsInstalledCount === 0 ? 'neutral' : componentsOutdatedCount > 0 ? 'warn' : 'ok';
  const componentsLabel =
    componentsInstalledCount === 0 ? t('setup.updates.unknown') : componentsOutdatedCount > 0 ? t('setup.updates.outdated') : t('setup.updates.upToDate');

  const coreBadgeTitle =
    coreComparison === 1 && coreIsPrerelease
      ? t('setup.updates.preBadgeTitle')
      : undefined;

  async function handleAdminUiUpdate(): Promise<void> {
    if (adminUiUpdating) return;

    const releaseTag = latestUiRelease ? `v${latestUiRelease}` : undefined;
    const ok = await confirm({
      title: t('setup.updates.uiUpdateConfirm'),
      message: t('setup.updates.uiUpdateMessage', { release: releaseTag ? ` (${releaseTag})` : '' }),
      confirmLabel: adminUiUpdatedAt ? t('setup.updates.uiUpdateAgain') : t('setup.updates.uiUpdateOk'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
    });
    if (!ok) return;

    setAdminUiUpdating(true);
    setAdminUiUpdatedAt(null);
    setAdminUiUpdateRelease(null);
    try {
      const result = await updateAdminUi(releaseTag);
      setAdminUiUpdatedAt(result.updatedAt ?? new Date().toISOString());
      setAdminUiUpdateRelease(result.release ?? releaseTag ?? 'latest');
      pushAlert({
        tone: 'success',
        title: t('setup.updates.uiUpdatedTitle'),
        message: t('setup.updates.uiUpdatedMessage'),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.updates.uiUpdateFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.updates.uiUpdateFailedMessage'),
      });
    } finally {
      setAdminUiUpdating(false);
    }
  }

  function handleAdminUiReload(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('r', String(Date.now()));
    window.location.href = url.toString();
  }

  async function handlePlayerUpdate(): Promise<void> {
    if (playerUpdating) return;

    const releaseTag = latestPlayerRelease ? `v${latestPlayerRelease}` : undefined;
    const ok = await confirm({
      title: t('setup.updates.playerUpdateConfirm'),
      message: t('setup.updates.playerUpdateMessage', { release: releaseTag ? ` (${releaseTag})` : '' }),
      confirmLabel: playerUpdatedAt ? t('setup.updates.uiUpdateAgain') : t('setup.updates.uiUpdateOk'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
    });
    if (!ok) return;

    setPlayerUpdating(true);
    setPlayerUpdatedAt(null);
    setPlayerUpdateRelease(null);
    try {
      const result = await updatePlayer(releaseTag);
      setPlayerUpdatedAt(result.updatedAt ?? new Date().toISOString());
      setPlayerUpdateRelease(result.release ?? releaseTag ?? 'latest');
      pushAlert({
        tone: 'success',
        title: t('setup.updates.playerUpdatedTitle'),
        message: t('setup.updates.playerUpdatedMessage'),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.updates.playerUpdateFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.updates.playerUpdateFailedMessage'),
      });
    } finally {
      setPlayerUpdating(false);
    }
  }

  async function handleServerUpdate(): Promise<void> {
    if (serverUpdating) return;

    // Mirror the channel the UI already resolved: a prerelease install targets the
    // latest pre, otherwise the latest stable. The backend re-resolves when no tag
    // is given, so an unknown target simply falls through to channel detection.
    const target = coreIsPrerelease ? latestCorePrerelease : latestCoreRelease;
    const releaseTag = target ? `v${target}` : undefined;
    const ok = await confirm({
      title: t('setup.updates.serverUpdateConfirm'),
      message: restartSupervised
        ? t('setup.updates.serverUpdateMessageAuto', { release: releaseTag ? ` (${releaseTag})` : '' })
        : t('setup.updates.serverUpdateMessageManual', { release: releaseTag ? ` (${releaseTag})` : '' }),
      confirmLabel: t('setup.updates.uiUpdateOk'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
    });
    if (!ok) return;

    setServerUpdating(true);
    setServerUpdatedAt(null);
    try {
      const result = await updateServer(releaseTag);
      setServerUpdatedAt(result.updatedAt ?? new Date().toISOString());
      if (result.willRestart) {
        pushAlert({
          tone: 'success',
          title: t('setup.updates.serverUpdatedTitle'),
          message: t('setup.updates.serverRestartingMessage'),
        });
      } else {
        pushAlert({
          tone: 'warn',
          title: t('setup.updates.serverUpdatedTitle'),
          message: t('setup.updates.serverRestartManualMessage'),
        });
      }
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.updates.serverUpdateFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.updates.serverUpdateFailedMessage'),
      });
    } finally {
      setServerUpdating(false);
    }
  }

  // Renders one web-app row (Admin UI / Player) for the Web apps tile: icon, name + version, and a
  // status chip — an Update button when outdated, a Reload/Updated chip just after updating, a green
  // "up to date" chip when the latest is known and matches, or a muted "unknown" before a check.
  function renderWebApp(cfg: {
    name: string;
    icon: React.ReactNode;
    current: string;
    latest: string | null;
    releasesUrl: string;
    canUpdate: boolean;
    updating: boolean;
    updatedAt: string | null;
    onUpdate: () => void;
    onReload?: () => void;
  }): JSX.Element {
    return (
      <div className="setup-webapp">
        <span className="setup-webapp__icon" aria-hidden="true">{cfg.icon}</span>
        <div className="setup-webapp__meta">
          <span className="setup-webapp__name">{cfg.name}</span>
          <span className="setup-webapp__ver">
            {cfg.current}
            {cfg.latest ? (
              <>
                {' → '}
                <a href={cfg.releasesUrl} target="_blank" rel="noreferrer">
                  v{cfg.latest}
                </a>
              </>
            ) : null}
          </span>
        </div>
        <div className="setup-webapp__action">
          {cfg.canUpdate ? (
            <button
              type="button"
              className="setup-btn setup-btn--primary"
              disabled={cfg.updating}
              onClick={() => void cfg.onUpdate()}
            >
              {cfg.updating ? t('setup.updates.updating') : t('setup.updates.update')}
            </button>
          ) : cfg.updatedAt && cfg.onReload ? (
            <a
              href="#"
              className="setup-webapp__chip setup-webapp__chip--ok"
              onClick={(e) => {
                e.preventDefault();
                cfg.onReload?.();
              }}
            >
              {t('setup.updates.reload')}
            </a>
          ) : cfg.updatedAt ? (
            <span className="setup-webapp__chip setup-webapp__chip--ok">{t('setup.updates.updated')}</span>
          ) : cfg.latest ? (
            <span className="setup-webapp__chip setup-webapp__chip--ok">{t('setup.updates.upToDate')}</span>
          ) : (
            <span className="setup-webapp__chip setup-webapp__chip--muted">{t('setup.updates.unknown')}</span>
          )}
        </div>
      </div>
    );
  }

  async function handleComponentUpdate(name: string, latest: string | null): Promise<void> {
    if (!latest || componentUpdatingByName[name]) return;

    const ok = await confirm({
      title: t('setup.updates.componentUpdateConfirm'),
      message: t('setup.updates.componentUpdateMessage', { name, version: latest }),
      confirmLabel: t('setup.updates.update'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
    });
    if (!ok) return;

    setComponentUpdatingByName((prev) => ({ ...prev, [name]: true }));
    try {
      const result = await updateComponentPackage(name, latest);
      await pollStatus();
      const installedVersion = result.installed ?? latest;
      if (installedVersion) patchComponentLatest(name, installedVersion);
      pushAlert({
        tone: 'success',
        title: t('setup.updates.componentUpdatedTitle'),
        message: t('setup.updates.componentUpdatedMessage', { name, version: result.installed ? `v${result.installed}` : t('setup.updates.updated') }),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.updates.componentUpdateFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.updates.componentUpdateFailedDefault', { name }),
      });
    } finally {
      setComponentUpdatingByName((prev) => ({ ...prev, [name]: false }));
    }
  }

  async function handleEventSoundFileUpload(file: File | null): Promise<void> {
    if (!file || eventSoundUploading) {
      return;
    }
    setEventSoundFilename(file.name);
    setEventSoundUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await uploadEventSound(file.name, base64);
      setEventSoundFilename('');
      pushAlert({
        tone: 'success',
        title: t('setup.actions.uploadCompleteTitle'),
        message: t('setup.actions.uploadCompleteMessage', { name: file.name }),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.uploadFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.uploadFailedDefault'),
      });
    } finally {
      setEventSoundUploading(false);
    }
  }

  async function handleTtsSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (ttsSaving || !ttsProviderValid) {
      return;
    }
    setTtsSaving(true);
    try {
      await updateContentConfig({
        tts:
          ttsDraft.type === 'internal'
            ? {
                provider: { type: 'internal' },
                fallbackToInternal: true,
              }
            : {
                provider:
                  ttsDraft.type === 'loxberry-tts'
                    ? {
                        type: 'loxberry-tts',
                        enabled: true,
                        host: ttsDraft.loxberry.host.trim(),
                        mqttPort: ttsMqttPort,
                        protocol: ttsDraft.loxberry.protocol,
                        username: ttsDraft.loxberry.username.trim() || undefined,
                        password: ttsDraft.loxberry.password || undefined,
                      }
                    : {
                        type: 'openai-tts',
                        enabled: true,
                        baseUrl: ttsDraft.openai.baseUrl.trim(),
                        apiKey: ttsDraft.openai.apiKey.trim() || undefined,
                        model: ttsDraft.openai.model.trim() || undefined,
                        voice: ttsDraft.openai.voice.trim() || undefined,
                        format: ttsDraft.openai.format,
                      },
                fallbackToInternal: ttsDraft.fallbackToInternal,
              },
      });
      const fresh = (await getConfig()) as SetupConfig;
      setData(fresh);
      setTtsDirty(false);
      pushAlert({
        tone: 'success',
        title: t('setup.actions.ttsSavedTitle'),
        message: t('setup.actions.ttsSavedMessage'),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.ttsFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.ttsFailedDefault'),
      });
    } finally {
      setTtsSaving(false);
    }
  }

  async function persistCrossfade(): Promise<void> {
    if (crossfadeSaving) return;
    const next = Number(crossfadeDraft);
    if (Number.isNaN(next) || next < 0) return;
    if (next === (globalCrossfadeSec ?? 0)) return;
    setCrossfadeSaving(true);
    try {
      await updateCrossfadeSec(next);
      const fresh = (await getConfig()) as SetupConfig;
      setData(fresh);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.crossfadeFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.crossfadeFailedDefault'),
      });
    } finally {
      setCrossfadeSaving(false);
    }
  }

  async function toggleMixedGroups(next: boolean): Promise<void> {
    if (groupsSaving) return;
    setGroupsSaving(true);
    setMixedGroupEnabled(next);
    try {
      await updateGroupsConfig({ mixedGroupEnabled: next });
      const fresh = (await getConfig()) as SetupConfig;
      setData(fresh);
    } catch (err) {
      setMixedGroupEnabled(!next);
      pushAlert({
        tone: 'error',
        title: t('setup.actions.groupsFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.groupsFailedDefault'),
      });
    } finally {
      setGroupsSaving(false);
    }
  }

  // One-click snapshot for bug reports: everything support usually has to ask for.
  async function handleCopyDiagnostics(): Promise<void> {
    const lines = [
      `mode:      ${standalone ? 'standalone' : 'loxone'}`,
      `server:    ${serverName}`,
      `core:      ${versionLabel}`,
      `admin ui:  ${__APP_VERSION__}`,
      `player:    ${status?.player?.installed ?? '—'}`,
      `runtime:   ${runtimeLabel}`,
      `uptime:    ${uptimeLabel || '—'}`,
      `host:      ${audioServerIp}`,
      `serial:    ${configuredMacId || '—'}`,
      `zones:     ${zonesCount}`,
    ];
    if (!standalone) {
      lines.push(
        `paired:    ${isPaired ? 'yes' : 'no'}`,
        `miniserver:${miniserverIp} · ${miniserverSerial}`,
        `config crc:${configCrc ?? '—'}`,
      );
    }
    const ok = await copyText(lines.join('\n'));
    if (!ok) {
      pushAlert({
        tone: 'warn',
        title: t('setup.server.copyFailedTitle'),
        message: t('setup.server.copyFailedMessage'),
      });
      return;
    }
    setDiagnosticsCopied(true);
    window.setTimeout(() => setDiagnosticsCopied(false), 2000);
  }

  async function handleClearConfig(): Promise<void> {
    const ok = await confirm({
      title: t('setup.actions.clearConfirmTitle'),
      message: standalone
        ? t('setup.actions.clearConfirmMessage')
        : t('setup.actions.clearConfirmMessageLoxone'),
      confirmLabel: t('setup.actions.clearConfirmOk'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await clearServerConfig();
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.clearFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.clearFailedDefault'),
      });
      return;
    }
    // Hand off to App: it bounces the server (so the gate re-evaluates against the
    // now-empty config and Loxone stays down) and shows the "resetting" screen,
    // then lands on the welcome screen automatically — no manual refresh.
    await resetServer();
  }

  async function handleImportConfig(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await importServerConfig(payload);
      pushAlert({
        tone: 'success',
        title: t('setup.actions.importedTitle'),
        message: t('setup.actions.importedMessage', { name: file.name }),
      });
      await refreshConfig();
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.importFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.importFailedDefault'),
      });
    }
  }

  function handleExportConfig(): void {
    try {
      const blob = new Blob([JSON.stringify(data?.config ?? {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audioserver-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.exportFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.exportFailedDefault'),
      });
    }
  }

  async function handleRestart(): Promise<void> {
    if (restarting) return;
    const ok = await confirm({
      title: t('setup.actions.restartConfirmTitle'),
      message: t('setup.actions.restartConfirmMessage'),
      confirmLabel: t('setup.actions.restartConfirmOk'),
      cancelLabel: t('setup.updates.uiUpdateCancel'),
    });
    if (!ok) return;
    setRestarting(true);
    try {
      await reinitializeServer();
      pushAlert({
        tone: 'success',
        title: t('setup.actions.restartTriggeredTitle'),
        message: t('setup.actions.restartTriggeredMessage'),
      });
    } catch (err) {
      pushAlert({
        tone: 'error',
        title: t('setup.actions.restartFailedTitle'),
        message: err instanceof Error ? err.message : t('setup.actions.restartFailedDefault'),
      });
    } finally {
      setRestarting(false);
    }
  }

  // The Loxone tab sits right next to Config, but only when this server actually
  // talks to a Miniserver.
  const SETUP_TABS: Array<{ key: SetupTabKey; label: string }> = [
    { key: 'config', label: t('setup.tabs.config') },
    ...(loxoneMode ? ([{ key: 'loxone', label: t('setup.tabs.loxone') }] as const) : []),
    { key: 'system', label: t('setup.tabs.system') },
    // Before Updates because it is a thing to set up, not a thing to check.
    { key: 'devices', label: t('setup.tabs.devices') },
    { key: 'updates', label: t('setup.tabs.updates') },
  ];

  const subTabKey = setupTab;
  const subTabLabel = t(`setup.tabs.${subTabKey}`);
  const subTabTitle = t(`setup.titles.${subTabKey}`);
  const subTabSubtitle = t(`setup.subtitles.${subTabKey}`);

  return (
    <div className="setup-layout">
      <header className="setup-head">
        <div className="setup-head__main">
          <p className="setup-eyebrow">{t('setup.eyebrowPrefix', { label: subTabLabel })}</p>
          <h1 className="setup-title">{subTabTitle}</h1>
          <p className="setup-subtitle">{subTabSubtitle}</p>
        </div>
        {subTabKey === 'updates' ? (
          <button
            type="button"
            className="setup-btn setup-btn--primary"
            disabled={updatesChecking}
            onClick={() => void handleManualCheck()}
          >
            {updatesChecking ? t('setup.checking') : t('setup.checkForUpdates')}
          </button>
        ) : null}
      </header>

      <SubTabs
        ariaLabel={t('setup.tabs.ariaLabel')}
        active={setupTab}
        onChange={setSetupTab}
        tabs={SETUP_TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          badge: tab.key === 'updates' && hasUpdates ? '·' : undefined,
        }))}
      />

      <SubPanel key={displayedSetupTab} isLeaving={setupPanelLeaving}>

      {displayedSetupTab === 'config' ? (
        <>
          <div className="setup-grid">
          {/* ===== Identity strip (what this server is, at a glance) ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.server.eyebrow')}</span>
                <h2 className="setup-section__title">{serverName}</h2>
                <p className="setup-section__desc">
                  {standalone ? t('setup.server.desc') : t('setup.server.descLoxone')}
                </p>
              </div>
              <button
                type="button"
                className="setup-btn"
                onClick={() => void handleCopyDiagnostics()}
                title={t('setup.server.copyHint')}
              >
                {diagnosticsCopied ? t('setup.server.copied') : t('setup.server.copy')}
              </button>
            </header>

            <div className="setup-facts">
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.server.rowMode')}</span>
                <span className="setup-facts__value setup-status">
                  {standalone ? t('setup.server.statusStandalone') : t('setup.server.statusLoxone')}
                </span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.server.rowHost')}</span>
                <span className="setup-facts__value">{audioServerIp}</span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.server.rowSerial')}</span>
                <span className="setup-facts__value">{configuredMacId || '—'}</span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.diagnostics.runtime')}</span>
                <span className="setup-facts__value setup-facts__value--muted">{runtimeLabel}</span>
              </div>
            </div>
          </section>

          {/* ===== Playback behaviour (crossfade + grouping) ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.playback.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.playback.title')}</h2>
                <p className="setup-section__desc">
                  {t('setup.playback.desc')}
                </p>
              </div>
            </header>

            <div className="setup-rows">
              <div className="setup-row">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.crossfade.rowLabel')}</div>
                  <div className="setup-row__desc">
                    {t('setup.crossfade.rowDesc')}
                  </div>
                </div>
                <div className="setup-row__control">
                  <div className="setup-input" style={{ width: 150 }}>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={crossfadeDraft}
                      placeholder="0"
                      aria-label={t('setup.crossfade.rowLabel')}
                      onChange={(event) => setCrossfadeDraft(event.target.value)}
                      onBlur={() => void persistCrossfade()}
                      disabled={crossfadeSaving}
                    />
                    <span className="setup-input__suffix">
                      {crossfadeActive ? t('setup.crossfade.seconds') : t('setup.crossfade.off')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="setup-row">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.groups.rowLabel')}</div>
                  <div className="setup-row__desc">
                    {t('setup.groups.rowDesc')}
                  </div>
                </div>
                <div className="setup-row__control">
                  <button
                    type="button"
                    className={`setup-toggle${mixedGroupEnabled ? ' is-on' : ''}`}
                    aria-label={t('setup.groups.rowLabel')}
                    aria-pressed={mixedGroupEnabled}
                    disabled={groupsSaving}
                    onClick={() => void toggleMixedGroups(!mixedGroupEnabled)}
                  />
                </div>
              </div>
            </div>

            <div className="setup-note">
              <InfoGlyph />
              <span>{t('setup.groups.note')}</span>
            </div>
          </section>

          {/* ===== Maintenance (restart, backup, wipe) ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.maintenance.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.maintenance.title')}</h2>
                <p className="setup-section__desc">
                  {t('setup.maintenance.desc')}
                </p>
              </div>
            </header>

            <div className="setup-rows">
              <div className="setup-row">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.maintenance.restartLabel')}</div>
                  <div className="setup-row__desc">{t('setup.maintenance.restartDesc')}</div>
                </div>
                <div className="setup-row__control">
                  <button
                    type="button"
                    className="setup-btn setup-btn--warn"
                    onClick={() => void handleRestart()}
                    disabled={restarting}
                  >
                    {restarting ? t('setup.server.restarting') : t('setup.server.restart')}
                  </button>
                </div>
              </div>

              <div className="setup-row">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.maintenance.backupLabel')}</div>
                  <div className="setup-row__desc">{t('setup.maintenance.backupDesc')}</div>
                </div>
                <div className="setup-row__control">
                  <button type="button" className="setup-btn" onClick={handleExportConfig}>
                    {t('setup.maintenance.exportAction')}
                  </button>
                  <button
                    type="button"
                    className="setup-btn"
                    onClick={() => importInputRef.current?.click()}
                  >
                    {t('setup.maintenance.importAction')}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = '';
                      void handleImportConfig(file);
                    }}
                  />
                </div>
              </div>

              <div className="setup-row setup-row--danger">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.maintenance.clearLabel')}</div>
                  <div className="setup-row__desc">
                    {standalone ? t('setup.maintenance.clearDesc') : t('setup.maintenance.clearDescLoxone')}
                  </div>
                </div>
                <div className="setup-row__control">
                  <button
                    type="button"
                    className="setup-btn setup-btn--danger"
                    onClick={() => void handleClearConfig()}
                  >
                    {t('setup.maintenance.clearAction')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          </div>
        </>
      ) : null}

      {displayedSetupTab === 'loxone' && loxoneMode ? (
        <>
          <div className="setup-grid">
          {/* ===== Connection: Miniserver ⇄ this server ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span
                  className={`setup-section__eyebrow${isPaired ? ' setup-section__eyebrow--info' : ' setup-section__eyebrow--warn'}`}
                >
                  {t('setup.pairing.eyebrow')}
                </span>
                <h2 className="setup-section__title">{t('setup.pairing.title')}</h2>
                <p className="setup-section__desc">
                  {isPaired ? t('setup.pairing.descPaired') : t('setup.pairing.descUnpaired')}
                </p>
              </div>
            </header>

            <div className={`setup-link${isPaired ? '' : ' setup-link--warn'}`}>
              <div className="setup-link__inner">
              <div className="setup-link__node">
                <span className="setup-link__icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="7" rx="1.5" />
                    <rect x="3" y="13" width="18" height="7" rx="1.5" />
                    <line x1="7" y1="7.5" x2="7" y2="7.5" />
                    <line x1="7" y1="16.5" x2="7" y2="16.5" />
                  </svg>
                </span>
                <span className="setup-link__name">{t('setup.pairing.rowMiniserver')}</span>
                <span className="setup-link__meta">{miniserverIp}</span>
                <span className="setup-link__meta">{miniserverSerial}</span>
              </div>

              <div className="setup-link__wire">
                <span className="setup-link__line setup-link__line--in" aria-hidden="true" />
                <span className={`setup-badge${isPaired ? ' setup-badge--ok' : ' setup-badge--warn'}`}>
                  {isPaired ? t('setup.pairing.statusPaired') : t('setup.pairing.statusAwaiting')}
                </span>
                <span className="setup-link__line setup-link__line--out" aria-hidden="true" />
              </div>

              <div className="setup-link__node setup-link__node--self">
                <span className="setup-link__icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <line x1="4" y1="10" x2="4" y2="14" />
                    <line x1="8.5" y1="7" x2="8.5" y2="17" />
                    <line x1="13" y1="4" x2="13" y2="20" />
                    <line x1="17.5" y1="8" x2="17.5" y2="16" />
                    <line x1="21" y1="11" x2="21" y2="13" />
                  </svg>
                </span>
                <span className="setup-link__name">{serverName}</span>
                <span className="setup-link__meta">{audioServerIp}</span>
                <span className="setup-link__meta">{configuredMacId || '—'}</span>
              </div>
              </div>
            </div>

            {!isPaired ? (
              <div className="setup-note">
                <InfoGlyph />
                <span>{t('setup.pairing.pairHint')}</span>
              </div>
            ) : null}
          </section>

          {/* ===== Configuration sync (the Miniserver owns this data) ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.sync.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.sync.title')}</h2>
                <p className="setup-section__desc">{t('setup.sync.desc')}</p>
              </div>
              <button
                type="button"
                className="setup-btn"
                onClick={() => void refreshConfig()}
                disabled={loading}
              >
                {t('setup.pairing.forceResync')}
              </button>
            </header>

            <div className="setup-facts">
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.pairing.rowLastSync')}</span>
                <span className="setup-facts__value setup-facts__value--muted">
                  {lastUpdated ?? t('setup.pairing.notAvailable')}
                </span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.diagnostics.configCrc')}</span>
                <span className="setup-facts__value">{configCrc ?? '—'}</span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.sync.zones')}</span>
                <span className="setup-facts__value">{zonesCount}</span>
              </div>
              <div className="setup-facts__item">
                <span className="setup-facts__label">{t('setup.sync.extensions')}</span>
                <span className="setup-facts__value">{extensionCount}</span>
              </div>
            </div>

            <div className="setup-note">
              <InfoGlyph />
              <span>{t('setup.sync.note')}</span>
            </div>
          </section>

          {/* ===== Unpair ===== */}
          <section className="setup-section setup-section--full">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.unpair.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.unpair.title')}</h2>
                <p className="setup-section__desc">{t('setup.unpair.desc')}</p>
              </div>
            </header>

            <div className="setup-rows">
              <div className="setup-row setup-row--danger">
                <div className="setup-row__info">
                  <div className="setup-row__label">{t('setup.unpair.rowLabel')}</div>
                  <div className="setup-row__desc">{t('setup.unpair.rowDesc')}</div>
                </div>
                <div className="setup-row__control">
                  <button
                    type="button"
                    className="setup-btn setup-btn--danger"
                    onClick={() => void handleClearConfig()}
                  >
                    {t('setup.pairing.unpair')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          </div>
        </>
      ) : null}

      {displayedSetupTab === 'devices' ? <SonnClientsSection /> : null}

      {displayedSetupTab === 'system' ? (
        <>
          {/* ===== TTS provider ===== */}
          <section className="setup-section">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.tts.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.tts.title')}</h2>
                <p className="setup-section__desc">
                  <Trans i18nKey="setup.tts.desc" values={{ provider: ttsCurrentProvider }} components={[<strong key="0" />]} />
                </p>
              </div>
            </header>

            <form onSubmit={(event) => void handleTtsSave(event)}>
              <div className="setup-tts-providers">
                <button
                  type="button"
                  className={`setup-tts-provider${ttsDraft.type === 'internal' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setTtsDraft((prev) => ({ ...prev, type: 'internal' }));
                    setTtsDirty(true);
                  }}
                >
                  <span className="setup-tts-provider__name">{t('setup.tts.providerInternal')}</span>
                  <span className="setup-tts-provider__desc">{t('setup.tts.providerInternalDesc')}</span>
                </button>
                <button
                  type="button"
                  className={`setup-tts-provider${ttsDraft.type === 'loxberry-tts' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setTtsDraft((prev) => ({ ...prev, type: 'loxberry-tts' }));
                    setTtsDirty(true);
                  }}
                >
                  <span className="setup-tts-provider__name">{t('setup.tts.providerLoxBerry')}</span>
                  <span className="setup-tts-provider__desc">{t('setup.tts.providerLoxBerryDesc')}</span>
                </button>
                <button
                  type="button"
                  className={`setup-tts-provider${ttsDraft.type === 'openai-tts' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setTtsDraft((prev) => ({ ...prev, type: 'openai-tts' }));
                    setTtsDirty(true);
                  }}
                >
                  <span className="setup-tts-provider__name">{t('setup.tts.providerOpenAi')}</span>
                  <span className="setup-tts-provider__desc">{t('setup.tts.providerOpenAiDesc')}</span>
                </button>
              </div>

              {ttsDraft.type === 'openai-tts' ? (
                <div className="setup-rows">
                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.openaiBaseUrl')}</div>
                      <div className="setup-row__desc">{t('setup.tts.openaiBaseUrlDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 280 }}>
                        <input
                          type="text"
                          value={ttsDraft.openai.baseUrl}
                          placeholder="http://localhost:8880/v1"
                          onChange={(event) => {
                            const baseUrl = event.target.value;
                            setTtsDraft((prev) => ({ ...prev, openai: { ...prev.openai, baseUrl } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.openaiApiKey')}</div>
                      <div className="setup-row__desc">{t('setup.tts.openaiApiKeyDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 220 }}>
                        <input
                          type="password"
                          value={ttsDraft.openai.apiKey}
                          onChange={(event) => {
                            const apiKey = event.target.value;
                            setTtsDraft((prev) => ({ ...prev, openai: { ...prev.openai, apiKey } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.openaiModel')}</div>
                      <div className="setup-row__desc">{t('setup.tts.openaiModelDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 200 }}>
                        <input
                          type="text"
                          value={ttsDraft.openai.model}
                          placeholder="tts-1"
                          onChange={(event) => {
                            const model = event.target.value;
                            setTtsDraft((prev) => ({ ...prev, openai: { ...prev.openai, model } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.openaiVoice')}</div>
                      <div className="setup-row__desc">{t('setup.tts.openaiVoiceDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 200 }}>
                        <input
                          type="text"
                          value={ttsDraft.openai.voice}
                          placeholder="alloy"
                          onChange={(event) => {
                            const voice = event.target.value;
                            setTtsDraft((prev) => ({ ...prev, openai: { ...prev.openai, voice } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.openaiFormat')}</div>
                      <div className="setup-row__desc">{t('setup.tts.openaiFormatDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ width: 140 }}>
                        <select
                          value={ttsDraft.openai.format}
                          onChange={(event) => {
                            const format = event.target.value as OpenAiTtsFormat;
                            setTtsDraft((prev) => ({ ...prev, openai: { ...prev.openai, format } }));
                            setTtsDirty(true);
                          }}
                        >
                          {OPENAI_TTS_FORMATS.map((format) => (
                            <option key={format} value={format}>
                              {format}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {ttsDraft.type === 'loxberry-tts' ? (
                <div className="setup-rows">
                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.mqttHost')}</div>
                      <div className="setup-row__desc">{t('setup.tts.mqttHostDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 220 }}>
                        <input
                          type="text"
                          value={ttsDraft.loxberry.host}
                          placeholder="loxberry.local"
                          onChange={(event) => {
                            setTtsDraft((prev) => ({ ...prev, loxberry: { ...prev.loxberry, host: event.target.value } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.mqttPort')}</div>
                      <div className="setup-row__desc">{t('setup.tts.mqttPortDesc')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ width: 140 }}>
                        <input
                          type="number"
                          value={ttsDraft.loxberry.mqttPort}
                          onChange={(event) => {
                            setTtsDraft((prev) => ({ ...prev, loxberry: { ...prev.loxberry, mqttPort: event.target.value } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.username')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 200 }}>
                        <input
                          type="text"
                          value={ttsDraft.loxberry.username}
                          onChange={(event) => {
                            setTtsDraft((prev) => ({ ...prev, loxberry: { ...prev.loxberry, username: event.target.value } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="setup-row">
                    <div className="setup-row__info">
                      <div className="setup-row__label">{t('setup.tts.password')}</div>
                    </div>
                    <div className="setup-row__control">
                      <div className="setup-input" style={{ minWidth: 200 }}>
                        <input
                          type="password"
                          value={ttsDraft.loxberry.password}
                          onChange={(event) => {
                            setTtsDraft((prev) => ({ ...prev, loxberry: { ...prev.loxberry, password: event.target.value } }));
                            setTtsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="setup-actions">
                <button
                  type="submit"
                  className="setup-btn setup-btn--primary"
                  disabled={ttsSaving || !ttsDirty || !ttsProviderValid}
                >
                  {ttsSaving ? t('setup.tts.saving') : t('setup.tts.saveTts')}
                </button>
                <button
                  type="button"
                  className="setup-btn"
                  onClick={() => {
                    setTtsDraft(buildTtsDraft(data?.config));
                    setTtsDirty(false);
                  }}
                  disabled={!ttsDirty}
                >
                  {t('setup.tts.reset')}
                </button>
                {showTtsValidation ? (
                  <span style={{ color: 'var(--warn)', fontSize: 12 }}>
                    {ttsValidationMessage}
                  </span>
                ) : null}
              </div>
            </form>
          </section>

          {/* ===== Event sounds upload ===== */}
          <section className="setup-section">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.events.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.events.title')}</h2>
                <p className="setup-section__desc">
                  {t('setup.events.descPrefix')}<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-muted)' }}>playeventfile</code>{t('setup.events.descSuffix')}
                </p>
              </div>
            </header>

            <div className="setup-upload">
              <label className="setup-upload__btn">
                {eventSoundUploading ? t('setup.events.uploading') : t('setup.events.chooseFile')}
                <input
                  ref={eventSoundInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,.mp3"
                  disabled={eventSoundUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = '';
                    void handleEventSoundFileUpload(file);
                  }}
                />
              </label>
              <span className="setup-upload__status">
                {eventSoundFilename || (eventSoundUploading ? t('setup.events.uploading') : t('setup.events.noFile'))}
              </span>
            </div>
            <p className="setup-upload__hint">
              {t('setup.events.hintPrefix')}<code>public/alerts/Event_Sounds</code>{t('setup.events.hintMid')}
              <code>audio/grouped/playeventfile/&lt;zone~vol&gt;/Event_Sounds/&lt;file&gt;</code>.
            </p>
          </section>

          {/* ===== Built-in alerts ===== */}
          <section className="setup-section">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.alerts.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.alerts.title')}</h2>
                <p className="setup-section__desc">
                  {t('setup.alerts.desc')}
                </p>
              </div>
            </header>
            <div style={{ padding: '4px 18px 18px' }}>
              <AlertsManager />
            </div>
          </section>
        </>
      ) : null}

      {displayedSetupTab === 'updates' ? (
        <>
          <section className="setup-section">
            <header className="setup-section__head">
              <div className="setup-section__head-main">
                <span className="setup-section__eyebrow setup-section__eyebrow--info">{t('setup.updates.eyebrow')}</span>
                <h2 className="setup-section__title">{t('setup.updates.title')}</h2>
                <p className="setup-section__desc">
                  {t('setup.updates.desc')}
                </p>
              </div>
            </header>

            <div className="setup-updates-status">
              <span
                className={`setup-badge${
                  updatesSummaryTone === 'ok'
                    ? ' setup-badge--ok'
                    : updatesSummaryTone === 'warn'
                      ? ' setup-badge--warn'
                      : ''
                }`}
              >
                {updatesSummaryLabel}
              </span>
              <span className="setup-updates-last">{t('setup.updates.lastCheck', { value: updatesCheckedLabel })}</span>
            </div>

            <div className="setup-update-cards">
              {/* Server core */}
              <article className="setup-update">
                <header className="setup-update__head">
                  <div>
                    <h3 className="setup-update__title">{t('setup.updates.coreTitle')}</h3>
                    <p className="setup-update__desc">{t('setup.updates.coreDesc')}</p>
                  </div>
                  <span
                    className={`setup-badge${
                      coreTone === 'ok' ? ' setup-badge--ok' : coreTone === 'warn' ? ' setup-badge--warn' : ''
                    }`}
                    title={coreBadgeTitle}
                  >
                    {coreLabel}
                  </span>
                </header>
                <div className="setup-update__body">
                  <div className="setup-update__row">
                    <span className="setup-update__label">{t('setup.updates.current')}</span>
                    <span className="setup-update__value">
                      {versionLabel !== '—' ? `v${versionLabel}` : '—'}
                    </span>
                  </div>
                  <div className="setup-update__row">
                    <span className="setup-update__label">{t('setup.updates.latestStable')}</span>
                    <span className="setup-update__value">
                      {latestCoreRelease ? (
                        <a
                          href={`https://github.com/sonn-audio/core/releases/tag/v${latestCoreRelease}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          v{latestCoreRelease}
                        </a>
                      ) : (
                        <a
                          href="https://github.com/sonn-audio/core/releases"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('setup.updates.viewReleases')}
                        </a>
                      )}
                    </span>
                  </div>
                  {coreIsPrerelease || !latestCoreRelease ? (
                    <div className="setup-update__row">
                      <span className="setup-update__label">{t('setup.updates.latestPre')}</span>
                      <span className="setup-update__value">
                        {latestCorePrerelease ? (
                          <a
                            href={`https://github.com/sonn-audio/core/releases/tag/v${latestCorePrerelease}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            v{latestCorePrerelease}
                          </a>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>
                  ) : null}
                </div>
                {serverUpdatedAt ? (
                  <div className="setup-update__foot setup-update__foot--actions">
                    {restartSupervised ? (
                      <button type="button" className="setup-btn setup-btn--primary" onClick={handleAdminUiReload}>
                        {t('setup.updates.reload')}
                      </button>
                    ) : null}
                    <span className="setup-update__hint">
                      {restartSupervised
                        ? t('setup.updates.serverRestartingMessage')
                        : t('setup.updates.serverRestartManualMessage')}
                    </span>
                  </div>
                ) : coreOutdated ? (
                  <div className="setup-update__foot setup-update__foot--actions">
                    <button
                      type="button"
                      className="setup-btn setup-btn--primary"
                      onClick={() => void handleServerUpdate()}
                      disabled={serverUpdating}
                    >
                      {serverUpdating ? t('setup.updates.updating') : t('setup.updates.update')}
                    </button>
                    <span className="setup-update__hint">{coreUpdateHint}</span>
                  </div>
                ) : null}
              </article>

              {/* Web apps (Admin UI + Player) */}
              <article className="setup-update">
                <header className="setup-update__head">
                  <div>
                    <h3 className="setup-update__title">{t('setup.updates.webTitle')}</h3>
                    <p className="setup-update__desc">{t('setup.updates.webDesc')}</p>
                  </div>
                  <span
                    className={`setup-badge${
                      webTone === 'ok' ? ' setup-badge--ok' : webTone === 'warn' ? ' setup-badge--warn' : ''
                    }`}
                  >
                    {webLabel}
                  </span>
                </header>
                <div className="setup-update__body setup-update__weblist">
                  {renderWebApp({
                    name: t('setup.updates.uiTitle'),
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    ),
                    current: `v${__APP_VERSION__}`,
                    latest: latestUiRelease,
                    releasesUrl: latestUiRelease
                      ? `https://github.com/sonn-audio/adminui/releases/tag/v${latestUiRelease}`
                      : 'https://github.com/sonn-audio/adminui/releases',
                    canUpdate: Boolean(uiOutdated),
                    updating: adminUiUpdating,
                    updatedAt: adminUiUpdatedAt,
                    onUpdate: handleAdminUiUpdate,
                    onReload: handleAdminUiReload,
                  })}
                  {renderWebApp({
                    name: t('setup.updates.playerTitle'),
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    ),
                    current: playerInstalled ? `v${playerInstalled}` : '—',
                    latest: latestPlayerRelease,
                    releasesUrl: latestPlayerRelease
                      ? `https://github.com/sonn-audio/player/releases/tag/v${latestPlayerRelease}`
                      : 'https://github.com/sonn-audio/player/releases',
                    canUpdate: Boolean(playerOutdated || (latestPlayerRelease && !playerInstalled)),
                    updating: playerUpdating,
                    updatedAt: playerUpdatedAt,
                    onUpdate: handlePlayerUpdate,
                  })}
                </div>
              </article>

              {/* Components */}
              <article className="setup-update">
                <header className="setup-update__head">
                  <div>
                    <h3 className="setup-update__title">{t('setup.updates.componentsTitle')}</h3>
                    <p className="setup-update__desc">{t('setup.updates.componentsDesc')}</p>
                  </div>
                  <span
                    className={`setup-badge${
                      componentsTone === 'ok'
                        ? ' setup-badge--ok'
                        : componentsTone === 'warn'
                          ? ' setup-badge--warn'
                          : ''
                    }`}
                  >
                    {componentsLabel}
                  </span>
                </header>
                <div className="setup-update__body">
                  <div className="setup-update__row">
                    <span className="setup-update__label">{t('setup.updates.installed')}</span>
                    <span className="setup-update__value">
                      {componentsInstalledCount > 0
                        ? `${componentsInstalledCount} / ${componentRows.length}`
                        : '—'}
                    </span>
                  </div>
                  <div className="setup-update__row">
                    <span className="setup-update__label">{t('setup.updates.outdated')}</span>
                    <span className="setup-update__value">{componentsOutdatedCount}</span>
                  </div>
                </div>
                <div className="setup-update__foot">{componentUpdateHint}</div>
              </article>
            </div>

            {componentsOutdatedCount > 0 ? (
              <div className="setup-update__components">
                {componentRows
                  .filter((row) => row.isOutdated)
                  .map((row) => (
                    <div key={row.name} className="setup-component-row">
                      <span className="setup-component-row__name">{row.name}</span>
                      <span className="setup-component-row__versions">
                        <strong>v{row.installed}</strong> → v{row.latest}
                      </span>
                      <button
                        type="button"
                        className="setup-btn setup-btn--primary"
                        disabled={Boolean(componentUpdatingByName[row.name])}
                        onClick={() => void handleComponentUpdate(row.name, row.latest)}
                      >
                        {componentUpdatingByName[row.name] ? t('setup.updates.updating') : t('setup.updates.update')}
                      </button>
                    </div>
                  ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      </SubPanel>
    </div>
  );
}

