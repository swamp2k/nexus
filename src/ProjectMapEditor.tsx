import { useEffect, useMemo, useState } from "react";

export type ResourceKind = "repos" | "workers" | "pages" | "domains";
export type ResourceInventory = Record<ResourceKind, string[]>;

export type RegistryEntry = {
  id: string;
  title: string;
  repos: string[];
  workers: string[];
  pages: string[];
  domains: string[];
  confirmed: boolean;
};

export type EditableProject = {
  id: string;
  title: string;
  repo: string | null;
  repos?: string[];
  workers: string[];
  pages: string[];
  domains: string[];
  confirmed?: boolean;
  manual?: boolean;
};

const FIELDS: Array<{ kind: ResourceKind; label: string; hint: string }> = [
  { kind: "repos", label: "GitHub repositories", hint: "Søg i repositories" },
  { kind: "workers", label: "Cloudflare Workers", hint: "Søg i Workers" },
  { kind: "pages", label: "Cloudflare Pages", hint: "Søg i Pages-projekter" },
  { kind: "domains", label: "Domæner", hint: "Søg i domæner" },
];

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function MultiSelect({
  label, hint, items, selected, owners, onChange,
}: {
  label: string;
  hint: string;
  items: string[];
  selected: string[];
  owners: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((item) => item.toLowerCase().includes(search.trim().toLowerCase())), [items, search]);

  return <details className="project-select">
    <summary><span>{label} <small>({selected.length})</small></span><span className="project-select-values">{selected.slice(0, 2).join(", ") || "Vælg ressourcer"}{selected.length > 2 ? ` +${selected.length - 2}` : ""}</span></summary>
    <div className="project-select-list">
      <input
        type="search"
        aria-label={hint}
        placeholder={hint}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoComplete="off"
      />
      <div className="project-select-scroll">
        {filtered.length === 0 && <p className="settings-help">Ingen matches.</p>}
        {filtered.map((name) => {
          const owner = owners[name];
          const disabled = Boolean(owner) && !selected.includes(name);
          return <label key={name} className={disabled ? "project-select-claimed" : ""}>
            <input type="checkbox" checked={selected.includes(name)} disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? [...selected, name] : selected.filter((value) => value !== name))} />
            <span>{name}{owner && <small> · knyttet til {owner}</small>}</span>
          </label>;
        })}
      </div>
    </div>
  </details>;
}

export default function ProjectMapEditor({
  project, inventory, registry, onClose, onSaved,
}: {
  project: EditableProject | null;
  inventory: ResourceInventory;
  registry: RegistryEntry[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const original = registry.find((entry) => entry.id === project?.id);
  const [title, setTitle] = useState(original?.title ?? project?.title ?? "");
  const [id, setId] = useState(project?.id ?? "");
  const [links, setLinks] = useState<ResourceInventory>({
    repos: original?.repos ?? project?.repos ?? (project?.repo ? [project.repo] : []),
    workers: original?.workers ?? project?.workers ?? [],
    pages: original?.pages ?? project?.pages ?? [],
    domains: original?.domains ?? project?.domains ?? [],
  });
  const [confirmed, setConfirmed] = useState(original?.confirmed ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Ownership is determined only by manual assignments, not automatic discovery suggestions.
  const owners = useMemo(() => Object.fromEntries(FIELDS.map(({ kind }) => [
    kind, Object.fromEntries(registry.filter((entry) => entry.id !== (project?.id ?? id))
      .flatMap((entry) => entry[kind].map((name) => [name, entry.title]))),
  ])) as Record<ResourceKind, Record<string, string>>, [registry, project, id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function save() {
    setSaving(true); setError("");
    try {
      const finalId = project?.id ?? (id.trim() || slugify(title));
      const response = await fetch("/api/project-map/registry", {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: finalId, title: title.trim(), ...links, confirmed }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string; detail?: string };
        throw new Error(result.detail ?? result.error ?? "Kunne ikke gemme");
      }
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kunne ikke gemme");
    } finally { setSaving(false); }
  }

  async function reset() {
    if (!project?.id || !original || !confirm("Fjern den manuelle tilknytning? Nexus går tilbage til automatisk discovery.")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/project-map/registry?id=${encodeURIComponent(project.id)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Kunne ikke fjerne forbindelserne");
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ukendt fejl");
    } finally { setSaving(false); }
  }

  return <div className="project-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="project-editor-heading" className="project-editor">
      <header className="project-editor-header">
        <div><p className="section-label">Project Map</p><h2 id="project-editor-heading">{project ? "Redigér projekt" : "Opret projekt"}</h2></div>
        <button type="button" className="secondary-action" onClick={onClose} aria-label="Luk">✕</button>
      </header>
      <label className="project-editor-field"><span>Projektnavn</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      {!project && <label className="project-editor-field"><span>Projekt-ID (valgfrit)</span><input value={id} maxLength={100} placeholder={slugify(title) || "project-id"} onChange={(event) => setId(event.target.value)} /></label>}
      <p className="settings-help">Vælg én eller flere ressourcer. Ressourcer, der allerede er manuelt tilknyttet et andet projekt, er låst.</p>
      {FIELDS.map(({ kind, label, hint }) => <MultiSelect key={kind} label={label} hint={hint}
        items={[...new Set([...(inventory[kind] ?? []), ...links[kind]])].sort()}
        selected={links[kind]} owners={owners[kind]}
        onChange={(next) => { setLinks((old) => ({ ...old, [kind]: next })); setConfirmed(false); }} />)}
      <label className="project-editor-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Jeg har gennemgået og bekræftet forbindelserne</span></label>
      {error && <p className="settings-feedback error" role="alert">{error}</p>}
      <div className="project-editor-actions">
        {original && <button type="button" className="secondary-action" disabled={saving} onClick={() => void reset()}>Fjern override</button>}
        <div className="project-editor-spacer"/>
        <button type="button" className="secondary-action" disabled={saving} onClick={onClose}>Annuller</button>
        <button type="button" className="primary-action" disabled={saving || !title.trim()} onClick={() => void save()}>{saving ? "Gemmer…" : "Gem forbindelser"}</button>
      </div>
    </section>
  </div>;
}
