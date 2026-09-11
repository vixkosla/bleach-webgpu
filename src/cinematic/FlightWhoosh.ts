/** A quiet air sweep and rising whistle, driven by the same Cinema speed
 * curve as the shutter. The audio device is created only by the sound button. */
export class FlightWhoosh {
  enabled = false;
  private context: AudioContext | null = null;
  private air: GainNode | null = null;
  private tone: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private whistle: OscillatorNode | null = null;
  readonly button = document.createElement('button');

  constructor() {
    this.button.id = 'flight-sound'; this.button.type = 'button';
    this.button.textContent = 'Звук';
    this.button.setAttribute('aria-label', 'Включить свист пролёта');
    this.button.setAttribute('aria-pressed', 'false');
    this.button.title = 'Свист при ускорениях';
    document.querySelector('#viewer-status')!.after(this.button);
    this.button.addEventListener('click', () => { void this.toggle(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.update(0, false, false); });
    window.addEventListener('pagehide', () => { void this.context?.close(); }, { once: true });
  }

  private async toggle(): Promise<void> {
    try {
      if (!this.context) {
        const c = this.context = new AudioContext();
        const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), data = buffer.getChannelData(0);
        let seed = 173;
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
        const source = c.createBufferSource(); source.buffer = buffer; source.loop = true;
        this.filter = c.createBiquadFilter(); this.filter.type = 'bandpass'; this.filter.Q.value = .8;
        this.air = c.createGain(); this.air.gain.value = 0;
        source.connect(this.filter).connect(this.air).connect(c.destination); source.start();
        this.whistle = c.createOscillator(); this.whistle.type = 'sine';
        this.tone = c.createGain(); this.tone.gain.value = 0;
        this.whistle.connect(this.tone).connect(c.destination); this.whistle.start();
      }
      this.enabled = !this.enabled;
      if (this.enabled) await this.context.resume();
      else this.update(0, false, false);
      this.button.setAttribute('aria-pressed', String(this.enabled));
      this.button.setAttribute('aria-label', this.enabled ? 'Выключить свист пролёта' : 'Включить свист пролёта');
    } catch {
      void this.context?.close().catch(() => {}); this.context = null;
      this.enabled = false; this.button.disabled = true;
      this.button.title = 'Звук недоступен в этом браузере';
    }
  }

  update(rush: number, playing: boolean, _cinema: boolean): void {
    this.button.hidden = false;
    const c = this.context;
    if (!c || c.state === 'closed') return;
    const amount = this.enabled && playing && !document.hidden ? Math.max(0, Math.min(1, rush)) : 0;
    this.air!.gain.setTargetAtTime(.075 * amount * amount, c.currentTime, .035);
    this.tone!.gain.setTargetAtTime(.006 * amount ** 3, c.currentTime, .035);
    this.filter!.frequency.setTargetAtTime(550 + amount * 2700, c.currentTime, .045);
    this.whistle!.frequency.setTargetAtTime(850 + amount * 1400, c.currentTime, .045);
  }
}
