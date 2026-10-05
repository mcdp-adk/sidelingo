// PROTOTYPE (branch prototype/winui-look): throwaway, never merge into main.
import { useSyncExternalStore } from "react";

/** Only what the look module hasn't settled; the choice lives in the URL's search params, so a reload keeps it. */
export const AXES = {
  links: ["open directly", "fluent dialog"],
  sample: ["off", "markdown", "states"],
} as const;

export type Axis = keyof typeof AXES;
export type Prototype = Record<Axis, number>;

const START: Prototype = { links: 0, sample: 1 };

const listeners = new Set<() => void>();
let snapshot = read();

function read(): Prototype {
  const params = new URLSearchParams(location.search);
  const entries = (Object.keys(AXES) as Axis[]).map((axis) => {
    const value = Number(params.get(axis) ?? START[axis]);
    return [axis, Number.isInteger(value) && value >= 0 && value < AXES[axis].length ? value : START[axis]];
  });
  return Object.fromEntries(entries) as Prototype;
}

export function cycle(axis: Axis, step: number) {
  const params = new URLSearchParams(location.search);
  params.set(axis, String((snapshot[axis] + step + AXES[axis].length) % AXES[axis].length));
  history.replaceState(null, "", `${location.pathname}?${params}`);
  snapshot = read();
  listeners.forEach((listener) => listener());
}

export function usePrototype(): Prototype {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
