import { useMemo } from "react";
import type { ReactNode } from "react";

function inlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
    return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
  });
}

export default function MiyagiMarkdown({ text }: { text: string }) {
  const lines = useMemo(() => text.replace(/\\---/g, "---").split("\n").map((line) => line.trimEnd()), [text]);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  function flushLists() {
    if (bullets.length) {
      blocks.push(<ul key={`ul-${blocks.length}`}>{bullets.map((item, index) => <li key={`${index}-${item.slice(0, 16)}`}>{inlineMarkdown(item)}</li>)}</ul>);
      bullets = [];
    }
    if (numbers.length) {
      blocks.push(<ol key={`ol-${blocks.length}`}>{numbers.map((item, index) => <li key={`${index}-${item.slice(0, 16)}`}>{inlineMarkdown(item)}</li>)}</ol>);
      numbers = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushLists();
      continue;
    }
    if (line === "---") {
      flushLists();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }
    if (line.startsWith("## ")) {
      flushLists();
      blocks.push(<h3 key={`h3-${blocks.length}`}>{inlineMarkdown(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("### ")) {
      flushLists();
      blocks.push(<h4 key={`h4-${blocks.length}`}>{inlineMarkdown(line.slice(4))}</h4>);
      continue;
    }
    if (/^[-*] /.test(line)) {
      if (numbers.length) flushLists();
      bullets.push(line.slice(2));
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (bullets.length) flushLists();
      numbers.push(numbered[1]);
      continue;
    }
    flushLists();
    blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(line)}</p>);
  }
  flushLists();

  return <div className="miyagi-analysis-text">{blocks}</div>;
}
