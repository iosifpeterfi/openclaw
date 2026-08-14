// Gateway channel health monitor.
// Periodically evaluates channel account health and restarts stale runtimes.
import type { ChannelId } from "../channels/plugins/types.public.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveTimerTimeoutMs } from "../shared/number-coercion.js";
import {
  DEFAULT_CHANNEL_CONNECT_GRACE_MS,
  DEFAULT_CHANNEL_STALE_EVENT_THRESHOLD_MS,
  evaluateChannelHealth,
  resolveChannelRestartReason,
  type ChannelHealthPolicy,
} from "./channel-health-policy.js";
import type { ChannelManager } from "./server-channels.js";

const log = createSubsystemLogger("gateway/health-monitor");

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MONITOR_STARTUP_GRACE_MS = 60_000;
const DEFAULT_COOLDOWN_CYCLES = 2;
const DEFAULT_MAX_RESTARTS_PER_HOUR = 10;
const ONE_HOUR_MS = 60 * 60_000;

/**
 * How long a connected channel can go without proven transport activity before
 * the health monitor treats it as a "stale socket" and triggers a restart.
 * Providers should only publish that timestamp from transport/heartbeat/poll
 * signals, not from ordinary app messages.
 */
type ChannelHealthTimingPolicy = {
  monitorStartupGraceMs: number;
  channelConnectGraceMs: number;
  staleEventThresholdMs: number;
};

type ChannelHealthMonitorDeps = {
  channelManager: ChannelManager;
  checkIntervalMs?: number;
  /** @deprecated use timing.monitorStartupGraceMs */
  startupGraceMs?: number;
  /** @deprecated use timing.channelConnectGraceMs */
  channelStartupGraceMs?: number;
  /** @deprecated use timing.staleEventThresholdMs */
  staleEventThresholdMs?: number;
  timing?: Partial<ChannelHealthTimingPolicy>;
  cooldownCycles?: number;
  maxRestartsPerHour?: number;
  abortSignal?: AbortSignal;
};

export type ChannelHealthMonitor = {
  stop: () => void;
};

type RestartRecord = {
  lastRestartAt: number;
  restartsThisHour: { at: number }[];
};

function resolveTimingPolicy(
  deps: Pick<
    ChannelHealthMonitorDeps,
    "startupGraceMs" | "channelStartupGraceMs" | "staleEventThresholdMs" | "timing"
  >,
): ChannelHealthTimingPolicy {
  return {
    monitorStartupGraceMs:
      deps.timing?.monitorStartupGraceMs ?? deps.startupGraceMs ?? DEFAULT_MONITOR_STARTUP_GRACE_MS,
    channelConnectGraceMs:
      deps.timing?.channelConnectGraceMs ??
      deps.channelStartupGraceMs ??
      DEFAULT_CHANNEL_CONNECT_GRACE_MS,
    staleEventThresholdMs:
      deps.timing?.staleEventThresholdMs ??
      deps.staleEventThresholdMs ??
      DEFAULT_CHANNEL_STALE_EVENT_THRESHOLD_MS,
  };
}

