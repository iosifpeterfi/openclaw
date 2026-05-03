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
  packageVersion?: string;
  workspaceDir?: string;
  rootDir: string;
  channel: PluginPackageChannel;
  install?: PluginPackageInstall;
};

// Memoization: discoverOpenClawPlugins + per-plugin loadPluginManifest does
// ~50% of total CPU as synchronous filesystem syscalls (lstat, readdir,
// realpath, existsSync) walking 100+ plugin directories. The provider-auth
// resolution path (hasRuntimeAvailableProviderAuth → resolveProviderOwners
// → ... → applyPluginAutoEnable) reaches this function on every probe, so
// each health refresh cycle would otherwise re-scan the entire plugin tree.
// Inspector CPU profiling on v2026.5.2 captured 80-90s event loop blocks
// dominated by this code path. Cache the rebuild result indefinitely on
// first call; invalidate explicitly via clearChannelCatalogCache() when
// plugins are installed/uninstalled or auto-enable shape changes.
//
// OPENCLAW_CHANNEL_CATALOG_DISABLE_CACHE=1 disables the cache for
// debugging or test isolation.
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
        packageVersion: candidate.packageVersion,
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
