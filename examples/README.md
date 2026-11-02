# Example GAs

Three simplified general arrangements made for teaching by Henrique Gaspar, NTNU. They are educational examples, not for professional use, and they are free to use with the app.

| File | Ship | Sheet |
|---|---|---|
| `GA_PSV_Example.pdf` | Platform supply vessel, 92 m, X-Bow-like bow | Page 1: particulars. Page 2: profile, main deck, tank deck, tank top. |
| `GA_River_Cruise_Example.pdf` | River cruise ship, 150 m, 640 guests | Page 1: particulars. Page 2: eight deck plans, no profile. |
| `GA_Tanker_Example.pdf` | Crude / product tanker, 115,000 dwt | Page 1: particulars. Page 2 (turned): profile, upper deck, tank top, midship section. |

In the app, press **Examples** to open one of them.

## Answer keys (`keys/`)

Each GA has an answer key: every enclosed compartment of each view, in ship metres (x forward from the aft end, y to port, z up from the baseline), with the label inside it and the deck height of its plan, plus the particulars of page 1. It is made from the solid lines of the PDF (`dev/gakey.py`), with the view boxes, the scale and the deck heights checked by eye. `keys/<ship>-key.png` shows every compartment in its own colour.

    python3 dev/gakey.py examples/GA_PSV_Example.pdf psv

## Scoring (`dev/dump-app.js`, `dev/gascore.py`)

The app is run on a GA and its blocks are compared with the key:

    node dev/dump-app.js examples/GA_PSV_Example.pdf out/psv-app.json
    python3 dev/gascore.py psv out/psv-app.json

- **Compartments caught**: blocks of the app cover at least 60% of the compartment's box at the right place (plans: x and y just above the deck; profile: x and z). Compartments are the named ones and the unnamed ones of 3 m2 or more; smaller ones are reported as details.
- **One block per compartment**: a single block overlaps the compartment's box by 50% or more (intersection over union).
- **Particulars**: the values of page 1 read by the app, within 2%.
- `keys/<ship>-score.png`: green caught, red missed, grey details.

Results (2 November 2026, compartments engine):

| GA | Compartments caught | One block per compartment | Named | Particulars |
|---|---|---|---|---|
| PSV | 227 of 229 (99%) | 190 of 229 (83%) | 26 of 26 | 7 of 7 |
| River cruise | 503 of 503 (100%) | 449 of 503 (89%) | 252 of 252 | 7 of 7 |
| Tanker | 273 of 273 (100%) | 268 of 273 (98%) | 48 of 48 | 11 of 11 |
