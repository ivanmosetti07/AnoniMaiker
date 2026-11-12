/** L'anonimizzazione non è riuscita: niente va avanti. */
export class EngineError extends Error {
  readonly kind: "notInstalled" | "failed";
  readonly reason: string | null;

  private constructor(kind: "notInstalled" | "failed", reason: string | null) {
    super(kind === "notInstalled"
      ? "Il motore di anonimizzazione non è nell'app: esegui Scripts/prepara-motore.sh e ricompila."
      : `L'anonimizzazione non è riuscita (${reason}).`);
    this.name = "EngineError";
    this.kind = kind;
    this.reason = reason;
  }

  static get notInstalled(): EngineError {
    return new EngineError("notInstalled", null);
  }

  static failed(reason: string): EngineError {
    return new EngineError("failed", reason);
  }

  /** Come l'Equatable di Swift. */
  equals(other: unknown): boolean {
    return other instanceof EngineError && other.kind === this.kind && other.reason === this.reason;
  }
}
