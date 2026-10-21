/* Spoken pressure readout. With "Read out PSI" on, the browser says the pressure out loud each
   time it reaches the next step (every 1, 5, 10 psi, whatever is set), rising or falling:
   "435 PSI", "440 PSI". A level is said once; the gauge has to move a full step before the next
   one, so jitter around a level stays quiet. A big jump says only where it landed. Uses the
   browser's built-in voice (works offline). Saved with each test. */
(function (root) {
  'use strict';

  const format = (level, step) => (Number.isInteger(step) ? String(Math.round(level)) : String(Number(level.toFixed(1))));

  class PsiVoice {
    constructor(gauge, all) {
      this.g = gauge;
      this.all = all;
      this.level = null;
      this.box = gauge.root.querySelector('.psi-voice-control');
      if (!this.box) return;
      this.toggle = this.box.querySelector('.psi-voice-on');
      this.stepInput = this.box.querySelector('.psi-voice-step');
      this.hint = this.box.querySelector('.psi-voice-hint');
      if (!root.speechSynthesis) {
        this.toggle.disabled = true;
        this.box.title = 'This browser cannot speak. Use Chrome or Edge.';
      }
      this.restore();
      this.toggle.addEventListener('change', () => {
        this.save();
        this.level = null;
        if (this.on) this.speak(`Read out on, every ${format(this.step, this.step)} PSI`);
        else root.speechSynthesis?.cancel();
      });
      this.stepInput.addEventListener('change', () => {
        if (!(Number(this.stepInput.value) > 0)) this.stepInput.value = String(this.state().step);
        this.save();
        this.level = null;
      });
      // A browser only lets a page talk after the page has been clicked once.
      const unlock = () => { if (this.hint) this.hint.hidden = true; };
      root.document.addEventListener('pointerdown', unlock, { capture: true });
      root.document.addEventListener('keydown', unlock, { capture: true });
    }

    state() {
      const saved = this.g.testState.psiVoice || {};
      return { on: saved.on === true, step: Number(saved.step) > 0 ? Number(saved.step) : 5 };
    }
    get on() { return this.state().on; }
    get step() { return this.state().step; }

    restore() {
      if (!this.box) return;
      const { on, step } = this.state();
      this.toggle.checked = on;
      if (root.document.activeElement !== this.stepInput) this.stepInput.value = String(step);
      this.level = null;
    }

    save() {
      const step = Number(this.stepInput.value) > 0 ? Number(this.stepInput.value) : 5;
      this.g.testState.psiVoice = { on: this.toggle.checked, step };
      this.g.saveTestState();
    }

    // Called with each new recorded reading (offset already applied).
    reading(reading) {
      if (!this.box || !this.on) return;
      const pressure = Number(reading?.pressure);
      if (!Number.isFinite(pressure)) return;
      const step = this.step;
      if (this.level === null) { this.level = Math.round(pressure / step) * step; return; }
      let next = null;
      if (pressure >= this.level + step) next = Math.floor(pressure / step + 1e-9) * step;
      else if (pressure <= this.level - step) next = Math.ceil(pressure / step - 1e-9) * step;
      if (next === null) return;
      this.level = next;
      // With both tests reading out, say which one.
      const both = this.all.filter((g) => g.active && g.psiVoice?.on).length > 1;
      this.speak(`${both ? `${this.g.settings?.().name || ''}, ` : ''}${format(next, step)} PSI`);
    }

    speak(text) {
      const synth = root.speechSynthesis;
      if (!synth || typeof root.SpeechSynthesisUtterance !== 'function') return;
      if (root.navigator.userActivation && !root.navigator.userActivation.hasBeenActive) {
        if (this.hint) this.hint.hidden = false;
        return;
      }
      synth.cancel();
      const utterance = new root.SpeechSynthesisUtterance(text);
      utterance.onerror = (event) => { if (event.error === 'not-allowed' && this.hint) this.hint.hidden = false; };
      synth.speak(utterance);
    }
  }

  function attach(gauges) {
    return gauges.map((gauge) => (gauge.psiVoice = new PsiVoice(gauge, gauges)));
  }

  root.HydroPsiVoice = { attach, format };
})(window);
