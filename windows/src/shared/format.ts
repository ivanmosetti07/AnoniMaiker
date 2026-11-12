// MARK: - Date e importi come li mostra l'app
//
// Gli stessi formati del Mac (`Format` in CRMComponents.swift), in italiano. Solo JavaScript: lo usano sia il modello
// (nel preload) sia l'interfaccia.

const dateFormatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const amountFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });

export const Format = {
  locale: "it-IT",

  /// «15 ott 2026».
  date(date: Date): string {
    return dateFormatter.format(date);
  },

  /// «15 ott 2026, 14:05».
  dateTime(date: Date): string {
    return dateTimeFormatter.format(date);
  },

  /// «12.500,00 €» (come `ClientDossier.amount`, con spazi normali); «—» se manca.
  amount(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return amountFormatter.format(value).replaceAll(" ", " ").replaceAll(" ", " ");
  },
};
