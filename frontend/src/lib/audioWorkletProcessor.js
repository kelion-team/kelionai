class AudioWorkletProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    for (let channel = 0; channel < input.length; ++channel) {
      output[channel].set(input[channel]);
    }
    this.port.postMessage(input[0]);
    return true;
  }
}

registerProcessor('audio-worklet-processor', AudioWorkletProcessor);