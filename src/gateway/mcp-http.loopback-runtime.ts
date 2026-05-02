type McpLoopbackRuntime = {
  port: number;
  ownerToken: string;
  nonOwnerToken: string;
};

// clawbase patch: store on globalThis so duplicate-module-instance scenarios
// (the bundler splits this module into several chunks) all share the same
// runtime metadata. Without this, the cli-runner's prepare.ts can read a null
// runtime even though the loopback is actually bound, then write a claude
// mcp.json without the openclaw url.
const RUNTIME_STATE_KEY = Symbol.for("openclaw.mcp.loopback.runtime");
type RuntimeState = { value: McpLoopbackRuntime | undefined };
const runtimeState: RuntimeState =
  ((globalThis as unknown as Record<symbol, RuntimeState>)[RUNTIME_STATE_KEY] ??=
    { value: undefined });

export function getActiveMcpLoopbackRuntime(): McpLoopbackRuntime | undefined {
  return runtimeState.value ? { ...runtimeState.value } : undefined;
}

export function setActiveMcpLoopbackRuntime(runtime: McpLoopbackRuntime): void {
  runtimeState.value = { ...runtime };
}

export function resolveMcpLoopbackBearerToken(
  runtime: McpLoopbackRuntime,
  senderIsOwner: boolean,
): string {
  return senderIsOwner ? runtime.ownerToken : runtime.nonOwnerToken;
}

export function clearActiveMcpLoopbackRuntimeByOwnerToken(ownerToken: string): void {
  if (runtimeState.value?.ownerToken === ownerToken) {
    runtimeState.value = undefined;
  }
}

export function createMcpLoopbackServerConfig(port: number) {
  return {
    mcpServers: {
      openclaw: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: "Bearer ${OPENCLAW_MCP_TOKEN}",
          "x-session-key": "${OPENCLAW_MCP_SESSION_KEY}",
          "x-openclaw-agent-id": "${OPENCLAW_MCP_AGENT_ID}",
          "x-openclaw-account-id": "${OPENCLAW_MCP_ACCOUNT_ID}",
          "x-openclaw-message-channel": "${OPENCLAW_MCP_MESSAGE_CHANNEL}",
        },
      },
    },
  };
}
