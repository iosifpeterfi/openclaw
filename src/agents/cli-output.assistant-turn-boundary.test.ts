/**
 * clawbase: assistant-turn boundary detection in the CLI JSONL streaming parser.
 *
 * Claude CLI emits one top-level `type: "assistant"` record per API call between
 * tool invocations, while the parser accumulates assistant text across the whole
 * run. Channels that edit a draft message (Telegram) need a boundary signal so
 * they rotate to a fresh message instead of rewriting one draft with
 * ever-growing cumulative text.
 */
import { describe, expect, it } from "vitest";
import type { CliBackendConfig } from "../config/types.js";
import { createCliJsonlStreamingParser } from "./cli-output.js";

const backend = {
  command: "claude",
  output: "jsonl",
  input: "stdin",
} as unknown as CliBackendConfig;

/** One assistant turn: a text delta followed by the turn's `assistant` record. */
function assistantTurn(text: string): string {
  return (
    `${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    })}\n` +
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`
  );
}

describe("assistant-turn boundary", () => {
  it("does not fire on the first assistant record", () => {
    let starts = 0;
    const parser = createCliJsonlStreamingParser({
      backend,
      providerId: "claude-cli",
      onAssistantDelta: () => {},
      onAssistantMessageStart: () => {
        starts += 1;
      },
    });
    parser.push(assistantTurn("first"));
    parser.finish();
    expect(starts).toBe(0);
  });

  it("fires once per subsequent assistant record", () => {
    let starts = 0;
    const parser = createCliJsonlStreamingParser({
      backend,
      providerId: "claude-cli",
      onAssistantDelta: () => {},
      onAssistantMessageStart: () => {
        starts += 1;
      },
    });
    parser.push(assistantTurn("one"));
    parser.push(assistantTurn("two"));
    parser.push(assistantTurn("three"));
    parser.finish();
    // 3 turns -> boundaries before turn 2 and turn 3.
    expect(starts).toBe(2);
  });

  it("resets the accumulator at a boundary so the next turn is not cumulative", () => {
    // Ordering matters here. The reset fires when the `assistant` record is
    // seen, so it only de-cumulates a turn whose deltas arrive AFTER that
    // record - which is what the callback name (message *start*) implies.
    // Deltas within a single turn remain cumulative by design.
    const seen: string[] = [];
    const parser = createCliJsonlStreamingParser({
      backend,
      providerId: "claude-cli",
      onAssistantDelta: ({ text }) => {
        seen.push(text);
      },
      onAssistantMessageStart: () => {},
    });
    const record = `${JSON.stringify({ type: "assistant", message: { content: [] } })}\n`;
    const delta = (text: string) =>
      `${JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text } },
      })}\n`;
    parser.push(record); // turn 1 starts (first record: no reset)
    parser.push(delta("AAA"));
    parser.push(record); // turn 2 starts -> reset
    parser.push(delta("BBB"));
    parser.finish();
    // Without the reset the second turn would surface as "AAABBB".
    expect(seen.at(-1)).toBe("BBB");
    expect(seen.some((t) => t.includes("AAABBB"))).toBe(false);
  });

  it("is safe when no callback is supplied", () => {
    const parser = createCliJsonlStreamingParser({
      backend,
      providerId: "claude-cli",
      onAssistantDelta: () => {},
    });
    expect(() => {
      parser.push(assistantTurn("x"));
      parser.push(assistantTurn("y"));
      parser.finish();
    }).not.toThrow();
  });

  it("a throwing callback cannot break CLI parsing", () => {
    const seen: string[] = [];
    const parser = createCliJsonlStreamingParser({
      backend,
      providerId: "claude-cli",
      onAssistantDelta: ({ text }) => {
        seen.push(text);
      },
      onAssistantMessageStart: () => {
        throw new Error("reply pipeline exploded");
      },
    });
    expect(() => {
      parser.push(assistantTurn("one"));
      parser.push(assistantTurn("two"));
      parser.finish();
    }).not.toThrow();
    // Parsing must have continued past the throwing boundary.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toContain("two");
  });
});
