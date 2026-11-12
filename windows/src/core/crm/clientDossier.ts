import type { CRMDatabase } from "./crmDatabase";
import { Activity, ActivityKind, Company, CompanyStatus, Contact, type Deal, DealStage, trimWhitespace } from "./crmModel";
import { DocumentFormat } from "../documenti";

// MARK: - La scheda del cliente, da anonimizzare
//
// Il CRM racconta un cliente in Markdown (anagrafica, contatti, trattative, ultime note e cose da fare, documenti):
// è il testo che si anonimizza e si dà all'AI per preparare un'offerta, una mail, un riepilogo.

const dateFormatter = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
const amountFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const farFuture = Number.POSITIVE_INFINITY;

export class ClientDossier {
  /// «30/11/2026».
  static date(date: Date): string {
    return dateFormatter.format(date);
  }

  /// «12.500,00 €», con spazi normali (il formato di sistema usa spazi non separabili).
  static amount(value: number): string {
    return amountFormatter.format(value).replaceAll(" ", " ").replaceAll(" ", " ");
  }

  /// La scheda in Markdown; null se l'azienda non c'è.
  static markdown(companyID: string, database: CRMDatabase, now: Date = new Date(), recentActivities = 10): string | null {
    const company = database.company(companyID);
    if (!company) return null;
    let lines = [`# ${company.name}`, ""];
    const headline = [CompanyStatus.title(company.status), company.sector].filter((part) => part.length > 0).join(" · ");
    if (headline) lines.push(headline, "");

    const details: string[] = [];
    const add = (title: string, raw: string) => {
      const text = trimWhitespace(raw);
      if (text) details.push(`- ${title}: ${text}`);
    };
    add("Partita IVA", company.vatNumber);
    add("Codice fiscale", company.taxCode);
    add("Sede", Company.address(company));
    add("Email", company.email);
    add("PEC", company.pec);
    add("Telefono", company.phone);
    add("Sito", company.website);
    add("IBAN", company.iban);
    if (details.length > 0) lines = [...lines, ...details, ""];
    if (company.notes) lines.push("## Note sul cliente", "", company.notes, "");

    const contacts = database.contactsOf(companyID);
    if (contacts.length > 0) {
      lines.push("## Contatti", "");
      for (const contact of contacts) {
        const parts = [Contact.fullName(contact), contact.role, contact.email, contact.phone, contact.mobile].filter((part) => part.length > 0);
        lines.push("- " + parts.join(" — "));
      }
      lines.push("");
    }

    const deals = database.dealsOf(companyID);
    const open = deals.filter((deal) => DealStage.isOpen(deal.stage));
    if (open.length > 0) {
      lines.push("## Trattative aperte", "");
      for (const deal of open) lines.push("- " + ClientDossier.dealLine(deal, database));
      lines.push("");
    }
    const closed = deals.filter((deal) => !DealStage.isOpen(deal.stage));
    if (closed.length > 0) {
      lines.push("## Trattative chiuse", "");
      for (const deal of closed.slice(0, 5)) lines.push("- " + ClientDossier.dealLine(deal, database));
      lines.push("");
    }

    const tasks = database.activitiesOf(companyID).filter((activity) => activity.kind === "task" && !activity.isDone);
    if (tasks.length > 0) {
      lines.push("## Cose da fare", "");
      const sorted = [...tasks].sort((a, b) => (a.due?.getTime() ?? farFuture) - (b.due?.getTime() ?? farFuture) || 0);
      for (const task of sorted) {
        const due = task.due
          ? ` (entro il ${ClientDossier.date(task.due)}${Activity.isOverdue(task, now) ? ", scaduta" : ""})`
          : "";
        lines.push(`- ${task.text}${due}`);
      }
      lines.push("");
    }

    const history = database
      .activitiesOf(companyID)
      .filter((activity) => activity.kind !== "task")
      .slice(0, recentActivities);
    if (history.length > 0) {
      lines.push("## Ultime note e attività", "");
      for (const activity of history) {
        const contact = database.contact(activity.contactID);
        const who = contact ? ` con ${Contact.fullName(contact)}` : "";
        lines.push(`- ${ClientDossier.date(activity.date)} · ${ActivityKind.title(activity.kind)}${who}: ${activity.text}`);
      }
      lines.push("");
    }

    const documents = database.documentsOf(companyID);
    if (documents.length > 0) {
      lines.push("## Documenti", "");
      for (const document of documents) {
        lines.push(`- ${document.title} (${DocumentFormat.title(document.format)}, ${ClientDossier.date(document.created)})`);
      }
      lines.push("");
    }
    return trimWhitespace(lines.join("\n")) + "\n";
  }

  static dealLine(deal: Deal, database: CRMDatabase): string {
    const parts = [deal.title || "Trattativa", DealStage.title(deal.stage)];
    if (deal.amount !== null) parts.push(ClientDossier.amount(deal.amount));
    if (DealStage.isOpen(deal.stage)) parts.push(`probabilità ${deal.probability}%`);
    if (deal.expectedClose) parts.push(`chiusura prevista ${ClientDossier.date(deal.expectedClose)}`);
    const contact = database.contact(deal.contactID);
    if (contact) parts.push(`referente ${Contact.fullName(contact)}`);
    return parts.join(" — ");
  }
}
