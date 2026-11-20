# One Piece TCG Chase Card Overlay (web version)

A stream overlay for OBS that rotates through a set's most valuable cards with art,
TCGplayer market price, and a green ▲ / red ▼ price trend. Streamers open the site,
pick their settings, and paste their personal overlay link into OBS. Nothing to install.

- `index.html`: link builder (pick a set, top N, speed, layout, hide cards, live preview)
- `overlay.html`: the overlay itself; all settings come from the link
- `app.js`: shared data code (runs in the viewer's browser)
- `data/`: TCGplayer price snapshots for brand-new sets, spoiler lists, art fixes
- `tools/build_data.py`: refreshes `data/` (run daily by `.github/workflows/refresh-prices.yml`)

## Where the data comes from

| Source | Used for |
|---|---|
| [optcgapi.com](https://optcgapi.com) | Card lists, TCGplayer market prices, two-week price history, art (read live by the browser) |
| [TCGCSV](https://tcgcsv.com) | TCGplayer prices for sets optcgapi hasn't added yet. TCGCSV can't be read from a web page, so `tools/build_data.py` saves it into `data/tcgplayer/` |
| Bandai's official card list | `data/spoilers.json` (sets with no prices anywhere yet) and `data/art_map.json` |

## Publishing (GitHub Pages, free)

1. Create a new public repository on GitHub, e.g. `op-tcg-overlay`.
2. Upload the contents of this folder to it (including the hidden `.github` folder).
3. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*,
   branch `main`, folder `/ (root)`. Save.
4. After a minute the site is live at `https://<your-username>.github.io/op-tcg-overlay/`.
5. **Settings → Actions → General → Workflow permissions**: *Read and write permissions*
   (lets the daily job save fresh new-set prices). You can run it by hand from the
   **Actions** tab → *Refresh new-set prices* → *Run workflow*.

Any static host works (Netlify, Cloudflare Pages, …); only the daily new-set price refresh
needs GitHub Actions or running `python3 tools/build_data.py` yourself.

## Adding a new set before optcgapi has it

- If TCGplayer lists it: nothing to do; the daily job picks it up.
- If not even TCGplayer has it: add Bandai's card list to `data/spoilers.json`
  (see the `_about` note in that file). It shows with "Price TBD" until prices exist.
