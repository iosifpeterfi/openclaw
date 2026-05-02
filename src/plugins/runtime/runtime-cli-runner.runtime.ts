// Lazy runtime module exposing runCliAgent to plugins. Mirrors the pattern in
// runtime-embedded-pi.runtime.ts. Loaded on-demand via createLazyRuntimeModule.
export { runCliAgent } from "../../agents/cli-runner.runtime.js";
