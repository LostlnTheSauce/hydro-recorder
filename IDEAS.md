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
- **Decision (October 2026): Arduino Nano**, not a new counter. A Red Lion CUB5 with a serial card
  (~$300) would do it, but costs too much for this. The Nano mounts dry under the trailer table and
  listens alongside the existing counter, so the LCD counter the crew and inspectors read stays as is.
- Parts (about $30–45):
  - Arduino Nano (official, or a clone; clones use the CH340 USB chip and may need its Windows driver)
  - PC817 optocoupler module, 1 channel, 3.6–30 V input (buy a 2-pack)
  - Nano screw-terminal adapter board (wiring with no soldering)
  - Lever connectors (Wago 221) to tap the sensor signal without cutting wires; a few feet of
    18–22 AWG wire
  - USB cable long enough to reach the laptop (6–10 ft)
  - Small project box, plus zip ties or Velcro to hang it under the table
- First, before wiring anything: with the pump turning slowly, measure the signal at the box
  terminals with a multimeter, and count the pickup's wires. A 3-wire pickup gives clean pulses:
  the optocoupler is right. A 2-wire pickup is passive, with a weak AC signal at low speed: use an
  LM393 comparator module instead (about $5) so slow strokes are not missed.
- Site side: the Nano plugs into the field laptop by USB. The host page reads it like it reads the
  gauge (browser serial), and the Stroke count panel fills each checkpoint from it, with Save still
  there to confirm or correct. The LCD counter stays the reference to check against. Can share the
  Nano with the bypass meter below.

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
