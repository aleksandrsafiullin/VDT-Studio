/* Microphone PCM only. Recognition runs in the local whisper.cpp runtime. */
class VdtSpeechPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data !== "flush") return;
      if (this.offset) this.port.postMessage(this.samples.slice(0, this.offset));
      this.offset = 0;
      this.port.postMessage("flushed");
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.samples[this.offset++] = sample / channels.length;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("vdt-speech-pcm", VdtSpeechPcm);
