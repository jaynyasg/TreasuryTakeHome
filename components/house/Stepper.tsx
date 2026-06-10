import { Fragment, type ReactNode } from "react";

// Horizontal progress stepper — the full choreography from the source UI:
//  - node states: pending (hairline, muted) → active (scales up, accent ring,
//    an orbiting spinner) → done (filled accent, a checkmark that draws itself in)
//  - connectors: a rail that fills left→right when the step completes, with a
//    bright dot that "travels" across while the next step is in flight
//  - the whole bar floats on a blurred translucent card and rises in on mount
// Drive it with `current` (index of the in-flight step). Steps already passed
// render as done; the rest as pending. Purely presentational.
export interface Step {
  label: string;
  icon: ReactNode;
}

type NodeState = "pending" | "active" | "done";

function nodeState(index: number, current: number): NodeState {
  if (index < current) return "done";
  if (index === current) return "active";
  return "pending";
}

export default function Stepper({
  steps,
  current,
  className = "",
}: {
  steps: Step[];
  current: number;
  className?: string;
}) {
  return (
    <div
      className={
        "flex animate-riseIn items-center justify-center gap-2 rounded-card border border-line " +
        "bg-card/70 px-4 py-2 shadow-card backdrop-blur-md " +
        className
      }
    >
      {steps.map((step, i) => (
        <Fragment key={step.label}>
          {i > 0 && <Connector state={connectorState(nodeState(i, current))} />}
          <StepNode icon={step.icon} label={step.label} state={nodeState(i, current)} />
        </Fragment>
      ))}
    </div>
  );
}

// The connector before a node mirrors that node's progress: idle while the node
// waits, traveling while it's active, fully filled once it's done.
function connectorState(next: NodeState): "idle" | "active" | "done" {
  return next === "pending" ? "idle" : next;
}

function StepNode({ icon, label, state }: { icon: ReactNode; label: string; state: NodeState }) {
  const ring =
    state === "done"
      ? "border-accent bg-accent text-white"
      : state === "active"
        ? "scale-110 border-accent bg-accent/5 text-accent"
        : "border-line bg-card text-muted-2";
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "relative grid h-6 w-6 place-items-center rounded-full border transition-all duration-300 ease-out " +
          ring
        }
      >
        {state === "active" && (
          <svg
            className="absolute -inset-1 animate-spin [animation-duration:1.3s]"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden
          >
            <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2.5" className="text-accent/15" />
            <circle
              cx="20"
              cy="20"
              r="18"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="26 95"
              className="text-accent"
            />
          </svg>
        )}
        <span className="relative">{state === "done" ? <Check /> : icon}</span>
      </span>
      <span
        className={
          "text-[12px] transition-colors " +
          (state === "active"
            ? "font-semibold text-ink"
            : state === "done"
              ? "font-medium text-ink"
              : "font-medium text-muted-2")
        }
      >
        {label}
      </span>
    </div>
  );
}

function Connector({ state }: { state: "idle" | "active" | "done" }) {
  return (
    <div className="relative mx-1 h-[3px] w-5 rounded-full bg-line sm:mx-1.5 sm:w-16">
      <div
        className={
          "absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-700 " +
          (state === "done" ? "w-full" : "w-0")
        }
      />
      {state === "active" && (
        <div className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-travel rounded-full bg-accent" />
      )}
    </div>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{ strokeDasharray: 1 }}
        className="animate-drawIn"
      />
    </svg>
  );
}
