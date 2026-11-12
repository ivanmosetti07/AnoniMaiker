import type { AppRelease } from "../core/aggiornamenti";
import { Observable } from "../shared/observable";
import { observed } from "./observed";
import type { Preferences } from "./preferences";

// MARK: - Lo stato degli aggiornamenti
//
// All'avvio (e poi una volta al giorno) l'app chiede a GitHub l'ultima release di Windows. Se è più nuova mostra le
// novità; con un clic scarica l'installatore, ne controlla la firma e lo avvia: l'app si chiude e si riapre aggiornata.

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; release: AppRelease }
  | { kind: "downloading"; release: AppRelease; progress: number }
  /// Il passaggio in corso: «Controllo la firma…», «Chiudo e riapro…».
  | { kind: "installing"; release: AppRelease; step: string }
  | { kind: "failed"; message: string; release: AppRelease | null };

export class UpdateState extends Observable {
  static readonly automaticKey = "aggiornamenti.automatici";
  static readonly lastCheckKey = "aggiornamenti.ultimoControllo";
  static readonly skippedKey = "aggiornamenti.saltata";

  declare phase: UpdatePhase;
  declare isPresented: boolean;
  /// Il download in corso (per annullarlo).
  task: AbortController | null = null;
  #automatic: boolean;
  #lastCheck: Date | null;

  constructor(private readonly preferences: Preferences) {
    super();
    observed<UpdateState, "phase" | "isPresented">(this, { phase: { kind: "idle" }, isPresented: false });
    this.#automatic = preferences.bool(UpdateState.automaticKey) ?? true;
    this.#lastCheck = preferences.date(UpdateState.lastCheckKey);
  }

  get automatic(): boolean {
    return this.#automatic;
  }

  set automatic(value: boolean) {
    this.#automatic = value;
    this.preferences.set(UpdateState.automaticKey, value);
    this.changed();
  }

  get lastCheck(): Date | null {
    return this.#lastCheck;
  }

  set lastCheck(value: Date | null) {
    this.#lastCheck = value;
    this.preferences.set(UpdateState.lastCheckKey, value);
    this.changed();
  }

  get skippedVersion(): string | null {
    return this.preferences.string(UpdateState.skippedKey);
  }

  set skippedVersion(value: string | null) {
    this.preferences.set(UpdateState.skippedKey, value);
    this.changed();
  }

  get isBusy(): boolean {
    return this.phase.kind === "checking" || this.phase.kind === "downloading" || this.phase.kind === "installing";
  }
}
