export const CLI_WATCHDOG_MIN_TIMEOUT_MS = 1_000;

export const CLI_FRESH_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.8,
  minMs: 900_000,
  maxMs: 900_000,
} as const;

export const CLI_RESUME_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.3,
  minMs: 900_000,
  maxMs: 900_000,
} as const;
