import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// Skill-only plugin. The actual content lives in skills/openclaw-cron/SKILL.md
// and ships through the manifest's skills field. No provider, no harness, no
// runtime registration — the gateway just bundles the skill and claude reads
// it when the description matches the user's intent.
export default definePluginEntry({
  id: "openclaw-cron-skill",
  name: "OpenClaw Cron Skill",
  description:
    "Ships the openclaw-cron skill that teaches claude to use mcp__openclaw__cron for recurring tasks instead of the in-session Schedule tool.",
  register() {
    // intentionally empty — see SKILL.md
  },
});
