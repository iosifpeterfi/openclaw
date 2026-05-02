// clawbase patch: drop "cron" from owner-only so the MCP cron tool is exposed
// to claude without requiring explicit owner allowlist configuration. The cron
// tool is gated by gateway-side RPC auth anyway and the MCP HTTP endpoint is
// localhost-only behind a per-session token, so non-owner exposure is acceptable.
export const OPENCLAW_OWNER_ONLY_CORE_TOOL_NAMES = ["gateway", "nodes"] as const;

const OPENCLAW_OWNER_ONLY_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  OPENCLAW_OWNER_ONLY_CORE_TOOL_NAMES,
);

export function isOpenClawOwnerOnlyCoreToolName(toolName: string): boolean {
  return OPENCLAW_OWNER_ONLY_CORE_TOOL_NAME_SET.has(toolName);
}
