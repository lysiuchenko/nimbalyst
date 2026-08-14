import { useState } from 'react';
import {
  type EdgeCondition,
  formatEdgeCondition,
  tryParseEdgeCondition,
} from '../runner/edgeCondition';
import { conditionReferences } from './edgeConditionForm';

/** The three comparisons the `when:` grammar allows, worded for the panel. */
const OPERATORS: { value: EdgeCondition['op']; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: '==', label: 'equals' },
  { value: '!=', label: 'is not' },
];

/**
 * Builds an edge's `when:` condition from parts, so an author never types the
 * grammar by hand. Off by default — a plain wire always runs; ticking the box
 * gates it on a comparison of the `from` node's output. Every change emits the
 * formatted string (or `undefined` when the gate is off) through `onChange`,
 * which the panel writes back to the edge. All parsing/formatting lives in the
 * `edgeCondition` helpers; this component only wires them to inputs.
 */
export function EdgeConditionEditor({
  from,
  port,
  when,
  onChange,
}: {
  from: string;
  port?: string;
  when?: string;
  onChange: (when: string | undefined) => void;
}) {
  const parsed = when ? tryParseEdgeCondition(when) : null;
  // A wire's port is dropped from its label once a condition owns it, so an
  // existing condition may name a reference `conditionReferences` no longer
  // lists — keep it selectable rather than silently blanking the dropdown.
  const base = conditionReferences(from, port);
  const references = parsed && !base.includes(parsed.reference) ? [...base, parsed.reference] : base;

  const [enabled, setEnabled] = useState(when !== undefined);
  const [reference, setReference] = useState(parsed?.reference ?? references[0]);
  const [op, setOp] = useState<EdgeCondition['op']>(parsed?.op ?? 'contains');
  const [literal, setLiteral] = useState(parsed?.literal ?? '');

  // Emit from the next state plus whatever the other fields currently hold, so a
  // single keystroke doesn't lag a render behind the string it writes.
  const emit = (patch: {
    enabled?: boolean;
    reference?: string;
    op?: EdgeCondition['op'];
    literal?: string;
  }) => {
    const on = patch.enabled ?? enabled;
    if (!on) {
      onChange(undefined);
      return;
    }
    onChange(
      formatEdgeCondition({
        reference: patch.reference ?? reference,
        op: patch.op ?? op,
        literal: patch.literal ?? literal,
      })
    );
  };

  return (
    <div className="flow-edge-condition" data-testid="flow-edge-condition">
      <label className="flow-edge-condition-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            emit({ enabled: event.target.checked });
          }}
        />
        Only take this wire when
      </label>
      {enabled && (
        <div className="flow-edge-condition-row">
          <select
            className="flow-node-input"
            aria-label="Condition reference"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              emit({ reference: event.target.value });
            }}
          >
            {references.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            className="flow-node-input"
            aria-label="Condition operator"
            value={op}
            onChange={(event) => {
              const next = event.target.value as EdgeCondition['op'];
              setOp(next);
              emit({ op: next });
            }}
          >
            {OPERATORS.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
          <input
            className="flow-node-input"
            aria-label="Condition value"
            value={literal}
            placeholder="text to match"
            onChange={(event) => {
              setLiteral(event.target.value);
              emit({ literal: event.target.value });
            }}
          />
        </div>
      )}
    </div>
  );
}
