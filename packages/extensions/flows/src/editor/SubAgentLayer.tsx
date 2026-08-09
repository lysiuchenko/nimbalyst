import { useEffect, useRef } from "react";
import { useNodes, useReactFlow, ViewportPortal } from "@xyflow/react";
import type { ChildProgress } from "../runner/types";
import {
  SUBAGENT_CARD,
  boxFor,
  layoutSubAgents,
  unionOf,
} from "./subAgentLayout";

interface SubAgentLayerProps {
  /** Live sub-agents, keyed by the fan-out node that spawned them. */
  subAgents: Record<string, ChildProgress[]>;
  /** Opens a sub-agent's session; absent while the host offers no way to. */
  onOpenSession?: (sessionId: string) => void;
}

/**
 * Draws a fan-out node's sub-agents as cards on the canvas.
 *
 * They render through `ViewportPortal`, so they pan and zoom with the graph and
 * look like nodes — but they never enter the xyflow node store. That matters:
 * anything in the store is document state, so real nodes would mark the file
 * dirty and persist a run into `.flow.json`. These exist only while the run
 * does.
 */
export function SubAgentLayer({ subAgents, onOpenSession }: SubAgentLayerProps) {
  const nodes = useNodes();
  const { getNode, fitBounds } = useReactFlow();
  const spawning = Object.entries(subAgents).filter(
    ([, list]) => list.length > 0
  );

  // `fitView` ran at mount, when the sub-agents did not exist yet, so their
  // cards would otherwise open outside the visible area. Re-fit when the set of
  // sub-agents changes and again once they all settle — not on every status
  // tick, so the viewport does not fight the user mid-run. The settled re-fit
  // matters because finishing opens the run results table, which takes height
  // away from the canvas and pushes the cards back out of view.
  const shape = spawning
    .map(
      ([id, list]) =>
        `${id}:${list.length}:${list.every(isSettled) ? "settled" : "live"}`
    )
    .join("|");
  const fitted = useRef("");
  useEffect(() => {
    if (!shape || fitted.current === shape) return;
    fitted.current = shape;

    const boxes = spawning.flatMap(([parentId, list]) => {
      const parent = getNode(parentId);
      if (!parent) return [];
      const parentBox = boxFor(parent);
      return [
        parentBox,
        ...layoutSubAgents(parentBox, list.length).map((card) => ({
          x: card.x,
          y: card.y,
          width: SUBAGENT_CARD.width,
          height: SUBAGENT_CARD.height,
        })),
      ];
    });

    const bounds = unionOf(boxes);
    if (!bounds) return;

    // A frame late on purpose: the run panel that just opened or closed has to
    // finish resizing the canvas before the fit is measured against it.
    const frame = requestAnimationFrame(() => fitBounds(bounds, { padding: 0.12, duration: 400 }));
    return () => cancelAnimationFrame(frame);
    // `spawning` is derived from `shape`; re-running on its identity would
    // re-fit on every status tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, getNode, fitBounds]);

  if (spawning.length === 0) return null;

  return (
    <ViewportPortal>
      {spawning.map(([parentId, list]) => {
        const parent = nodes.find((node) => node.id === parentId);
        if (!parent) return null;

        const cards = layoutSubAgents(boxFor(parent), list.length);

        return (
          <div
            key={parentId}
            className="flow-subagents"
            data-subagents-of={parentId}
          >
            {cards.map((card, index) => {
              const child = list[index];
              return (
                <div key={child.label}>
                  <svg
                    className="flow-subagent-link"
                    style={{
                      left: card.from.x,
                      top: Math.min(card.from.y, card.to.y),
                      width: Math.max(card.to.x - card.from.x, 1),
                      height: Math.max(Math.abs(card.to.y - card.from.y), 1),
                    }}
                    data-child-status={child.status}
                  >
                    <path
                      d={connector(card.from, card.to)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {/* A sub-agent's session is where its work actually is, so the
                      card opens it once one exists. */}
                  <div
                    className={`flow-subagent flow-subagent-${child.status}${
                      child.sessionId ? ' flow-subagent-openable' : ''
                    }`}
                    style={{
                      left: card.x,
                      top: card.y,
                      width: SUBAGENT_CARD.width,
                      height: SUBAGENT_CARD.height,
                    }}
                    data-child-status={child.status}
                    data-subagent-of={parentId}
                    {...(child.sessionId ? { 'data-subagent-session': child.sessionId } : {})}
                    role={child.sessionId ? 'button' : undefined}
                    tabIndex={child.sessionId ? 0 : undefined}
                    title={
                      child.error ??
                      (child.sessionId ? `${child.label} — open its session` : child.label)
                    }
                    onClick={
                      child.sessionId ? () => onOpenSession?.(child.sessionId!) : undefined
                    }
                    onKeyDown={
                      child.sessionId
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onOpenSession?.(child.sessionId!);
                            }
                          }
                        : undefined
                    }
                  >
                    <span className="flow-subagent-dot" />
                    <span className="flow-subagent-label">{child.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </ViewportPortal>
  );
}

function isSettled(child: ChildProgress): boolean {
  return child.status === "done" || child.status === "failed";
}

/**
 * A bezier from the parent's edge to a card, drawn in the SVG's own box.
 * The box is placed at the connector's top-left, so both ends are relative.
 */
function connector(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const width = to.x - from.x;
  const top = Math.min(from.y, to.y);
  const startY = from.y - top;
  const endY = to.y - top;
  const bend = Math.max(width / 2, 20);
  return `M 0 ${startY} C ${bend} ${startY}, ${
    width - bend
  } ${endY}, ${width} ${endY}`;
}
