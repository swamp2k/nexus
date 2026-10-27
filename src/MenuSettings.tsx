import { useEffect, useState } from "react";
import { DEFAULT_LAYOUT, NAVIGATION_CHANGED_EVENT, NAV_BY_PAGE, entryKey } from "./data/navigation";
import type { NavCategory, NavEntry, NavPage } from "./data/navigation";

function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function MenuSettings() {
  const [layout, setLayout] = useState<NavEntry[]>(DEFAULT_LAYOUT);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    void fetch("/api/navigation", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ layout: NavEntry[] }> : Promise.reject())
      .then((body) => setLayout(body.layout))
      .catch(() => setState("error"))
      .finally(() => setLoading(false));
  }, []);

  function change(next: NavEntry[]) { setLayout(next); setState("idle"); }
  function updateCategory(index: number, patch: Partial<NavCategory>) {
    change(layout.map((entry, i) => i === index && typeof entry !== "string" ? { ...entry, ...patch } : entry));
  }
  function addCategory() {
    change([...layout, { id: `kategori-${Date.now().toString(36)}`, label: "Ny kategori", tabs: [] }]);
  }
  function removeCategory(index: number) {
    const entry = layout[index];
    if (typeof entry === "string") return;
    change([...layout.slice(0, index), ...entry.tabs, ...layout.slice(index + 1)]);
  }
  function moveIntoCategory(page: NavPage, categoryIndex: number) {
    change(layout.filter((entry) => entry !== page).map((entry, i) => {
      const original = layout[categoryIndex];
      return typeof entry !== "string" && original && typeof original !== "string" && entry.id === original.id ? { ...entry, tabs: [...entry.tabs, page] } : entry;
    }));
  }
  function moveOutOfCategory(index: number, tabIndex: number) {
    const entry = layout[index];
    if (typeof entry === "string") return;
    const page = entry.tabs[tabIndex];
    const next = [...layout];
    next[index] = { ...entry, tabs: entry.tabs.filter((_, i) => i !== tabIndex) };
    next.splice(index + 1, 0, page);
    change(next);
  }

  async function save() {
    setState("saving");
    try {
      const response = await fetch("/api/navigation", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout }) });
      if (!response.ok) throw new Error("save_failed");
      const body = await response.json() as { layout: NavEntry[] };
      setLayout(body.layout);
      window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT, { detail: body.layout }));
      setState("saved");
    } catch { setState("error"); }
  }

  if (loading) return <p className="settings-loading">Henter menu…</p>;
  const categories = layout.map((entry, index) => ({ entry, index })).filter((item): item is { entry: NavCategory; index: number } => typeof item.entry !== "string");

  return <div className="settings-form menu-settings">
    <p className="settings-help">Flyt punkter op og ned. En kategori er ét menupunkt med faner; den første fane vises altid først. Tomme kategorier fjernes ved gem.</p>
    <ul className="menu-settings-list">
      {layout.map((entry, index) => <li key={entryKey(entry)} className="menu-settings-row">
        {typeof entry === "string" ? <div className="menu-settings-line">
          <strong>{NAV_BY_PAGE.get(entry)!.label}</strong>
          {entry !== "Hjem" && categories.length > 0 && <select value="" aria-label={`Flyt ${NAV_BY_PAGE.get(entry)!.label} ind i kategori`} onChange={(event) => event.target.value && moveIntoCategory(entry, Number(event.target.value))}>
            <option value="">Flyt ind i…</option>{categories.map(({ entry: category, index: categoryIndex }) => <option key={category.id} value={categoryIndex}>{category.label}</option>)}
          </select>}
          <span className="menu-settings-buttons"><button type="button" onClick={() => change(moved(layout, index, -1))} aria-label="Op">↑</button><button type="button" onClick={() => change(moved(layout, index, 1))} aria-label="Ned">↓</button></span>
        </div> : <div className="menu-settings-category">
          <div className="menu-settings-line">
            <input value={entry.label} maxLength={40} aria-label="Navn på kategori" onChange={(event) => updateCategory(index, { label: event.target.value })} />
            <button type="button" className="secondary-action" onClick={() => removeCategory(index)}>Fjern kategori</button>
            <span className="menu-settings-buttons"><button type="button" onClick={() => change(moved(layout, index, -1))} aria-label="Op">↑</button><button type="button" onClick={() => change(moved(layout, index, 1))} aria-label="Ned">↓</button></span>
          </div>
          <ol className="menu-settings-tabs">{entry.tabs.map((tab, tabIndex) => <li key={tab} className="menu-settings-line">
            <span>{tabIndex === 0 ? "Fane 1 (vises først): " : `Fane ${tabIndex + 1}: `}<strong>{NAV_BY_PAGE.get(tab)!.label}</strong></span>
            <button type="button" className="secondary-action" onClick={() => moveOutOfCategory(index, tabIndex)}>Ud af kategori</button>
            <span className="menu-settings-buttons"><button type="button" onClick={() => updateCategory(index, { tabs: moved(entry.tabs, tabIndex, -1) })} aria-label="Fane op">↑</button><button type="button" onClick={() => updateCategory(index, { tabs: moved(entry.tabs, tabIndex, 1) })} aria-label="Fane ned">↓</button></span>
          </li>)}{entry.tabs.length === 0 && <li className="settings-help">Ingen faner endnu. Brug "Flyt ind i…" på et menupunkt.</li>}</ol>
        </div>}
      </li>)}
    </ul>
    <div className="settings-location-actions">
      <button type="button" className="secondary-action" onClick={addCategory}>Ny kategori</button>
      <button type="button" className="secondary-action" onClick={() => change(DEFAULT_LAYOUT)}>Nulstil til standard</button>
      <button type="button" className="primary-action" onClick={() => void save()} disabled={state === "saving"}>{state === "saving" ? "Gemmer…" : "Gem menu"}</button>
    </div>
    {state === "saved" && <p className="settings-feedback">Menuen er gemt.</p>}
    {state === "error" && <p className="settings-feedback error">Menuen kunne ikke gemmes.</p>}
  </div>;
}
