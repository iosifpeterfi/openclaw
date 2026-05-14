import { getRuntimeConfig } from "../config/io.js";

export type GatewayModelChoice = import("../agents/model-catalog.js").ModelCatalogEntry;

type GatewayModelCatalogConfig = ReturnType<typeof getRuntimeConfig>;
type LoadModelCatalog = (params: {
  config: GatewayModelCatalogConfig;
}) => Promise<GatewayModelChoice[]>;
type LoadGatewayModelCatalogParams = {
  getConfig?: () => GatewayModelCatalogConfig;
  loadModelCatalog?: LoadModelCatalog;
};

let lastSuccessfulCatalog: GatewayModelChoice[] | null = null;
let inFlightRefresh: Promise<GatewayModelChoice[]> | null = null;
let staleGeneration = 0;
let appliedGeneration = 0;
let deferredRefreshScheduled = false;
const DEFERRED_CATALOG_REFRESH_DELAY_MS = 60_000;

function resetGatewayModelCatalogState(): void {
  lastSuccessfulCatalog = null;
  inFlightRefresh = null;
  staleGeneration = 0;
  appliedGeneration = 0;
}

function isGatewayModelCatalogStale(): boolean {
  return appliedGeneration < staleGeneration;
}

async function resolveLoadModelCatalog(
  params?: LoadGatewayModelCatalogParams,
): Promise<LoadModelCatalog> {
  if (params?.loadModelCatalog) {
    return params.loadModelCatalog;
  }
  const { loadModelCatalog } = await import("../agents/model-catalog.js");
  return loadModelCatalog;
}

function startGatewayModelCatalogRefresh(
  params?: LoadGatewayModelCatalogParams,
): Promise<GatewayModelChoice[]> {
  const config = (params?.getConfig ?? getRuntimeConfig)();
  const refreshGeneration = staleGeneration;
  const refresh = resolveLoadModelCatalog(params)
    .then((loadModelCatalog) => loadModelCatalog({ config }))
    .then((catalog) => {
      if (catalog.length > 0 && refreshGeneration === staleGeneration) {
        lastSuccessfulCatalog = catalog;
        appliedGeneration = staleGeneration;
      }
      return catalog;
    })
    .finally(() => {
      if (inFlightRefresh === refresh) {
        inFlightRefresh = null;
      }
    });
  inFlightRefresh = refresh;
  return refresh;
}

export function markGatewayModelCatalogStaleForReload(): void {
  staleGeneration += 1;
}

// Test-only escape hatch: model catalog is cached at module scope for the
// process lifetime, which is fine for the real gateway daemon, but makes
// isolated unit tests harder. Keep this intentionally obscure.
export async function __resetModelCatalogCacheForTest(): Promise<void> {
  resetGatewayModelCatalogState();
  const { resetModelCatalogCacheForTest } = await import("../agents/model-catalog.js");
  resetModelCatalogCacheForTest();
}

// Seed catalog returned while the real (slow) Pi SDK probe runs in background.
// registry.getAll() in model-catalog.ts blocks the event loop synchronously
// for 25-35s on claude-cli providers; returning this seed immediately keeps
// the event loop responsive during startup so Telegram polling and dashboard
// WebSocket requests aren't starved.
const SEED_CATALOG: GatewayModelChoice[] = [
  { id: "opus", name: "Claude Opus", provider: "claude-cli" },
  { id: "sonnet", name: "Claude Sonnet", provider: "claude-cli" },
  { id: "haiku", name: "Claude Haiku", provider: "claude-cli" },
];

export async function loadGatewayModelCatalog(
  params?: LoadGatewayModelCatalogParams,
): Promise<GatewayModelChoice[]> {
  const isStale = isGatewayModelCatalogStale();
  if (!isStale && lastSuccessfulCatalog) {
    return lastSuccessfulCatalog;
  }
  if (isStale && lastSuccessfulCatalog) {
    if (!inFlightRefresh) {
      void startGatewayModelCatalogRefresh(params).catch(() => undefined);
    }
    return lastSuccessfulCatalog;
  }
  if (inFlightRefresh) {
    // Return seed catalog immediately instead of awaiting the blocking probe.
    // The in-flight refresh will update lastSuccessfulCatalog when it completes.
    return SEED_CATALOG;
  }
  // Never run the blocking Pi SDK probe from the gateway event loop.
  // registry.getAll() blocks for 25-35s synchronously, which freezes
  // Telegram polling, WebSocket responses, and all async I/O.
  // The seed catalog provides the known claude-cli models; the real
  // catalog will be populated on the first successful agent turn
  // (which runs in a child process, not on the gateway event loop).
  return SEED_CATALOG;
}
