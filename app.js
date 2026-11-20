// One Piece TCG chase card overlay: shared data code for the link builder (index.html) and
// the overlay (overlay.html). Everything runs in the viewer's browser:
//   - optcgapi.com: card lists, TCGplayer market prices, two-week price history, art
//   - data/tcgplayer/*.json: TCGplayer prices (from TCGCSV) for sets optcgapi doesn't have yet,
//     refreshed by tools/build_data.py (daily on GitHub, see .github/workflows)
//   - data/spoilers.json: Bandai's card list for sets not even on TCGplayer yet (no prices)
//   - data/art_map.json: art for sets optcgapi has prices for but no images
const OPC = (() => {
  const API = "https://optcgapi.com";
  const OFFICIAL_IMG = (id) => `https://en.onepiece-cardgame.com/images/cardlist/card/${id}.png`;
  const TCGPLAYER_IMG = (pid) => `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`;
  const SET_TTL = 6 * 3600e3;       // re-fetch a set's prices after 6 hours
  const SET_LIST_TTL = 24 * 3600e3;
  const FALLBACK_TTL = 3600e3;      // sets on snapshot/spoiler data re-check optcgapi hourly
  const FLAT_PCT = 0.5;             // price changes smaller than this get no arrow

  // ---------- browser cache (per OBS source / browser; safe to lose) ----------
  const cacheGet = (key, ttl) => {
    try {
      const hit = JSON.parse(localStorage.getItem("opc1:" + key));
      return hit && Date.now() - hit.ts < ttl ? hit.data : null;
    } catch { return null; }
  };
  const cacheSet = (key, data) => {
    try { localStorage.setItem("opc1:" + key, JSON.stringify({ ts: Date.now(), data })); } catch { /* full or blocked */ }
  };

  async function getJSON(url, { allow404 = false } = {}) {
    const res = await fetch(url);
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return res.json();
  }
  const local = (path) => getJSON(new URL(path, document.baseURI).href, { allow404: true }).catch(() => null);

  // ---------- tagging (same rules as the local server) ----------
  // Variant tags in card names, most special first → [label shown on stream, color].
  const VARIANT_TAGS = [
    [/\(SP\).*\(Gold\)/i, "GOLD SP", "#ffd23f"],
    [/\(Gold\)/i, "GOLD", "#ffd23f"],
    [/manga/i, "MANGA", "#f4f1ea"],
    [/\(SP\)/, "SP", "#ff9f43"],
    [/wanted poster|treasure|\(TR\)/i, "TREASURE", "#e8b64c"],
    [/signature/i, "SIGNED", "#ffd23f"],
    [/gold[- ]stamp/i, "GOLD STAMP", "#ffd23f"],
    [/heroine leader/i, "HEROINE LEADER", "#b388ff"],
    [/super leader/i, "SUPER LEADER", "#b388ff"],
    [/alternate art|parallel/i, "ALT ART", "#3fd6c6"],
  ];
  const RARITY_TAGS = { SEC: ["SEC", "#ff4d6d"], SR: ["SR", "#5aa9ff"], L: ["LEADER", "#b388ff"],
    R: ["R", "#9aa6c8"], UC: ["UC", "#9aa6c8"], C: ["C", "#9aa6c8"] };
  const RARITY_LABELS = new Set(Object.values(RARITY_TAGS).map(([t]) => t));

  // Short stable hash for versions the API gives no image ID (FNV-1a, 6 hex chars).
  function hash6(s) {
    let h = 0x811c9dc5;
    for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0").slice(0, 6);
  }

  function describe(raw, artMap = {}) {
    const name = raw.card_name || "";
    let tag, color;
    for (const [re, label, col] of VARIANT_TAGS) if (re.test(name)) { tag = label; color = col; break; }
    if (!tag) [tag, color] = RARITY_TAGS[raw.rarity] || [raw.rarity || "", "#9aa6c8"];
    const clean = name.replace(/\s*\([^)]*\)/g, "").replace(/\s*-\s*[A-Z]{1,4}\d{0,3}-\d{3}$/, "").trim() || name;
    const code = raw.card_set_id || "";
    let imageId = raw.card_image_id || artMap[name] || "";
    if (!imageId) imageId = RARITY_LABELS.has(tag) ? code : `${code}_${hash6(name)}`;
    return { imageId, code: code || imageId.split("_")[0], name: clean, fullName: name, tag, color,
             rarity: raw.rarity || "", price: raw.market_price ?? null };
  }

  // Where a card's art can be found, best first ([] = none yet; the overlay shows a stand-in).
  function imageUrls(imageId) {
    if (/^tcg\d+$/.test(imageId)) return [TCGPLAYER_IMG(imageId.slice(3))];
    if (/_[0-9a-f]{6}$/.test(imageId)) return [];
    return [`${API}/media/static/Card_Images/${imageId}.jpg`, OFFICIAL_IMG(imageId)];
  }

  // Load art into an <img>, trying each source in turn. Resolves true if one worked.
  function loadImage(img, imageId) {
    const urls = imageUrls(imageId);
    return new Promise((resolve) => {
      const next = () => {
        const url = urls.shift();
        if (!url) { img.onload = img.onerror = null; return resolve(false); }
        img.onload = () => resolve(true);
        img.onerror = next;
        img.src = url;
      };
      next();
    });
  }

  // Sort key for unpriced cards: rarest-looking versions first, higher parallel numbers first.
  function chaseScore(c) {
    let tier = { SP: 0, "GOLD SP": 0, GOLD: 0, TREASURE: 1, MANGA: 1 }[c.tag];
    if (tier === undefined) {
      const alt = c.tag === "ALT ART";
      tier = { "SEC|true": 2, "SEC|false": 3, "SR|true": 4, "L|true": 5 }[`${c.rarity}|${alt}`] ?? (alt ? 6 : 7);
    }
    const p = +(c.imageId.match(/_p(\d+)$/)?.[1] || 0);
    return tier * 1000 - p;
  }

  function processRows(raw, artMap) {
    const cards = raw.map((r) => describe(r, artMap));
    const seen = new Set();
    for (const c of cards) {  // every version needs its own ID (hiding one shouldn't hide siblings)
      if (seen.has(c.imageId)) c.imageId = `${c.code}_${hash6(c.fullName)}`;
      seen.add(c.imageId);
    }
    if (cards.some((c) => c.price)) cards.sort((a, b) => (b.price || 0) - (a.price || 0));
    else cards.sort((a, b) => chaseScore(a) - chaseScore(b));
    return cards;
  }

  // ---------- sets ----------
  async function apiSets() {
    let sets = cacheGet("sets", SET_LIST_TTL);
    if (!sets) {
      const raw = await getJSON(`${API}/api/allSets/`);
      sets = raw.filter((s) => s.set_id).map((s) => ({ id: s.set_id, name: s.set_name }));
      cacheSet("sets", sets);
    }
    return sets;
  }

  async function listSets() {
    const sets = [...(await apiSets())];
    const index = (await local("data/index.json")) || {};
    const known = new Set(sets.map((s) => s.id));
    for (const s of [...(index.tcgplayer || []), ...(index.spoilers || [])]) {
      if (!known.has(s.id)) { sets.push({ id: s.id, name: s.name }); known.add(s.id); }
    }
    return sets;
  }

  // Every card and version in a set: {cards, source: "optcgapi" | "tcgplayer" | "spoiler", updated}
  async function setCards(setId, { force = false } = {}) {
    const key = "set:" + setId;
    let entry = force ? null : cacheGet(key, SET_TTL);
    if (entry && entry.source !== "optcgapi" && !cacheGet(key, FALLBACK_TTL)) entry = null;
    if (!entry) {
      // Only ask optcgapi for sets it lists: its "not found" reply can't be read cross-site.
      const listed = (await apiSets().catch(() => [])).some((s) => s.id === setId);
      let raw = null, apiError = null;
      if (listed) {
        try {
          raw = await getJSON(`${API}/api/sets/${encodeURIComponent(setId)}/`, { allow404: true });
        } catch (e) { apiError = e; }
      }
      let source = "optcgapi", updated = Date.now();
      if (!Array.isArray(raw) || !raw.length) {
        const snap = await local(`data/tcgplayer/${setId}.json`);
        if (snap?.cards?.length) {
          source = "tcgplayer"; raw = snap.cards; updated = Date.parse(snap.updated) || updated;
        } else {
          const spoiler = ((await local("data/spoilers.json")) || {})[setId];
          source = "spoiler";
          raw = (spoiler?.cards || []).map(([id, rarity, , name]) => {
            if (rarity === "SP CARD") { name += " (SP)"; rarity = "SR"; }
            else if (rarity === "TR") name += " (Treasure)";
            else if (id.includes("_")) name += " (Parallel)";
            return { card_name: name, card_set_id: id.split("_")[0], card_image_id: id, rarity, market_price: null };
          });
          if (!raw.length) throw apiError || new Error(`no card data for ${setId} yet`);
        }
      }
      entry = { raw, source, updated };
      cacheSet(key, entry);
    }
    const artMap = ((await local("data/art_map.json")) || {})[setId] || {};
    return { cards: processRows(entry.raw, artMap), source: entry.source, updated: entry.updated };
  }

  // ---------- price trend (green ▲ / red ▼) ----------
  async function trend(card) {
    if (!card.price) return null;
    const key = "hist:" + card.code;
    let byName = cacheGet(key, SET_TTL);
    if (!byName) {
      byName = {};
      try {
        const rows = await getJSON(`${API}/api/sets/card/twoweeks/${encodeURIComponent(card.code)}/`, { allow404: true });
        for (const row of Array.isArray(rows) ? rows : []) {
          const days = Object.entries(row)
            .filter(([k, v]) => /^Day\d+_Market_Price$/.test(k) && v != null)
            .map(([k, v]) => [parseInt(k.slice(3)), v]).sort((a, b) => a[0] - b[0]);
          if (days.length) byName[row.card_name || ""] = days.map(([, v]) => v);  // newest … oldest
        }
      } catch { /* no history: no arrow */ }
      cacheSet(key, byName);
    }
    const series = byName[card.fullName];
    const old = series?.at(-1);
    if (!old) return null;
    const pct = (card.price - old) / old * 100;
    return { dir: Math.abs(pct) < FLAT_PCT ? "flat" : pct > 0 ? "up" : "down",
             pct: Math.round(pct * 10) / 10, from: old, days: series.length };
  }

  // ---------- overlay settings <-> link ----------
  const DEFAULTS = { set: "OP-09", top: 10, rotate: 3, min: 0, hide: [], layout: "card", scale: 1 };

  function readSettings(search = location.search) {
    const q = new URLSearchParams(search);
    const num = (k, lo, hi) => {
      const v = parseFloat(q.get(k));
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
    };
    return {
      set: q.get("set") || DEFAULTS.set,
      top: Math.round(num("top", 1, 60)),
      rotate: num("rotate", 1, 60),
      min: num("min", 0, 1e6),
      hide: (q.get("hide") || "").split(",").filter(Boolean),
      layout: q.get("layout") === "bar" ? "bar" : "card",
      scale: num("scale", 0.25, 4),
    };
  }

  function writeSettings(s) {
    const q = new URLSearchParams({ set: s.set });
    for (const k of ["top", "rotate", "min", "layout", "scale"]) if (s[k] !== DEFAULTS[k]) q.set(k, s[k]);
    if (s.hide.length) q.set("hide", s.hide.join(","));
    return q.toString().replace(/%2C/g, ",");
  }

  function pickChase(cards, s, spoiler) {
    const hidden = new Set(s.hide);
    return cards.filter((c) => !hidden.has(c.imageId) && (spoiler || (c.price && c.price >= s.min))).slice(0, s.top);
  }

  const money = (p) => p == null ? "—" : "$" + (p >= 1000 ? Math.round(p).toLocaleString() : p.toFixed(2));

  return { listSets, setCards, trend, pickChase, readSettings, writeSettings, loadImage, imageUrls, money, DEFAULTS };
})();
