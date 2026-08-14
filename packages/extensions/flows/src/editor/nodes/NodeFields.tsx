import { useRef, useState } from 'react';
import type { CatalogEntry } from '../../host/catalog';
import { activeRefQuery, applyRef, suggestRefs } from '../refComplete';
import { filterEntries } from './entryFilter';

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
        <SearchablePicker label={label} value={value} entries={entries} onChange={onChange} />
      )}

      {selected?.description && <span className="flow-node-hint">{selected.description}</span>}
      {selected?.argumentHint && (
        <span className="flow-node-hint">takes: {selected.argumentHint}</span>
      )}
    </label>
  );
}

/** How many matches to show before asking the user to keep typing. */
const VISIBLE_MATCHES = 8;

/**
 * Type-to-search over the catalog.
 *
 * A workspace with plugins installed offers well over a hundred skills, and a
 * native `<select>` of that length is a scroll rather than a choice. Typing
 * narrows by name *and* description, so a half-remembered skill is still
 * findable.
 */
function SearchablePicker({
  label,
  value,
  entries,
  onChange,
}: {
  label: string;
  value: string;
  entries: CatalogEntry[];
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = entries.find((entry) => entry.value === value);
  const matches = filterEntries(entries, query);

  if (value && !open) {
    return (
      <div className="flow-picker-chosen">
        <span className="flow-picker-value" title={selected?.name ?? value}>
          {selected?.name ?? value}
        </span>
        <button
          type="button"
          className="flow-node-field-toggle"
          aria-label={`Change ${label}`}
          onClick={() => {
            setQuery('');
            setOpen(true);
          }}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="flow-picker">
      <input
        className="flow-node-input"
        aria-label={label}
        value={query}
        autoFocus={open}
        placeholder={`Search ${entries.length} available…`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="flow-picker-list">
        {matches.slice(0, VISIBLE_MATCHES).map((entry) => (
          <li key={entry.value}>
            <button
              type="button"
              className="flow-picker-option"
              onClick={() => {
                onChange(entry.value);
                setOpen(false);
              }}
            >
              <span className="flow-picker-option-name">{entry.name}</span>
              {entry.source && <span className="flow-picker-option-source">{entry.source}</span>}
              {entry.description && (
                <span className="flow-picker-option-desc">{entry.description}</span>
              )}
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="flow-node-hint">No match. Use “custom” to type a name.</li>}
        {matches.length > VISIBLE_MATCHES && (
          <li className="flow-node-hint">+{matches.length - VISIBLE_MATCHES} more — keep typing</li>
        )}
      </ul>
    </div>
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

/** How many completions to show before the list becomes a scroll. */
const MAX_COMPLETIONS = 8;

/**
 * A text field that completes `{{…}}` references as they are typed.
 *
 * Typing `{{` opens a list of the inputs this node may legally use, narrowed by
 * what follows; ↑/↓ move, Enter/Tab accept, Esc dismisses. The always-visible
 * chips remain for browsing — this is the path for an author who knows the name
 * and does not want to leave the keyboard. All caret arithmetic lives in the
 * pure `refComplete` helpers; this component only wires it to the DOM.
 */
export function RefField({
  label,
  value,
  references,
  placeholder,
  hint,
  multiline,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  references: string[];
  placeholder: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);

  const active = caret === null ? null : activeRefQuery(value, caret);
  const matches = active ? suggestRefs(references, active.query).slice(0, MAX_COMPLETIONS) : [];
  const open = matches.length > 0;
  const chosen = Math.min(highlight, matches.length - 1);

  const insert = (reference: string) => {
    const next = applyRef(value, caret ?? value.length, reference);
    onChange(next.value);
    setCaret(next.caret);
    // The value change re-renders the field; put focus and caret back where the
    // completion left them so typing continues without a click.
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const syncCaret = () => setCaret(field.current?.selectionStart ?? null);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insert(matches[chosen]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setCaret(null);
    }
  };

  const shared = {
    ref: field,
    className: 'flow-node-input',
    'aria-label': label,
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      onChange(event.target.value);
      setCaret(event.target.selectionStart);
      setHighlight(0);
    },
    onKeyUp: syncCaret,
    onClick: syncCaret,
    onKeyDown,
    onBlur: () => setCaret(null),
  };

  return (
    <label className="flow-node-field">
      <span className="flow-node-field-label">
        {label}
        {hint && <span className="flow-node-hint-inline">{hint}</span>}
      </span>
      <div className="flow-ref-field-anchor">
        {multiline ? <textarea rows={rows ?? 3} {...shared} /> : <input {...shared} />}
        {open && (
          <ul className="flow-picker-list flow-ref-complete" data-testid="flow-ref-complete">
            {matches.map((reference, index) => (
              <li key={reference}>
                <button
                  type="button"
                  className={`flow-picker-option${index === chosen ? ' flow-ref-complete-active' : ''}`}
                  // Mouse-down, not click: click would land after the field's
                  // blur has already closed the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insert(reference);
                  }}
                >
                  {reference}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
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