/** Start the periodic channel health monitor and return its stop handle. */
export function startChannelHealthMonitor(deps: ChannelHealthMonitorDeps): ChannelHealthMonitor {
  const {
    channelManager,
    cooldownCycles = DEFAULT_COOLDOWN_CYCLES,
    maxRestartsPerHour = DEFAULT_MAX_RESTARTS_PER_HOUR,
    abortSignal,
  } = deps;
  const checkIntervalMs = resolveTimerTimeoutMs(deps.checkIntervalMs, DEFAULT_CHECK_INTERVAL_MS);
  const timing = resolveTimingPolicy(deps);

  const cooldownMs = cooldownCycles * checkIntervalMs;
  const restartRecords = new Map<string, RestartRecord>();
  const startedAt = Date.now();
  let stopped = false;
  let checkInFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let earlyTimer: ReturnType<typeof setTimeout> | null = null;
  const suppressedAccounts = new Set<string>();

  const rKey = (channelId: string, accountId: string) => `${channelId}:${accountId}`;

  function pruneOldRestarts(record: RestartRecord, now: number) {
    record.restartsThisHour = record.restartsThisHour.filter((r) => now - r.at < ONE_HOUR_MS);
  }

  async function runCheck() {
    if (stopped || checkInFlight) {
      return;
    }
    checkInFlight = true;

    try {
      const now = Date.now();
      if (now - startedAt < timing.monitorStartupGraceMs) {
        return;
      }

      const snapshot = channelManager.getRuntimeSnapshot();
      const autostartSuppression = channelManager.getAutostartSuppression();
      if (!autostartSuppression) {
        suppressedAccounts.clear();
      }

      for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
        if (!accounts) {
          continue;
        }
        for (const [accountId, status] of Object.entries(accounts)) {
          if (!status) {
            continue;
          }
          if (!channelManager.isHealthMonitorEnabled(channelId as ChannelId, accountId)) {
            continue;
          }
          if (channelManager.isManuallyStopped(channelId as ChannelId, accountId)) {
            continue;
          }
          const key = rKey(channelId, accountId);
          if (autostartSuppression) {
            if (status.running !== true && !suppressedAccounts.has(key)) {
              log.info?.(
                `[${channelId}:${accountId}] health-monitor: channel autostart suppressed; treating as expected stopped`,
              );
              suppressedAccounts.add(key);
            }
            continue;
          }
          suppressedAccounts.delete(key);
          const healthPolicy: ChannelHealthPolicy = {
            channelId,
            now,
            staleEventThresholdMs: timing.staleEventThresholdMs,
            channelConnectGraceMs: timing.channelConnectGraceMs,
          };
          const health = evaluateChannelHealth(status, healthPolicy);
          if (health.healthy) {
            continue;
          }
          if (health.reason === "terminal-disconnect") {
            log.info?.(
              `[${channelId}:${accountId}] health-monitor: skipping restart, terminal disconnect`,
            );
            continue;
          }

          const record = restartRecords.get(key) ?? {
            lastRestartAt: 0,
            restartsThisHour: [],
          };

          const continuingPendingRestart =
            status.running !== true &&
            status.restartPending === true &&
            (status.reconnectAttempts ?? 0) === 0;

          // A timed-out recovery stop uses the first start request to mark
          // restartPending; the next monitor pass must finish that same recovery
          // instead of waiting behind this monitor's fresh-restart cooldown.
          if (!continuingPendingRestart && now - record.lastRestartAt <= cooldownMs) {
            continue;
          }

          pruneOldRestarts(record, now);
          if (!continuingPendingRestart && record.restartsThisHour.length >= maxRestartsPerHour) {
            log.warn?.(
              `[${channelId}:${accountId}] health-monitor: hit ${maxRestartsPerHour} restarts/hour limit, skipping`,
            );
            continue;
          }

          const reason = resolveChannelRestartReason(status, health);

          log.info?.(`[${channelId}:${accountId}] health-monitor: restarting (reason: ${reason})`);

          if (!continuingPendingRestart) {
            record.lastRestartAt = now;
            record.restartsThisHour.push({ at: now });
            restartRecords.set(key, record);
          }

          try {
            if (status.running) {
              await channelManager.stopChannel(channelId as ChannelId, accountId, {
                manual: false,
              });
            }
            channelManager.resetRestartAttempts(channelId as ChannelId, accountId);
            await channelManager.startChannel(channelId as ChannelId, accountId);
          } catch (err) {
            log.error?.(
              `[${channelId}:${accountId}] health-monitor: restart failed: ${String(err)}`,
            );
          }
        }
      }
    } catch (err) {
      log.error?.(`health-monitor: check failed: ${String(err)}`);
    } finally {
      checkInFlight = false;
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (earlyTimer) {
      clearTimeout(earlyTimer);
      earlyTimer = null;
    }
    abortSignal?.removeEventListener("abort", stop);
  }

  if (abortSignal?.aborted) {
    stopped = true;
  } else {
    abortSignal?.addEventListener("abort", stop, { once: true });
    // clawbase: fire one early check just past the startup grace window.
    // Without it, a channel that never started at boot (e.g. the
    // plugin/harness registration race that reports "Requested agent harness
    // 'claude-cli' is not registered") waits a full checkIntervalMs — 5 min on
    // default settings — before the first interval-driven check picks it up.
    // Users feel that as "WhatsApp linked but not receiving messages" right
    // after a fresh provision or a pair-link cycle. The early check is safe:
    // channels that did start are still inside channel-connect-grace and are
    // evaluated as healthy, so it only catches "never started" channels.
    const earlyCheckDelayMs = timing.monitorStartupGraceMs + 5_000;
    earlyTimer = setTimeout(() => void runCheck(), earlyCheckDelayMs);
    if (typeof earlyTimer === "object" && "unref" in earlyTimer) {
      earlyTimer.unref();
    }
    timer = setInterval(() => void runCheck(), checkIntervalMs);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    log.info?.(
      `started (interval: ${Math.round(checkIntervalMs / 1000)}s, startup-grace: ${Math.round(timing.monitorStartupGraceMs / 1000)}s, channel-connect-grace: ${Math.round(timing.channelConnectGraceMs / 1000)}s, early-check: ${Math.round(earlyCheckDelayMs / 1000)}s)`,
    );
  }

  return { stop };
}
