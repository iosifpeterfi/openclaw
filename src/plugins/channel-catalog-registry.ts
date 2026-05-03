import { discoverOpenClawPlugins } from "./discovery.js";
import {
  loadPluginManifest,
  type PluginPackageChannel,
  type PluginPackageInstall,
} from "./manifest.js";
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

// Memoization: discoverOpenClawPlugins + loadPluginManifest perform ~50%
// of total CPU as synchronous filesystem syscalls (lstat, readdir, realpath,
// existsSync) walking 100+ plugin directories. applyPluginAutoEnable's
// call chain reaches this function on every provider-auth resolution —
// producing 60-180s event-loop blocks observed via Inspector CPU profiling.
//
// The plugin set is effectively immutable for the gateway's lifetime once
// startup completes. Cache the result indefinitely on first call; invalidate
// explicitly via clearChannelCatalogCache() when plugins are installed,
// uninstalled, or lazy-loaded into a different shape (auto-enable state
// changes don't affect this cache — origin filtering happens on read).
//
// Setting OPENCLAW_CHANNEL_CATALOG_DISABLE_CACHE=1 disables the cache for
// debugging and test isolation; otherwise the cache lives for the process.
const channelCatalogCache = new Map<string, PluginChannelCatalogEntry[]>();

function isCacheDisabled(): boolean {
  const raw = process.env.OPENCLAW_CHANNEL_CATALOG_DISABLE_CACHE;
  return raw === "1" || raw === "true";
}

function buildCacheKey(workspaceDir: string | undefined): string {
  return workspaceDir ?? "";
}

function buildChannelCatalogEntries(
  workspaceDir: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): PluginChannelCatalogEntry[] {
  return discoverOpenClawPlugins({
    workspaceDir,
    env,
  }).candidates.flatMap((candidate) => {
    const channel = candidate.packageManifest?.channel;
    if (!channel?.id) {
      return [];
    }
    const manifest = loadPluginManifest(candidate.rootDir, candidate.origin !== "bundled");
    if (!manifest.ok) {
      return [];
    }
    return [
      {
        pluginId: manifest.manifest.id,
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

export function listChannelCatalogEntries(
  params: {
    origin?: PluginOrigin;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): PluginChannelCatalogEntry[] {
  const cacheDisabled = isCacheDisabled();
  const key = buildCacheKey(params.workspaceDir);
  let entries = cacheDisabled ? undefined : channelCatalogCache.get(key);
  if (!entries) {
    entries = buildChannelCatalogEntries(params.workspaceDir, params.env);
    if (!cacheDisabled) {
      channelCatalogCache.set(key, entries);
    }
  }
  if (params.origin) {
    return entries.filter((entry) => entry.origin === params.origin);
  }
  return entries;
}

export function clearChannelCatalogCache(): void {
  channelCatalogCache.clear();
}
