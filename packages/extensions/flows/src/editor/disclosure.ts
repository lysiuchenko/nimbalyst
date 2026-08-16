import { createContext, useContext } from 'react';

/**
 * A one-shot open/close command broadcast from the toolbar or a keyboard
 * shortcut to every node card at once — collapse-all, expand-all, Esc, Enter.
 *
 * Each card owns its own open state; this is how an outside gesture reaches all
 * of them without writing anything into the xyflow store, which would look like
 * a document edit and dirty the `.flow.json`.
 *
 * `epoch` makes each command distinct so a card applies it exactly once — even
 * when the same `open` value is sent twice in a row (collapse-all, then Esc).
 * `target`, when present, narrows the command to those node ids (a keyboard
 * shortcut acting on the current selection); absent, it reaches every card.
 */
export interface Disclosure {
  epoch: number;
  open: boolean;
  target?: readonly string[];
}

export const DisclosureContext = createContext<Disclosure>({ epoch: 0, open: false });

export function useDisclosure(): Disclosure {
  return useContext(DisclosureContext);
}

/**
 * The next command in the sequence. The epoch always advances so a repeated
 * `open` value still counts as a fresh command the cards must react to.
 */
export function nextDisclosure(
  current: Disclosure,
  open: boolean,
  target?: readonly string[]
): Disclosure {
  return { epoch: current.epoch + 1, open, target };
}

/**
 * What a card holding `appliedEpoch` should do with the current `disclosure`:
 * `null` to leave its open state alone, or the boolean to set it to. A command
 * applies once — only when its epoch is new — and only to a card in its target
 * (or every card, when the command is untargeted).
 */
export function shouldApplyDisclosure(
  disclosure: Disclosure,
  appliedEpoch: number,
  id: string
): boolean | null {
  if (disclosure.epoch === appliedEpoch) return null;
  if (disclosure.target && !disclosure.target.includes(id)) return null;
  return disclosure.open;
}
