import type { Observable } from "../shared/observable";

// MARK: - Campi osservati
//
// Come le proprietà di una classe @Observable: ogni assegnazione avvisa chi guarda (`notify()`). Le classi dichiarano i
// campi con `declare` (solo il tipo) e li creano qui con il valore iniziale.

export function observed<T extends Observable, K extends keyof T>(target: T, initial: Pick<T, K>): void {
  for (const key of Object.keys(initial) as K[]) {
    let value = initial[key];
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get: () => value,
      set: (next: T[K]) => {
        if (Object.is(next, value)) return;
        value = next;
        target.notify();
      },
    });
  }
}
