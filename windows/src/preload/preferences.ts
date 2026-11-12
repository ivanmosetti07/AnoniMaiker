// MARK: - Le preferenze (come UserDefaults sul Mac)
//
// Un file JSON che tiene il processo principale (`preferenze.json` accanto ai dati di Electron). Le chiavi sono quelle
// del Mac. Le date si salvano come testo ISO 8601.

/// Quello che serve della piattaforma per leggere e scrivere le preferenze.
export interface PreferencesBackend {
  readPreferences(): Record<string, unknown>;
  writePreferences(prefs: Record<string, unknown>): boolean;
}

export class Preferences {
  private values: Record<string, unknown>;

  constructor(private readonly backend: PreferencesBackend) {
    let values: Record<string, unknown> = {};
    try {
      const read = backend.readPreferences();
      if (read && typeof read === "object") values = { ...read };
    } catch {
      // Preferenze illeggibili: si riparte da quelle di serie.
    }
    this.values = values;
  }

  object(key: string): unknown {
    return this.values[key];
  }

  string(key: string): string | null {
    const value = this.values[key];
    return typeof value === "string" ? value : null;
  }

  bool(key: string): boolean | null {
    const value = this.values[key];
    return typeof value === "boolean" ? value : null;
  }

  date(key: string): Date | null {
    const value = this.values[key];
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /// `undefined` o `null` tolgono la chiave (come `removeObject(forKey:)`).
  set(key: string, value: unknown): void {
    if (value === undefined || value === null) {
      if (!(key in this.values)) return;
      delete this.values[key];
    } else {
      this.values[key] = value instanceof Date ? value.toISOString() : value;
    }
    try {
      this.backend.writePreferences(this.values);
    } catch {
      // Come UserDefaults: una preferenza non salvata non blocca l'app.
    }
  }
}
