import { useEffect, useMemo, useState } from "react";

type EmojiItem = { emoji: string; keywords: string };
type EmojiCategory = { id: string; label: string; items: EmojiItem[] };

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "tech",
    label: "Værktøj & Tech",
    items: [
      { emoji: "🩺", keywords: "doctor læge pc health diagnostic" },
      { emoji: "🛠️", keywords: "tools værktøj repair fix" },
      { emoji: "⚙️", keywords: "settings gear config indstillinger" },
      { emoji: "💻", keywords: "laptop computer pc mac" },
      { emoji: "🖥️", keywords: "desktop monitor screen skærm" },
      { emoji: "⌨️", keywords: "keyboard tastatur code" },
      { emoji: "🔌", keywords: "plug strøm power api" },
      { emoji: "🔋", keywords: "battery batteri energy" },
      { emoji: "📡", keywords: "network netværk radar signal" },
      { emoji: "🌐", keywords: "web globe internet site" },
      { emoji: "🔒", keywords: "lock security auth login" },
      { emoji: "🔑", keywords: "key nøgle token auth" },
      { emoji: "📦", keywords: "package box container build" },
      { emoji: "🧪", keywords: "test lab experiment" },
      { emoji: "🐛", keywords: "bug debug fejl" },
      { emoji: "📊", keywords: "chart graph stats data" },
      { emoji: "📈", keywords: "trend up analytics" },
      { emoji: "🗂️", keywords: "files folders organize" },
      { emoji: "📋", keywords: "clipboard list notes" },
      { emoji: "🤖", keywords: "bot ai agent robot" },
      { emoji: "⚡", keywords: "fast lightning strøm power" },
      { emoji: "🔥", keywords: "fire hot popular" },
      { emoji: "🚀", keywords: "launch deploy rocket" },
      { emoji: "🧰", keywords: "toolbox utilities" },
    ],
  },
  {
    id: "media",
    label: "Spil & Medier",
    items: [
      { emoji: "🧊", keywords: "3d cube glb model viewer" },
      { emoji: "🎮", keywords: "game gaming controller spil" },
      { emoji: "🕹️", keywords: "arcade joystick game" },
      { emoji: "🎬", keywords: "video movie film encode" },
      { emoji: "🎞️", keywords: "film frames video hevc" },
      { emoji: "📷", keywords: "camera photo billede" },
      { emoji: "🎵", keywords: "music audio lyd" },
      { emoji: "🎧", keywords: "headphones lyd podcast" },
      { emoji: "📺", keywords: "tv display screen" },
      { emoji: "🎨", keywords: "art design color" },
      { emoji: "🧩", keywords: "puzzle plugin mod" },
      { emoji: "🎲", keywords: "dice random game" },
      { emoji: "🏆", keywords: "trophy win award" },
      { emoji: "🗺️", keywords: "map kort navigation" },
    ],
  },
  {
    id: "shopping",
    label: "Shopping & Bil",
    items: [
      { emoji: "🛒", keywords: "shop shopping cart indkøb" },
      { emoji: "🛍️", keywords: "shopping bag butik" },
      { emoji: "🏷️", keywords: "tag price pris deal" },
      { emoji: "💰", keywords: "money penge budget" },
      { emoji: "💳", keywords: "card payment betaling" },
      { emoji: "🚗", keywords: "car bil bilbasen auto" },
      { emoji: "🚙", keywords: "suv car bil" },
      { emoji: "🏎️", keywords: "race car fast" },
      { emoji: "🚲", keywords: "bike cykel" },
      { emoji: "⛽", keywords: "fuel gas benzin" },
      { emoji: "📦", keywords: "parcel delivery pakke" },
      { emoji: "🔍", keywords: "search find scraper" },
    ],
  },
  {
    id: "home",
    label: "Hjem & Liv",
    items: [
      { emoji: "🏠", keywords: "home hjem hus" },
      { emoji: "🌡️", keywords: "temp heat pump varmepumpe" },
      { emoji: "☀️", keywords: "sun weather vejr solar" },
      { emoji: "🌧️", keywords: "rain weather vejr" },
      { emoji: "📅", keywords: "calendar kalender schedule" },
      { emoji: "⏰", keywords: "clock alarm timer" },
      { emoji: "❤️", keywords: "heart health velbefindende" },
      { emoji: "🏃", keywords: "run motion sport" },
      { emoji: "😴", keywords: "sleep søvn" },
      { emoji: "🌿", keywords: "nature green eco" },
      { emoji: "☕", keywords: "coffee kaffe" },
      { emoji: "⭐", keywords: "star favorite" },
    ],
  },
];

export default function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = activeCat === "all"
      ? EMOJI_CATEGORIES.flatMap((c) => c.items)
      : EMOJI_CATEGORIES.find((c) => c.id === activeCat)?.items ?? [];
    if (!q) return pool;
    return pool.filter((item) => item.keywords.toLowerCase().includes(q) || item.emoji.includes(q));
  }, [search, activeCat]);

  return (
    <div
      className="emoji-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="emoji-picker" role="dialog" aria-modal="true" aria-label="Vælg emoji">
      <div className="emoji-picker-head">
        <input
          type="search"
          className="emoji-picker-search"
          placeholder="Søg emoji…"
          aria-label="Søg emoji"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button type="button" className="apps-icon-btn" onClick={onClose} aria-label="Luk emoji-vælger">
          ✕
        </button>
      </div>
      <div className="emoji-picker-tabs">
        <button
          type="button"
          className={activeCat === "all" ? "active" : ""}
          onClick={() => setActiveCat("all")}
        >
          Alle
        </button>
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={activeCat === cat.id ? "active" : ""}
            onClick={() => setActiveCat(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="emoji-picker-grid">
        {visibleItems.length === 0 ? (
          <p className="settings-help">Ingen emojis matcher.</p>
        ) : (
          visibleItems.map((item, idx) => (
            <button
              key={`${item.emoji}-${idx}`}
              type="button"
              className="emoji-picker-btn"
              title={item.keywords}
              onClick={() => {
                onSelect(item.emoji);
                onClose();
              }}
            >
              {item.emoji}
            </button>
          ))
        )}
      </div>
    </div>
    </div>
  );
}
