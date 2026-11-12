import { Button, Sheet } from "../ui/components";
import { useObserved } from "../ui/observe";
import { UpdateLinks } from "../helpers";
import simbolo from "../assets/simbolo.svg";

// MARK: - Informazioni su AnoniMaiker (AboutPanel in AnonimizzatoreApp.swift)
//
// Versione, MaikerHub e collegamento al progetto.

const { model, platform } = window.anonimaiker;

export function AboutSheet({ onClose }: { onClose: () => void }) {
  useObserved(model);
  return (
    <Sheet onClose={onClose} width={380} actions={<Button kind="primary" onClick={onClose} shortcut="Enter">OK</Button>}>
      <div className="about">
        <img src={simbolo} alt="" width={72} height={72} />
        <div className="title2" style={{ marginTop: 6 }}>AnoniMaiker</div>
        <div className="caption secondary selectable">Versione {model.appVersion}</div>
        <div className="caption secondary" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Un prodotto <span style={{ color: "#FF914D", fontWeight: 600 }}>MaikerHub</span>
          <br />
          Anonimizzazione sul PC, CRM e chat con GPT.
          <br />
          Open source, licenza MIT.
        </div>
        <div className="caption" style={{ marginTop: 10 }}>
          <Button kind="link" onClick={() => void platform.openExternal(UpdateLinks.projectPage)}>Pagina del progetto</Button>
        </div>
      </div>
    </Sheet>
  );
}
