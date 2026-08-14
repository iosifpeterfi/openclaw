// Maintains channel catalog entries advertised by plugins.
import { normalizeOptionalString as resolveOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import { discoverOpenClawPlugins, type PluginDiscoveryResult } from "./discovery.js";
import { loadInstalledPluginIndexInstallRecordsSync } from "./installed-plugin-index-record-reader.js";
import type { PluginPackageChannel, PluginPackageInstall } from "./manifest.js";
import type { PluginOrigin } from "./plugin-origin.types.js";

export type PluginChannelCatalogEntry = {
  pluginId: string;
  origin: PluginOrigin;
  packageName?: string;
  workspaceDir?: string;
  rootDir: string;
  channel: PluginPackageChannel;
  install?: PluginPackageInstall;
};

// clawbase: memoize the discovery result.
//
// discoverOpenClawPlugins + per-plugin loadPluginManifest spend ~50% of total
// CPU in synchronous filesystem syscalls (lstat, readdir, realpath, existsSync)
// walking 100+ plugin directories. The provider-auth resolution path
// (hasRuntimeAvailableProviderAuth -> resolveProviderOwners -> ... ->
// applyPluginAutoEnable) reaches this function on every probe, so each health
// refresh cycle re-scans the whole plugin tree. Inspector CPU profiling on the
// 2026.5.2 gateway captured 80-90s event-loop blocks dominated by this stack.
//
// Upstream's reload-plugins action invalidates plugin state on real config
// change, which is correct but does not address periodic re-discovery during
// steady state.
//
// The cache is keyed on every input that can change the result. Calls that pass
// an explicit `discovery` or `installRecords` override bypass the cache
// entirely, since those callers supply their own inputs and must not observe a
// shared snapshot. OPENCLAW_CHANNEL_CATALOG_DISABLE_CACHE=1 disables it for
// debugging and test isolation.
const channelCatalogCache = new Map<string, PluginChannelCatalogEntry[]>();

function isChannelCatalogCacheDisabled(): boolean {
  const raw = process.env.OPENCLAW_CHANNEL_CATALOG_DISABLE_CACHE;
  return raw === "1" || raw === "true";
}

/** Invalidate the catalog cache (plugin install/uninstall, auto-enable changes). */
export function clearChannelCatalogCache(): void {
  channelCatalogCache.clear();
}

export function listChannelCatalogEntries(
  params: {
    origin?: PluginOrigin;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
    extraPaths?: string[];
    /**
     * Optional override.  When omitted and `origin !== "bundled"`, the persisted
     * plugin install ledger is loaded synchronously so that npm-installed
     * channels stored outside the discovery roots are visible to the catalog.
     * Bundled-only callers skip the load to avoid the disk read.
     */
    installRecords?: Record<string, PluginInstallRecord>;
    discovery?: PluginDiscoveryResult;
  } = {},
): PluginChannelCatalogEntry[] {
  // Only the plain discovery path is cacheable (see comment above).
  // A caller-supplied env changes discovery inputs and is not worth hashing, so
  // those calls (tests, mostly) bypass the cache too.
  const cacheable =
    !isChannelCatalogCacheDisabled() && !params.discovery && !params.installRecords && !params.env;
  const cacheKey = cacheable
    ? JSON.stringify({
        origin: params.origin ?? null,
        workspaceDir: params.workspaceDir ?? null,
        extraPaths: params.extraPaths ?? null,
      })
    : undefined;
  if (cacheKey !== undefined) {
    const cached = channelCatalogCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const entries = buildChannelCatalogEntries(params);
  if (cacheKey !== undefined) {
    channelCatalogCache.set(cacheKey, entries);
  }
  return entries;
}

function buildChannelCatalogEntries(
  params: Parameters<typeof listChannelCatalogEntries>[0] = {},
): PluginChannelCatalogEntry[] {
  const installRecords = resolveInstallRecords(params);
  const discovery =
    params.discovery ??
    discoverOpenClawPlugins({
      workspaceDir: params.workspaceDir,
      env: params.env,
      extraPaths: params.extraPaths,
      ...(installRecords && Object.keys(installRecords).length > 0 ? { installRecords } : {}),
    });
  return discovery.candidates.flatMap((candidate) => {
    if (params.origin && candidate.origin !== params.origin) {
      return [];
    }
    const channel = candidate.packageManifest?.channel;
    if (!channel?.id) {
      return [];
    }
    const pluginId = resolveChannelCatalogPluginId(candidate);
    if (!pluginId) {
      return [];
    }
    return [
      {
        pluginId,
        origin: candidate.origin,
        packageName: candidate.packageName,
        workspaceDir: candidate.workspaceDir,
        rootDir: candidate.rootDir,
        channel,
        ...(candidate.packageManifest?.install
          ? { install: candidate.packageManifest.install }
          : {}),
      },
    ];
  });
}

function resolveChannelCatalogPluginId(
  candidate: PluginDiscoveryResult["candidates"][number],
): string | undefined {
  return (
    resolveOptionalString(candidate.bundledManifest?.id) ??
    resolveOptionalString(candidate.bundledManifestId) ??
    resolveOptionalString(candidate.packageManifest?.plugin?.id) ??
    resolveOptionalString(candidate.idHint)
  );
}

function resolveInstallRecords(params: {
  origin?: PluginOrigin;
  env?: NodeJS.ProcessEnv;
  installRecords?: Record<string, PluginInstallRecord>;
}): Record<string, PluginInstallRecord> | undefined {
  if (params.installRecords) {
    return params.installRecords;
  }
  if (params.origin === "bundled") {
    return undefined;
  }
  try {
    return loadInstalledPluginIndexInstallRecordsSync(params.env ? { env: params.env } : {});
  } catch {
    return undefined;
  }
}
