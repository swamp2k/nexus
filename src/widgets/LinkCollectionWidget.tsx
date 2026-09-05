import type { WidgetConfig } from "../dashboard/layoutEditing";
import type { WidgetDefinition } from "./widgetRegistry";

export const LINK_COLLECTION_TYPE = "links.collection";
export const LINK_COLLECTION_MAX_LINKS = 5;

export type LinkCollectionLink = {
  label: string;
  url: string;
  icon?: string;
};

export type LinkCollectionConfig = {
  title: string;
  links: LinkCollectionLink[];
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readLinkCollectionConfig(config?: WidgetConfig): LinkCollectionConfig {
  const source = config && typeof config === "object" ? config : {};
  const rawLinks = Array.isArray(source.links) ? source.links : [];
  const links = rawLinks.slice(0, LINK_COLLECTION_MAX_LINKS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    return [{
      label: stringValue(row.label),
      url: stringValue(row.url),
      ...(stringValue(row.icon) ? { icon: stringValue(row.icon) } : {}),
    }];
  });

  return {
    title: stringValue(source.title) || "Links",
    links,
  };
}

export function createLinkCollectionConfig(): LinkCollectionConfig {
  return {
    title: "Links",
    links: [{ label: "", url: "" }],
  };
}

export function linkCollectionTitle(config?: WidgetConfig): string {
  return readLinkCollectionConfig(config).title.trim() || "Links";
}

function safeHref(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function LinkCollectionWidget({ config }: { config?: WidgetConfig }) {
  const parsed = readLinkCollectionConfig(config);
  const links = parsed.links
    .map((link) => ({ ...link, href: safeHref(link.url) }))
    .filter((link): link is LinkCollectionLink & { href: string } => Boolean(link.href && link.label.trim()));

  if (links.length === 0) return <div className="home-widget-state">Ingen links endnu</div>;

  return <div className="link-collection widget-fill">
    {links.map((link, index) => <a className="link-collection-row" href={link.href} target="_blank" rel="noreferrer" key={`${link.href}-${index}`}>
      <span className="link-collection-icon" aria-hidden="true">{link.icon?.trim() || "↗"}</span>
      <span className="link-collection-label">{link.label.trim()}</span>
    </a>)}
  </div>;
}

export function LinkCollectionEditor({
  config,
  onChange,
}: {
  config?: WidgetConfig;
  onChange: (config: LinkCollectionConfig) => void;
}) {
  const parsed = readLinkCollectionConfig(config);

  function updateLink(index: number, patch: Partial<LinkCollectionLink>) {
    onChange({
      ...parsed,
      links: parsed.links.map((link, linkIndex) => linkIndex === index ? { ...link, ...patch } : link),
    });
  }

  function removeLink(index: number) {
    onChange({ ...parsed, links: parsed.links.filter((_, linkIndex) => linkIndex !== index) });
  }

  function addLink() {
    if (parsed.links.length >= LINK_COLLECTION_MAX_LINKS) return;
    onChange({ ...parsed, links: [...parsed.links, { label: "", url: "" }] });
  }

  return <div className="link-collection-editor">
    <label className="link-collection-title-field">
      <span>Navn</span>
      <input value={parsed.title} maxLength={48} onChange={(event) => onChange({ ...parsed, title: event.target.value })} placeholder="Audio / Video" />
    </label>

    <div className="link-collection-editor-links">
      {parsed.links.map((link, index) => <div className="link-collection-editor-row" key={index}>
        <input className="link-collection-icon-input" aria-label={`Ikon for link ${index + 1}`} value={link.icon ?? ""} maxLength={4} onChange={(event) => updateLink(index, { icon: event.target.value })} placeholder="↗" />
        <input aria-label={`Navn for link ${index + 1}`} value={link.label} maxLength={60} onChange={(event) => updateLink(index, { label: event.target.value })} placeholder="YouTube" />
        <input aria-label={`URL for link ${index + 1}`} value={link.url} maxLength={500} onChange={(event) => updateLink(index, { url: event.target.value })} placeholder="https://…" />
        <button type="button" className="link-collection-remove-link" aria-label={`Fjern link ${index + 1}`} onClick={() => removeLink(index)}>×</button>
      </div>)}
    </div>

    <button type="button" className="secondary-action link-collection-add-link" disabled={parsed.links.length >= LINK_COLLECTION_MAX_LINKS} onClick={addLink}>
      + Tilføj link{parsed.links.length >= LINK_COLLECTION_MAX_LINKS ? " · maks. 5" : ""}
    </button>
  </div>;
}

export const linkCollectionWidgetDefinition: WidgetDefinition = {
  id: LINK_COLLECTION_TYPE,
  title: "Links",
  description: "En personlig samling med op til fem links",
  group: "Links",
  defaultSize: "small",
  supportedSizes: ["small"],
  repeatable: true,
  resolveTitle: linkCollectionTitle,
  component: LinkCollectionWidget,
};
