---
name: openclaw-cron
description: Use the `mcp__openclaw__cron` tool for any recurring task, heartbeat, schedule, periodic check-in, reminder, "every N minutes/hours" request, or delayed follow-up. NEVER use the built-in `Schedule` tool — it is session-only, auto-expires after 7 days, and dies on every gateway restart. This skill applies whenever the user asks to schedule, repeat, ping periodically, set a heartbeat, run something on an interval, set a reminder, or "check back later".
user-invocable: false
---

# Recurring tasks (cron / heartbeats / schedules / reminders)

**NEVER use the built-in `Schedule` tool.** It is session-only, auto-expires after 7
days, and dies on every gateway restart. You will silently lose all scheduled work.

**ALWAYS use `mcp__openclaw__cron`.** It is durable, persists across restarts, and is
the only correct way to set up recurring or future tasks in this gateway.

## Tool

`mcp__openclaw__cron` — actions: `status`, `list`, `add`, `update`, `remove`, `run`,
`runs`, `wake`.

## Creating a cron — required shape

```json
{
  "action": "add",
  "job": {
    "name": "<short-name>",
    "schedule": { "kind": "every", "everyMs": 60000 },
    "payload": {
      "kind": "agentTurn",
      "message": "<exact prompt to send the sub-agent each fire>",
      "model": "claude-cli/opus"
    },
    "sessionTarget": "isolated",
    "delivery": {
      "mode": "announce",
      "channel": "telegram",
      "to": "<chat-id>"
    }
  }
}
```

## Required values

- **`payload.model` MUST be `claude-cli/opus`** (or `claude-cli/sonnet` / `claude-cli/haiku`).
  Never `anthropic/*` — that path needs an API key and is not what the subscription
  provides.
- **`sessionTarget: "isolated"`** — gives each fire a fresh sub-agent context with no
  history bleed. Required when `payload.kind == "agentTurn"`.
- **`delivery.channel: "telegram"` + `delivery.to: "<chat-id>"`** — required for the
  user to actually receive the result. **If you do not know the chat-id, ASK the user
  before creating the cron.** Do not invent one. Saying "I'll figure it out later" is
  wrong — without `delivery.to`, fires succeed but their replies never reach the user.
- **`payload.message`** must be a complete, self-contained prompt — each fire is a
  fresh isolated session with no memory of the parent conversation. Be explicit about
  what to do, what format to reply in, and to stop after replying. Example:
  `"Reply with the literal word 'heartbeat' followed by the current UTC time in HH:MM
  format, then stop. Do not call any tools."`

## Schedule shapes

- **`"every"` interval**: `{ "kind": "every", "everyMs": 60000 }` (every minute)
- **`"at"` one-shot**: `{ "kind": "at", "at": "2026-05-02T18:00:00Z" }` (UTC unless tz is given)
- **`"cron"` expression**: `{ "kind": "cron", "expr": "0 9 * * *", "tz": "Europe/Bucharest" }`
  Write the expression in the user's local time and pass `tz` — do not pre-convert to UTC.

## After creating

Always call `mcp__openclaw__cron` with `action: "list"` and report back to the user:
the cron's UUID, schedule, and next run time. The user needs the UUID to manage it.
Surface this clearly in your reply — not buried.

## Managing existing crons

- `{ "action": "list" }` — list active jobs (add `"includeDisabled": true` for all)
- `{ "action": "list", "jobId": "<uuid>" }` is wrong — use `"status"` for scheduler-wide info
- `{ "action": "remove", "jobId": "<uuid>" }` — delete permanently
- `{ "action": "update", "jobId": "<uuid>", "patch": { "enabled": false } }` — disable
- `{ "action": "update", "jobId": "<uuid>", "patch": { "schedule": {...} } }` — change schedule
- `{ "action": "run", "jobId": "<uuid>" }` — debug-fire once now
- `{ "action": "runs", "jobId": "<uuid>" }` — recent run history

## When to ask the user vs. just do it

- "Every minute, ping me a heartbeat" → ask for the chat-id (if unknown), then create.
- "Remind me daily at 9am" → ask for chat-id (if unknown) and timezone, then use
  `{ "kind": "cron", "expr": "0 9 * * *", "tz": "<tz>" }`.
- "Stop the cron" → list, identify by name/schedule, remove. Confirm with the user
  if multiple match.
- "Schedule a task" without context → ask what should fire, how often, and where the
  result should go before doing anything.

## Anti-patterns

- Reaching for the `Schedule` tool because it's faster — it's not, and it will silently
  break. There is never a valid reason to use `Schedule` on this gateway.
- Creating a cron without `delivery.to` — fires succeed, replies vanish.
- Using `anthropic/claude-opus-4-7` (or any `anthropic/*` model) as `payload.model` —
  that needs an API key. Use `claude-cli/opus`.
- Creating a cron without surfacing the UUID to the user — they have no way to manage it.
- Inventing a chat-id you don't know — ask instead.
- Emulating scheduling with `sleep` in a Bash loop — never. Use the cron tool.
