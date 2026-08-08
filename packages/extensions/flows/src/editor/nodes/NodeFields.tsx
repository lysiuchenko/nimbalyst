import { useState } from 'react';
import type { CatalogEntry } from '../../host/catalog';

/**
 * A picker over a discovered catalog, with a free-text escape hatch.
 *
 * Typing a skill name from memory is the single easiest way to build a flow
 * that fails halfway through, so the default is to choose from what the
 * workspace actually has. "Custom…" stays available because a flow may be
 * authored before the skill it targets exists, or shared across machines.
 */
export function CatalogPicker({
  label,
  value,
  entries,
  placeholder,
  emptyHint,
  onChange,
}: {
  label: string;
  value: string;
  entries: CatalogEntry[];
  placeholder: string;
  emptyHint: string;
  onChange: (value: string) => void;
}) {
  const known = entries.some((entry) => entry.value === value);
  const [custom, setCustom] = useState(!known && value !== '');
  const selected = entries.find((entry) => entry.value === value);

  return (
    <label className="flow-node-field">
      <span className="flow-node-field-label">
        {label}
        <button
          type="button"
          className="flow-node-field-toggle"
          onClick={() => setCustom((previous) => !previous)}
          title={custom ? 'Choose from this workspace' : 'Type a name instead'}
        >
          {custom ? 'pick' : 'custom'}
        </button>
      </span>

      {custom || entries.length === 0 ? (
        <>
          <input
            className="flow-node-input"
            aria-label={label}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {entries.length === 0 && <span className="flow-node-hint">{emptyHint}</span>}
        </>
      ) : (
        <select
          className="flow-node-input"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— choose —</option>
          {entries.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.name}
              {entry.source ? ` · ${entry.source}` : ''}
            </option>
          ))}
        </select>
      )}

      {selected?.description && <span className="flow-node-hint">{selected.description}</span>}
      {selected?.argumentHint && (
        <span className="flow-node-hint">takes: {selected.argumentHint}</span>
      )}
    </label>
  );
}

/** Multi-select over a fixed list, rendered as toggles rather than a select. */
export function ToolPicker({
  value,
  choices,
  onChange,
}: {
  value: string[] | undefined;
  choices: readonly string[];
  onChange: (value: string[] | undefined) => void;
}) {
  const selected = new Set(value ?? []);

  const toggle = (tool: string) => {
    const next = new Set(selected);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    // Undefined, not [], means "host default" — an empty array would read as
    // "no tools at all", which is a different and much more restrictive thing.
    onChange(next.size === 0 ? undefined : [...next]);
  };

  return (
    <div className="flow-node-field">
      <span className="flow-node-field-label">
        Tools {selected.size === 0 ? '(host default)' : `(${selected.size})`}
      </span>
      <div className="flow-tool-grid">
        {choices.map((tool) => (
          <button
            key={tool}
            type="button"
            className={`flow-tool-chip${selected.has(tool) ? ' flow-tool-chip-on' : ''}`}
            aria-pressed={selected.has(tool)}
            onClick={() => toggle(tool)}
          >
            {tool}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The `{{…}}` values this node can use. Clicking one inserts it, which is
 * quicker and more reliable than remembering the exact upstream port name.
 */
export function ReferenceChips({
  references,
  onInsert,
}: {
  references: string[];
  onInsert: (token: string) => void;
}) {
  if (references.length === 0) return null;

  return (
    <div className="flow-node-field">
      <span className="flow-node-field-label">Available inputs</span>
      <div className="flow-ref-row">
        {references.map((reference) => (
          <button
            key={reference}
            type="button"
            className="flow-ref-chip"
            title={`Insert {{${reference}}}`}
            onClick={() => onInsert(`{{${reference}}}`)}
          >
            {reference}
          </button>
        ))}
      </div>
    </div>
  );
}
