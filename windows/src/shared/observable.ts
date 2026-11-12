// MARK: - Stato osservabile (come @Observable in Swift)
//
// Il modello dell'app vive nel preload e l'interfaccia React lo legge direttamente. Chi cambia lo stato chiama
// `changed()`; `useObserved` nell'interfaccia ridisegna i componenti che lo guardano. I cambi ravvicinati si raccolgono
// in un solo ridisegno.

export class Observable {
  #listeners = new Set<() => void>();
  #version = 0;
  #scheduled = false;

  /// Il numero di versione: cambia a ogni modifica (per `useSyncExternalStore`).
  get version(): number {
    return this.#version;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getVersion = (): number => this.#version;

  /// Da chiamare dopo ogni modifica dello stato.
  protected changed(): void {
    this.#version++;
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      for (const listener of [...this.#listeners]) listener();
    });
  }

  /// Per chi modifica dall'esterno (un componente che scrive un campo pubblico).
  notify(): void {
    this.changed();
  }
}
