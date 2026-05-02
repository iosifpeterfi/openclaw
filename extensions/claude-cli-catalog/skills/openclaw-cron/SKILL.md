---
name: openclaw-cron
description: Use openclaw's native cron CLI for any recurring task, heartbeat, schedule, periodic check-in, reminder, or "every N minutes/hours" request. ALWAYS use `openclaw cron` via the Bash tool — never the built-in Schedule tool, which is session-only and breaks on restart. This skill applies whenever the user asks to schedule, repeat, ping periodically, set a heartbeat, run something on an interval, or set up a cron.
user-invocable: false
---

# Recurring tasks (cron / heartbeats / schedules)

**Do NOT use the built-in `Schedule` tool** for recurring tasks. It is session-only,
auto-expires after 7 days, and dies on every gateway restart. Always use openclaw's
native cron via the Bash tool.

## Creating a cron

```bash
openclaw cron add \
  --name <short-name> \
  --every <duration> \
  --message "<exact prompt to send the sub-agent each fire>" \
  --session isolated \
  --model claude-cli/opus \
  --channel telegram \
  --to <chat-id>
```

`--every` accepts durations like `1m`, `10m`, `1h`, `30s`. For one-shot future runs use
`--at <iso-or-+duration>` instead of `--every`. For complex schedules, use `--cron <expr>`
with a 5- or 6-field cron expression and `--tz <iana>` if the user specified a timezone.

## Required values

- **`--model` MUST be one of**: `claude-cli/opus`, `claude-cli/sonnet`, `claude-cli/haiku`.
  Never `anthropic/*` or any other provider. The `claude-cli/*` models route through the
  Claude subscription via OAuth; anything else will try to bill against an Anthropic API
  key and fail.
- **`--session isolated`** — gives each fire a fresh sub-agent context with no history
  bleed from prior fires or the parent conversation.
- **`--channel telegram --to <chat-id>`** — required for delivery. **If you do not know
  the chat-id for the current conversation, ask the user for it before creating the cron.**
  Do not guess, do not invent, do not omit `--to`. Saying "I'll figure it out later" is
  wrong — without `--to`, fires succeed but their replies never reach the user.
- **`--message`** must be a complete, self-contained prompt. Each fire is a fresh
  isolated session with no memory of the parent conversation, so the message must include
  all context the sub-agent needs. Be explicit about what to do, what format to reply in,
  and to stop after replying. Example: `"Reply with the literal word 'heartbeat' followed
  by the current UTC time in HH:MM format, then stop. Do not call any tools."`

## After creating

Always run:

```bash
openclaw cron list
```

And report back to the user: the cron's UUID, schedule, and `Next` time. The user will
need the UUID to edit/disable/remove later. Surface this clearly — not buried in a long
reply.

## Managing existing crons

```bash
openclaw cron list                     # list active jobs
openclaw cron list --all               # include disabled
openclaw cron show <uuid>              # full details + last run state
openclaw cron disable <uuid>           # pause without deleting
openclaw cron enable <uuid>            # resume
openclaw cron rm <uuid>                # delete permanently
openclaw cron edit <uuid> --every 5m   # change schedule, message, etc.
openclaw cron run <uuid>               # debug-fire once now (bypasses schedule)
openclaw cron runs <uuid>              # show recent run history
```

## When to ask the user vs. just do it

- "Every minute, ping me a heartbeat" → ask for the chat-id (if unknown), then create.
- "Remind me daily at 9am" → ask for chat-id (if unknown) and timezone, then use
  `--cron "0 9 * * *" --tz <tz>`.
- "Stop the cron" → list, identify by name/schedule, `cron rm <uuid>`. Confirm with
  the user which one if multiple match.
- "Schedule a task" without context → ask what should fire, how often, and where the
  result should go before doing anything.

## Anti-patterns to avoid

- Reaching for the `Schedule` tool because it's faster — it's not, and it will silently
  break.
- Creating a cron without `--to` and assuming "it'll just deliver to here" — it won't.
- Using `anthropic/claude-opus-4-7` (or any `anthropic/*` model) — that path needs an API
  key and is not what the subscription provides; use `claude-cli/opus`.
- Creating a cron without telling the user the UUID — they'll have no way to manage it.
- Burying the cron creation result inside a long reply — surface it: name, UUID,
  schedule, destination.
- Inventing a chat-id you don't know — ask instead.
