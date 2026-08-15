import type { ModelChoice } from '../../host/catalog';
import type { StepProvider } from '../../schema/types';

/**
 * The models an agent/fan-out node can pick, keyed off its provider.
 *
 * The host's `ai.listModels()` (what `catalog.models` carries) returns *chat*
 * provider models — invalid for these nodes, which run agent CLIs and require a
 * provider-native identifier. Claude Code selects a variant from a
 * `claude-code:<variant>` id (the runtime's `resolveClaudeCodeModelVariant`
 * throws on anything else). Codex and Copilot CLI choose their own model, so we
 * offer none and leave the node on the host default.
 *
 * Curated like `TOOL_CHOICES`: the four current-generation canonical variants a
 * flow author reaches for. Pinned previous-generation ids (opus-4-6, …) stay
 * hand-editable in the file rather than cluttering the picker.
 */
export const CLAUDE_CODE_MODEL_OPTIONS: readonly ModelChoice[] = [
  { value: 'claude-code:opus', label: 'Opus' },
  { value: 'claude-code:sonnet', label: 'Sonnet' },
  { value: 'claude-code:haiku', label: 'Haiku' },
  { value: 'claude-code:fable', label: 'Fable' },
];

/** Model choices for a node's provider; an unset provider defaults to claude-code. */
export function modelOptionsForProvider(provider: StepProvider | undefined): readonly ModelChoice[] {
  switch (provider) {
    case undefined:
    case 'claude-code':
      return CLAUDE_CODE_MODEL_OPTIONS;
    case 'openai-codex':
    case 'copilot-cli':
      return [];
  }
}
