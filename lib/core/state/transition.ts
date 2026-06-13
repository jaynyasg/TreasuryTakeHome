/**
 * Tiny generic state-machine helper, shared by the batch and case lifecycles.
 * Worker-safe: pure functions, no I/O, no framework imports.
 *
 * A TransitionMap lists, for every state, the states reachable from it in a
 * single step. Terminal states map to an empty array.
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/** True when `from -> to` is a permitted single-step transition. */
export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S
): boolean {
  const allowed = map[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Throws a clear Error when `from -> to` is not permitted; otherwise returns.
 * `label` names the machine (e.g. "batch", "case") for the message.
 */
export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
  label: string
): void {
  if (!canTransition(map, from, to)) {
    throw new Error(`Invalid ${label} transition: ${from} -> ${to}`);
  }
}

/** The states reachable from `from` in a single step (empty when terminal). */
export function nextStates<S extends string>(
  map: TransitionMap<S>,
  from: S
): readonly S[] {
  return map[from] ?? [];
}
