import { useCallback, useEffect, useState } from "react";

type Pr = { number: number; title: string; url: string; daysSinceUpdate: number };
type Repo = {
  name: string; url: string; isPrivate: boolean; daysSincePush: number;
  doing: string | null; state: string | null; nextStep: string | null; blockedBy: string | null; epitaph: string | null;
  hasNow: boolean; openPrs: number; prs: Pr[]; resumePrompt: string; retirePrompt: string;
};
type Lane = { id: string; title: string; repos: Repo[] };
type Board = { generatedAt: string; lanes: Lane[] };

const COLLAPSED = new Set(["dusty", "graveyard"]);
const ERRORS: Record<string, string> = {
  not_configured: "Repo Board mangler sin GITHUB_TOKEN.",
  binding_missing: "Nexus er ikke koblet til repo-board endnu (deploy repo-board først, derefter Nexus).",
  contract_mismatch: "repo-board og Nexus er ude af takt. Deploy begge.",
  upstream_unavailable: "Kunne ikke hente tavlen fra repo-board.",
};

// Farve pr. kategori: rød = skal afgøres, gul = venter, blå = i gang, grå = hvilende
function laneTone(lane: Lane): "bad" | "warn" | "info" | "quiet" {
  const key = `${lane.id} ${lane.title}`.toLowerCase();
  if (key.includes("decide")) return "bad";
  if (key.includes("review") || key.includes("wait")) return "warn";
  if (key.includes("progress")) return "info";
  return "quiet";
}

function CopyButton({ text, label, ghost }: { text: string; label: string; ghost?: boolean }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className={ghost ? "ui-btn ui-btn--ghost" : "ui-btn ui-btn--primary"} onClick={() => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }}>{copied ? "Kopieret" : label}</button>;
}

function RepoCard({ repo }: { repo: Repo }) {
  const fields: [string, string | null][] = [["Doing", repo.doing], ["State", repo.state], ["Next step", repo.nextStep], ["Blocked by", repo.blockedBy]];
  return <article className="ui-card" style={{ opacity: 1 - Math.min(repo.daysSincePush / 60, 1) * 0.4 }}>
    <a className="ui-card-title" href={repo.url} target="_blank" rel="noreferrer">{repo.name}</a>
    {repo.isPrivate && <span className="ui-pill">privat</span>}
    {repo.epitaph && <div className="rb-field">{repo.epitaph}</div>}
    {!repo.epitaph && (repo.hasNow
      ? fields.filter(([, value]) => value).map(([label, value]) => <div className="rb-field" key={label}><b>{label}</b> {value}</div>)
      : <div className="rb-field">Ingen NOW.md endnu</div>)}
    {repo.prs.map((pr) => <a className="rb-pr ui-link" key={pr.number} href={pr.url} target="_blank" rel="noreferrer">PR #{pr.number}: {pr.title} <span className="ui-muted">· {pr.daysSinceUpdate} d</span></a>)}
    {repo.openPrs > 0 && <span className="ui-pill ui-pill--warn">{repo.openPrs} åbne PR: afgør før du lukker repoet</span>}
    <div className="ui-card-footer"><span className="ui-muted">{repo.daysSincePush === 0 ? "i dag" : `${repo.daysSincePush} d siden`}</span>
      <span className="rb-btns"><CopyButton ghost label="Retire" text={repo.retirePrompt} /><CopyButton label="Kopiér prompt" text={repo.resumePrompt} /></span></div>
  </article>;
}

export default function RepoBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void fetch("/api/repo-board/board", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (response.ok) return setBoard(await response.json() as Board);
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(ERRORS[body.error ?? ""] ?? "Kunne ikke hente tavlen.");
      })
      .catch(() => setError("Kunne ikke hente tavlen."));
  }, []);
  useEffect(load, [load]);

  return <section className="rb">
    <div className="rb-bar"><button type="button" className="ui-btn" onClick={load}>Opdatér</button>
      {board && <span className="ui-muted"> Hentet {new Date(board.generatedAt).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</span>}</div>
    {error && <p className="rb-warn">{error}</p>}
    {!board && !error && <p className="ui-muted">Henter tavlen…</p>}
    {board && <div className="rb-lanes">{board.lanes.map((lane) =>
      <details className="rb-lane ui-section" data-tone={laneTone(lane)} key={lane.id} open={!COLLAPSED.has(lane.id)}>
        <summary>{lane.title} <span className="ui-count">{lane.repos.length}</span></summary>
        <div className="rb-cards">{lane.repos.length ? lane.repos.map((repo) => <RepoCard repo={repo} key={repo.name} />) : <p className="ui-muted">Intet her</p>}</div>
      </details>)}</div>}
  </section>;
}
