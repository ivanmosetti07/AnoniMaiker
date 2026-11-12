import { useSyncExternalStore } from "react";
import type { Observable } from "../../shared/observable";

/// Ridisegna il componente quando cambia l'oggetto osservato (il modello dell'app, un banco di lavoro, la chat…).
export function useObserved<T extends Observable>(object: T): T {
  useSyncExternalStore(object.subscribe, object.getVersion);
  return object;
}
