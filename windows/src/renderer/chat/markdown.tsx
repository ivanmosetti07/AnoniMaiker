import type { ReactNode } from "react";

// MARK: - Le risposte di GPT in Markdown
//
// Sul Mac `ChatText.markdown` usa `AttributedString(markdown:)`: grassetto, corsivo, codice, collegamenti, con gli a capo.
// Qui un lettore piccolo che fa lo stesso e in più i blocchi più comuni (paragrafi, titoli, elenchi, citazioni, codice).
// Niente HTML: ogni testo passa da React, che lo rende innocuo. I collegamenti si aprono nel browser.

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[][] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" };

const fence = /^\s{0,3}(```|~~~)/;
const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const bullet = /^(\s*)([-*+])\s+(.*)$/;
const numbered = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const quote = /^\s{0,3}>\s?(.*)$/;
const rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().length === 0) {
      index++;
      continue;
    }
    const opening = line.match(fence);
    if (opening) {
      const marker = opening[1];
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) body.push(lines[index++]);
      index++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const title = line.match(heading);
    if (title) {
      blocks.push({ kind: "heading", level: title[1].length, text: title[2] });
      index++;
      continue;
    }
    if (rule.test(line)) {
      blocks.push({ kind: "rule" });
      index++;
      continue;
    }
    if (quote.test(line)) {
      const body: string[] = [];
      while (index < lines.length && quote.test(lines[index])) body.push(lines[index++].match(quote)![1]);
      blocks.push({ kind: "quote", lines: body });
      continue;
    }
    const item = line.match(bullet) ?? line.match(numbered);
    if (item) {
      const ordered = !line.match(bullet);
      const pattern = ordered ? numbered : bullet;
      const items: string[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = current.match(pattern);
        if (match) {
          items.push([match[3]]);
        } else if (current.trim().length > 0 && /^\s+/.test(current) && items.length > 0) {
          // Il seguito di una voce (rientrato).
          items[items.length - 1].push(current.trim());
        } else {
          break;
        }
        index++;
      }
      blocks.push({ kind: "list", ordered, start: ordered ? Number(item[2]) : 1, items });
      continue;
    }
    const body: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim().length === 0 || fence.test(current) || heading.test(current) || quote.test(current)
        || bullet.test(current) || numbered.test(current) || rule.test(current)) break;
      body.push(current);
      index++;
    }
    blocks.push({ kind: "paragraph", lines: body });
  }
  return blocks;
}

/// Solo indirizzi del web e della posta: niente `javascript:` né file.
function safeURL(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        void window.anonimaiker.platform.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

// Le regole in linea, in ordine di precedenza.
const inlinePattern = new RegExp(
  [
    String.raw`(\x60+)([\s\S]+?)\1`, // `codice`
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)`, // [testo](indirizzo)
    String.raw`<((?:https?:\/\/|mailto:)[^>\s]+)>`, // <https://…>
    String.raw`\*\*([\s\S]+?)\*\*`, // **grassetto**
    String.raw`(?<![\p{L}\p{N}])__([\s\S]+?)__(?![\p{L}\p{N}])`, // __grassetto__
    String.raw`~~([\s\S]+?)~~`, // ~~barrato~~
    String.raw`\*(?!\s)([^*\n]+?)\*`, // *corsivo*
    String.raw`(?<![\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}_])`, // _corsivo_
    String.raw`(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"»])`, // indirizzi scritti così come sono
    String.raw`\\([\\\x60*_{}\[\]()#+\-.!~>])`, // \* e simili
  ].join("|"),
  "gu",
);

/// Il testo di una riga con grassetto, corsivo, codice e collegamenti.
export function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  let count = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const key = `${keyPrefix}-${count++}`;
    const [whole, , code, label, url, auto, bold1, bold2, strike, italic1, italic2, bare, escaped] = match;
    if (code !== undefined) {
      parts.push(<code key={key}>{code.trim() || code}</code>);
    } else if (label !== undefined && url !== undefined) {
      const safe = safeURL(url);
      parts.push(safe ? <Link key={key} href={safe}>{inline(label, key)}</Link> : <span key={key}>{inline(label, key)}</span>);
    } else if (auto !== undefined) {
      parts.push(<Link key={key} href={auto}>{auto}</Link>);
    } else if (bold1 !== undefined || bold2 !== undefined) {
      parts.push(<strong key={key}>{inline(bold1 ?? bold2 ?? "", key)}</strong>);
    } else if (strike !== undefined) {
      parts.push(<s key={key}>{inline(strike, key)}</s>);
    } else if (italic1 !== undefined || italic2 !== undefined) {
      parts.push(<em key={key}>{inline(italic1 ?? italic2 ?? "", key)}</em>);
    } else if (bare !== undefined) {
      parts.push(<Link key={key} href={bare}>{bare}</Link>);
    } else if (escaped !== undefined) {
      parts.push(escaped);
    } else {
      parts.push(whole);
    }
    at = index + whole.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/// Le righe di un paragrafo, con gli a capo come sono (come `.inlineOnlyPreservingWhitespace` sul Mac).
function lines(items: string[], key: string): ReactNode[] {
  return items.flatMap((line, index) => {
    const content = inline(line.replace(/ {2,}$/, ""), `${key}-${index}`);
    return index === 0 ? content : [<br key={`${key}-br-${index}`} />, ...content];
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "paragraph":
            return <p key={key}>{lines(block.lines, key)}</p>;
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
            return <Tag key={key}>{inline(block.text, key)}</Tag>;
          }
          case "code":
            return <pre key={key}><code>{block.text}</code></pre>;
          case "quote":
            return <blockquote key={key}>{lines(block.lines, key)}</blockquote>;
          case "rule":
            return <hr key={key} />;
          case "list": {
            const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{lines(item, `${key}-${itemIndex}`)}</li>);
            return block.ordered
              ? <ol key={key} start={block.start}>{items}</ol>
              : <ul key={key}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}
