# Ideas and later projects

Things to add to the hydrotest recorder later, with what each one needs. Add to this list any
time (on github.com: open this file, then the pencil icon), or ask Claude to. Move an item to
"Done" when it ships.

## Waiting on parts or a decision

### Automatic stroke counter
Have the site count pump strokes by itself instead of typing the counter at each checkpoint.
- Today: a magnetic pickup senses a bolt going past on the pump pulley. It feeds a 4-terminal
  box that drives the LCD stroke counter.
- Parts: Arduino Nano (bought or buying), PC817 optocoupler module rated 3.6–30 V input. It
  reads the pickup signal without touching the counter's electronics.
- Still needed: the signal voltage at the box terminals (multimeter, with the pump turning
  slowly), or the box's label/model. That decides how the optocoupler is wired.
- Site side: the Nano plugs into the field laptop over USB. The bridge passes the count up and the Stroke
  count panel fills each checkpoint automatically, still with a Save button. Can share the Nano
  with the bypass meter below.

### Bypass (diversion) flow meter
Know how much water goes back to the tank instead of into the line. The bypass is needed: it
sets the pressure-up rate, so it can't just be closed.
- Return line: small stainless tube into a fitting on the tank wall (photo sent October 2026).
- Meter: low-flow **oval gear** meter, about 0.1–2 GPM, ¼" or ⅜" NPT, ±1%, with an LCD totalizer
  and a pulse output. Brands: Macnaught, GPI, Aice Tech. About $100–300.
- Fit: cut into the vertical run of the tube just before the tank. Use compression-to-NPT adapters
  for the tube size and a ~100-mesh inline strainer before the meter. The flow arrow points to the tank.
- **Safety:** confirm the tube is *downstream* of the bypass/relief valve (near-zero pressure). A
  low-pressure meter on the pump side would see test pressure.
- Still needed: the tube's outside diameter, and roughly how fast it flows with the bypass open
  (catch it in a bucket for 30 seconds).
- Site side: a "Bypass (gal)" column in the stroke count (typed from the meter's display, or from the
  pulse output via the Nano). Net gallons into the line = strokes × gal/stroke − bypass. Carries
  into the post-test package and the Sheet.

### Temperature feed check (built, not merged)
Shows whether the MadgeTech logger is taking readings on time and whether they reach the site.
Built and parked on branch `claude/hydro-testing-github-check-49z4rt` (tag `feed-check-wip`).
Merge when wanted.

### Fill temperature gaps from the logger's memory
When the laptop drops out, fill the missing temperatures from the readings stored on the
MadgeTech logger, once it reconnects.

### Camera built into the scanning page
Only if the phone's browser can't open the camera from "Take picture" (see the browser camera
permission steps). A camera view in the page itself, asking for permission once.

## Field notes
- Keep the laptop and hotspot box cool. The laptop with dead fans throttled MadgeTech, and temps
  arrived minutes apart. Use the laptop with working fans and give the box airflow/shade.
- The generator may affect the temperature probes. Watch for it.

## Done
- Post-test package PDF (round charts, combined graph, equipment, strokes, log).
- Calibration papers: store, scan by phone, print the set.
- Pick the pump from the equipment list; change the pump after counting.
- Stroke count Show/Hide; paperwork times default to today.
