/* Spoken pressure readout. With "Read out PSI" on, the browser says the pressure out loud each
   time it reaches the next step (every 1, 5, 10 psi, whatever is set), rising or falling:
   "435 PSI", "440 PSI" (or "pounds", or any word set in Setup). A level is said once; the gauge has to move a full step before the next
   one, so jitter around a level stays quiet. A big jump says only where it landed. Uses the
   browser's built-in voice (works offline). Saved with each test. */
(function (root) {
  'use strict';

  // Voice, pitch and speed belong to this computer (its installed voices), shared by both tests.
  const VOICE_KEY = 'grantg-hydro-psi-voice';
  const voiceSettings = () => {
    try {
      const v = JSON.parse(root.localStorage.getItem(VOICE_KEY) || '{}');
      return { name: String(v.name || ''), pitch: Number(v.pitch) || 1, rate: Number(v.rate) || 1, word: v.word === undefined ? 'PSI' : String(v.word).slice(0, 40) };
    } catch (_) { return { name: '', pitch: 1, rate: 1, word: 'PSI' }; }
  };
  // The number followed by the chosen word ("435 PSI", "435 pounds"), or just the number.
  const withWord = (number) => { const word = voiceSettings().word.trim(); return word ? `${number} ${word}` : String(number); };
  const voices = () => { try { return root.speechSynthesis?.getVoices?.() || []; } catch (_) { return []; } };
  // The one Read-out voice section in Setup: lists this computer's voices (English first).
  function bindVoiceSettings(panel) {
    if (!panel) return;
    const nameSelect = panel.querySelector('.psi-voice-name'), pitch = panel.querySelector('.psi-voice-pitch'), rate = panel.querySelector('.psi-voice-rate'), word = panel.querySelector('.psi-voice-word');
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const show = () => {
      const saved = voiceSettings();
      const list = voices().slice().sort((a, b) => (/^en/i.test(b.lang) - /^en/i.test(a.lang)) || a.name.localeCompare(b.name));
      const options = ['<option value="">Computer default</option>', ...list.map((v) => `<option value="${esc(v.name)}">${esc(v.name)}${v.lang ? ` (${esc(v.lang)})` : ''}</option>`)];
      if (saved.name && !list.some((v) => v.name === saved.name)) options.push(`<option value="${esc(saved.name)}">${esc(saved.name)} (not on this computer)</option>`);
      const html = options.join('');
      if (nameSelect.dataset.list !== html) { nameSelect.innerHTML = html; nameSelect.dataset.list = html; }
      nameSelect.value = saved.name; pitch.value = String(saved.pitch); rate.value = String(saved.rate);
      if (word && root.document.activeElement !== word) word.value = saved.word;
    };
    const save = () => {
      try { root.localStorage.setItem(VOICE_KEY, JSON.stringify({ name: nameSelect.value, pitch: Number(pitch.value) || 1, rate: Number(rate.value) || 1, word: word ? word.value.slice(0, 40) : 'PSI' })); } catch (_) {}
    };
    [nameSelect, pitch, rate].forEach((input) => input.addEventListener('change', save));
    word?.addEventListener('input', save);
    panel.querySelector('.psi-voice-test')?.addEventListener('click', () => speak(withWord(format(1740, 1))));
    show();
    // Voices often finish loading after the page does.
    root.speechSynthesis?.addEventListener?.('voiceschanged', show);
  }

  // Says a line in the chosen voice. Returns false when the browser will not talk yet.
  function speak(text) {
    const synth = root.speechSynthesis;
    if (!synth || typeof root.SpeechSynthesisUtterance !== 'function') return true;
    if (root.navigator.userActivation && !root.navigator.userActivation.hasBeenActive) return false;
    synth.cancel();
    const utterance = new root.SpeechSynthesisUtterance(text);
    const { name, pitch, rate } = voiceSettings();
    const chosen = name && voices().find((v) => v.name === name);
    try { if (chosen) { utterance.voice = chosen; utterance.lang = chosen.lang; } } catch (_) {}
    utterance.pitch = pitch;
    utterance.rate = rate;
    synth.speak(utterance);
    return utterance;
  }

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
        if (this.on) this.speak(`Read out on, every ${withWord(format(this.step, this.step))}`);
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
      this.speak(`${both ? `${this.g.settings?.().name || ''}, ` : ''}${withWord(format(next, step))}`);
    }

    speak(text) {
      const utterance = speak(text);
      if (utterance === false) { if (this.hint) this.hint.hidden = false; return; }
      if (utterance && utterance !== true) utterance.onerror = (event) => { if (event.error === 'not-allowed' && this.hint) this.hint.hidden = false; };
    }
  }

  function attach(gauges) {
    bindVoiceSettings(root.document.getElementById('voiceSettings'));
    return gauges.map((gauge) => (gauge.psiVoice = new PsiVoice(gauge, gauges)));
  }

  root.HydroPsiVoice = { attach, format };
})(window);
