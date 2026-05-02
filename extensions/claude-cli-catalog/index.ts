import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const PROVIDER_ID = "claude-cli";

const MODELS = [
  { id: "opus", name: "Claude Opus (CLI)", contextWindow: 200000 },
  { id: "sonnet", name: "Claude Sonnet (CLI)", contextWindow: 200000 },
  { id: "haiku", name: "Claude Haiku (CLI)", contextWindow: 200000 },
] as const;

export default definePluginEntry({
  id: "claude-cli-catalog",
  name: "Claude CLI Catalog",
  description:
    "Registers claude-cli/{opus,sonnet,haiku} model entries so cron + sub-agent dispatch resolves to the existing claude-cli runner.",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "Claude CLI",
      auth: [],
      preserveLiteralProviderPrefix: true,
      augmentModelCatalog: () =>
        MODELS.map((model) => ({
          provider: PROVIDER_ID,
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow,
          input: ["text"],
        })),
    });
  },
});
