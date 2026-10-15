# Ideas and later projects

Things to add to the hydrotest recorder later, with what each one needs. Add to this list any
time (on github.com: open this file, then the pencil icon), or ask Claude to. Move an item to
"Done" when it ships.

## Waiting on parts or a decision

### Automatic stroke counter
Have the site count pump strokes by itself instead of typing the counter at each checkpoint.
- Today: a pickup senses a bolt going past on the pump pulley and drives the LCD stroke counter.
  The "4-terminal box" is a **TOBSUN EA25-5V DC-DC converter** (12/24 V in, 5 V out) that powers the
  pickup (photo October 2026). The pickup's brown cable: red and white go to the converter's 5 V + and
  −; a thin dark-red wire is the **signal** and runs to the counter's green terminal block. So it is a
  powered (3-wire) sensor with clean 5 V pulses: the PC817 is the right part, no comparator needed.
- To confirm: meter DC volts, black lead on the white wire (5 V −), red lead on the dark-red signal,
  turn the pump slowly. 0 V jumping to ~5 V at the bolt = wire the PC817 normally. ~5 V dropping to
  0 V = the sensor switches to ground, so the PC817 input goes IN+ to 5 V +, IN− to signal. No change =
  measure at the counter's terminals (the counter may supply the pull-up).
- Hookup plan: PC817 input taps the signal and 5 V − with Wago connectors (nothing cut; the LCD counter
  keeps counting). PC817 output to Nano 5V / GND / D2. The Nano is powered by the laptop's USB only,
  never from the trailer's 5 V converter. The module's LED blinks at each bolt pass, for a first test.
- Parts: Arduino Nano (bought or buying), PC817 optocoupler module rated 3.6–30 V input. It
  reads the pickup signal without touching the counter's electronics.
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

### Temperature check in the post-test package (trial)
How much of a pressure change the measured temperatures explain. Test run on ATM 4501 (October
2026): about 33 psi per 1 °F of water for 8" × 0.322" X52. The probes explained about 4 of the
10.5 psi, and the whole drop equals about 0.31 °F of average cooling. The shape matched (flat in the
afternoon heat, falling as the air cooled). Decide after reviewing whether it goes in the package.
To make it stronger: pipe probe on buried pipe (not near the test head), an extra probe on exposed
steel in the sun, and the test head/manifold/hose lengths in the pipeline data.

### Pressure-volume (air in the line) check
Gallons vs pressure while pumping up, compared with what the pipe should take per psi. Waits for
the bypass meter: until the returned water is measured, stroke gallons overstate what went in.

### Lower-power field computer
For running longer on the power station. See the notes in the October 2026 conversation: a
fanless Intel N100/N150 mini PC (Windows 11, about 6–15 W) with a USB-C portable monitor, both
powered from the station's DC outlets rather than its AC inverter. Check the MadgeTech software, the
gauge's USB serial adapter and Chrome all run on it before switching (x86 Windows, not ARM).

## Considered, not now
- Stabilized indicator before the official start; phone alerts (someone is always in the trailer);
  auto-emailing the package; weather; photo log.
- Motorized bypass valve to hold the pressure-up rate: interesting, unlikely.

## Field notes
- Keep the laptop and hotspot box cool. The laptop with dead fans throttled MadgeTech, and temps
  arrived minutes apart. Use the laptop with working fans and give the box airflow/shade.
- The generator may affect the temperature probes. Watch for it.
- A portable power station is planned to keep the field laptop and hotspot running.

## Done
- Post-test package PDF (round charts, combined graph, equipment, strokes, log).
- Calibration papers: store, scan by phone, print the set.
- Pick the pump from the equipment list; change the pump after counting.
- Stroke count Show/Hide; paperwork times default to today.
