import { useEffect, useState } from "react";

type CredentialStatus = {
  configured: boolean;
  githubConfigured: boolean;
  cloudflareConfigured: boolean;
  cloudflareAccountId: string;
  updatedAt: string | null;
};

type State = "loading" | "idle" | "saving" | "error";

function messageFor(error: string): string {
  if (error === "github_validation_failed") return "GitHub-tokenet kunne ikke valideres eller mangler adgang til repos.";
  if (error === "cloudflare_validation_failed") return "Cloudflare-tokenet kunne ikke læse Workers og Pages for kontoen.";
  if (error === "invalid_cloudflare_account_id") return "Cloudflare Account ID skal være 32 hex-tegn.";
  if (error === "github_token_required") return "Indtast et GitHub-token.";
  if (error === "cloudflare_token_required") return "Indtast et Cloudflare API-token.";
  return "Projektkortets credentials kunne ikke gemmes.";
}

export default function ProjectMapSettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [cloudflareAccountId, setCloudflareAccountId] = useState("");
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/project-map/settings", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 403) { setForbidden(true); setState("idle"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as CredentialStatus;
      setStatus(next);
      setCloudflareAccountId(next.cloudflareAccountId ?? "");
      setState("idle");
    } catch {
      setState("error");
      setMessage("Status for projektkortets credentials kunne ikke hentes.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/project-map/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubToken: githubToken.trim() || undefined,
          cloudflareToken: cloudflareToken.trim() || undefined,
          cloudflareAccountId: cloudflareAccountId.trim(),
        }),
      });
      const body = await response.json() as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

      setStatus(body);
      setGithubToken("");
      setCloudflareToken("");
      setMessage("Credentials er gemt og valideret. Projektkortet opdateres nu.");
      setState("idle");

      void fetch("/api/project-map", { method: "POST", credentials: "same-origin", cache: "no-store" });
    } catch (error) {
      setState("error");
      setMessage(messageFor(error instanceof Error ? error.message : "unknown"));
    }
  }

  async function clear() {
    if (!confirm("Fjern GitHub- og Cloudflare-credentials fra Nexus? Projektkortet vil gå tilbage til seneste snapshot.")) return;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/project-map/settings", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus({
        configured: false,
        githubConfigured: false,
        cloudflareConfigured: false,
        cloudflareAccountId: "",
        updatedAt: null,
      });
      setCloudflareAccountId("");
      setGithubToken("");
      setCloudflareToken("");
      setMessage("Credentials er fjernet.");
      setState("idle");
    } catch {
      setState("error");
      setMessage("Credentials kunne ikke fjernes.");
    }
  }

  if (forbidden) return null;
  if (state === "loading") return <p className="settings-loading">Henter Project Map-indstillinger…</p>;

  const configured = status?.configured === true;
  const canSave = Boolean(
    cloudflareAccountId.trim()
    && (configured || (githubToken.trim() && cloudflareToken.trim())),
  );

  return <div className="settings-form">
    <p className="settings-help">
      GitHub- og Cloudflare-tokens indtastes her og krypteres server-side før de gemmes i D1.
      Tokenværdierne sendes aldrig tilbage til browseren efter lagring. Brug kun read-only tokens.
    </p>

    <label>
      <span>GitHub token</span>
      <input
        type="password"
        autoComplete="new-password"
        value={githubToken}
        onChange={(event) => setGithubToken(event.target.value)}
        placeholder={configured ? "Indtast kun ved ændring" : "Fine-grained read-only token"}
      />
    </label>

    <label>
      <span>Cloudflare API token</span>
      <input
        type="password"
        autoComplete="new-password"
        value={cloudflareToken}
        onChange={(event) => setCloudflareToken(event.target.value)}
        placeholder={configured ? "Indtast kun ved ændring" : "Read-only Workers + Pages token"}
      />
    </label>

    <label>
      <span>Cloudflare Account ID</span>
      <input
        value={cloudflareAccountId}
        onChange={(event) => setCloudflareAccountId(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="32 tegn"
      />
    </label>

    {configured && <p className="settings-feedback success">
      Forbundet{status?.updatedAt ? ` · senest gemt ${new Date(status.updatedAt).toLocaleString("da-DK")}` : ""}.
    </p>}
    {message && <p className={state === "error" ? "settings-feedback error" : "settings-help"}>{message}</p>}

    <div className="settings-location-actions">
      <button className="primary-action" type="button" disabled={state === "saving" || !canSave} onClick={() => void save()}>
        {state === "saving" ? "Tester…" : configured ? "Gem ændringer og test" : "Gem og test"}
      </button>
      {configured && <button className="secondary-action" type="button" disabled={state === "saving"} onClick={() => void clear()}>Fjern</button>}
    </div>
  </div>;
}
