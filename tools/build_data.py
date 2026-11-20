#!/usr/bin/env python3
"""Refresh the site's TCGplayer price snapshots for sets optcgapi doesn't have yet.

Browsers can read optcgapi directly, but not TCGCSV (TCGplayer's catalog mirror sends no
CORS header), so brand-new sets are saved here as static JSON the overlay can load:

  data/tcgplayer/OP-18.json   {name, updated, cards: [optcgapi-shaped rows]}
  data/index.json             {tcgplayer: [{id, name}], spoilers: [{id, name}]}

Snapshots for sets optcgapi has since added are deleted. Run from the repo root:
    python3 tools/build_data.py
On GitHub, .github/workflows/refresh-prices.yml runs it daily.
"""

import json
import re
import ssl
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SNAP_DIR = DATA / "tcgplayer"
OPTCGAPI = "https://optcgapi.com"
TCGCSV = "https://tcgcsv.com/tcgplayer/68"  # 68 = One Piece Card Game
BOOSTER_ABBREV = re.compile(r"^(OP|EB|PRB)(\d{2})$")  # OP18 -> OP-18; skips "OP18 RE" event groups


def _ssl_context():
    # python.org builds on macOS ship without root certs; fall back to certifi or the system bundle.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
        if Path("/etc/ssl/cert.pem").exists():
            ctx.load_verify_locations("/etc/ssl/cert.pem")
        return ctx


SSL_CTX = _ssl_context()


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "op-tcg-chase-overlay/1.0"})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
        return json.loads(r.read())


def tcgplayer_rows(group_id):
    """A group's singles with market prices, shaped like optcgapi rows (sealed product skipped)."""
    products = get(f"{TCGCSV}/{group_id}/products")["results"]
    market = {}
    for p in get(f"{TCGCSV}/{group_id}/prices")["results"]:  # one row per printing; keep a priced one
        if p.get("marketPrice") is not None or p["productId"] not in market:
            market[p["productId"]] = p.get("marketPrice")
    rows = []
    for prod in products:
        ext = {e["name"]: e["value"] for e in prod.get("extendedData", [])}
        if not ext.get("Number"):
            continue
        rows.append({"card_name": prod["name"], "card_set_id": ext["Number"],
                     "card_image_id": f"tcg{prod['productId']}", "rarity": ext.get("Rarity") or "",
                     "market_price": market.get(prod["productId"])})
    return rows


def main():
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    have = {s["set_id"] for s in get(f"{OPTCGAPI}/api/allSets/") if s.get("set_id")}
    groups = get(f"{TCGCSV}/groups")["results"]
    written = []
    for g in groups:
        m = BOOSTER_ABBREV.match((g.get("abbreviation") or "").upper())
        if not m:
            continue
        set_id = f"{m.group(1)}-{m.group(2)}"
        if set_id in have:
            continue
        rows = tcgplayer_rows(g["groupId"])
        if not rows:
            continue  # announced on TCGplayer but no cards listed yet
        snap ={"name": g["name"], "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cards": rows}
        (SNAP_DIR / f"{set_id}.json").write_text(json.dumps(snap, separators=(",", ":")))
        written.append({"id": set_id, "name": g["name"]})
        print(f"{set_id}: {len(rows)} cards, {sum(1 for r in rows if r['market_price'])} priced")
    keep = {w["id"] for w in written}
    for old in SNAP_DIR.glob("*.json"):
        if old.stem not in keep:
            old.unlink()
            print(f"{old.stem}: optcgapi has it now, removed snapshot")
    spoilers = json.loads((DATA / "spoilers.json").read_text())
    index = {
        "tcgplayer": sorted(written, key=lambda s: s["id"]),
        "spoilers": [{"id": k, "name": v["name"]} for k, v in spoilers.items()
                     if not k.startswith("_") and k not in have and k not in keep],
    }
    (DATA / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print("index:", json.dumps(index))


if __name__ == "__main__":
    main()
