export type NavPage = "Hjem" | "Garmin" | "Motion" | "Velbefindende" | "Vejr" | "Strøm" | "Kalender" | "Varmepumpe" | "DBA" | "Unraid" | "PC Watch" | "Privateering" | "Notifikationer" | "Displays";

/** A category is one menu entry that opens a page with tabs; its tabs are ordinary pages. */
export type NavCategory = { id: string; label: string; tabs: NavPage[] };
export type NavEntry = NavPage | NavCategory;

export const NAV_DEFINITIONS: { page: NavPage; icon: string; label: string }[] = [
  { page: "Hjem", icon: "⌂", label: "Hjem" }, { page: "Garmin", icon: "⌖", label: "Garmin" }, { page: "Motion", icon: "↗", label: "Motion" },
  { page: "Velbefindende", icon: "♥", label: "Velbefindende" }, { page: "Vejr", icon: "☁", label: "Vejr" }, { page: "Strøm", icon: "ϟ", label: "Strøm" },
  { page: "Kalender", icon: "▦", label: "Kalender" }, { page: "Varmepumpe", icon: "♨", label: "Varmepumpe" }, { page: "DBA", icon: "◇", label: "DBA" },
  { page: "Unraid", icon: "▤", label: "Unraid Watch" }, { page: "PC Watch", icon: "▣", label: "PC Watch" }, { page: "Privateering", icon: "☠", label: "Privateering" }, { page: "Notifikationer", icon: "♧", label: "Notifikationer" },
  { page: "Displays", icon: "▣", label: "Displays" },
];
export const NAV_BY_PAGE = new Map(NAV_DEFINITIONS.map((item) => [item.page, item]));
export const CATEGORY_ICON = "▤";

export const DEFAULT_LAYOUT: NavEntry[] = NAV_DEFINITIONS.flatMap((item): NavEntry[] =>
  item.page === "Unraid" ? [{ id: "infrastruktur", label: "Infrastruktur", tabs: ["Unraid", "PC Watch"] }]
    : item.page === "PC Watch" ? [] : [item.page]);

export const entryKey = (entry: NavEntry): string => typeof entry === "string" ? entry : entry.id;
export const NAVIGATION_CHANGED_EVENT = "nexus-navigation-changed";
