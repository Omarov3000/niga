import { KokoroTTS } from "kokoro-js";

export async function narrate(paragraph: string) {
    const tts = await getModel()

   const sentences = splitTextIntoSentences(paragraph)

    const chunks = []

    for (const sentence of sentences) {
      const audio = await tts.generate(sentence, { voice: 'af_sky' })
      chunks.push(audio)
    }

    // const durations = chunks.map((chunk) => (chunk.audio.length / chunk.sampling_rate) * 1000)

    let audio: { toBlob: () => Blob }
    if (chunks.length > 0) {
      const sampling_rate = chunks[0].sampling_rate
      const length = chunks.reduce((sum, chunk) => sum + chunk.audio.length, 0)
      const waveform = new Float32Array(length)
      let offset = 0
      for (const { audio } of chunks) {
        waveform.set(audio, offset)
        offset += audio.length
      }

      // Create a new merged RawAudio instance
      // @ts-expect-error - No need to import RawAudio explicitly
      audio = new chunks[0].constructor(waveform, sampling_rate)
    } else throw new Error('Impossible')

    return new File([audio.toBlob()], 'audio.wav', { type: 'audio/wav' })
  }


function splitTextIntoSentences(text: string, locale = 'en') {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  const segments = segmenter.segment(text)
  return Array.from(segments, (segment) => segment.segment.trim()).filter(Boolean)
}

async function getModel() {
  const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
const tts = await KokoroTTS.from_pretrained(model_id, {
  dtype: "q8", // Options: "fp32", "fp16", "q8", "q4", "q4f16"
  device: "cpu", // Options: "wasm", "webgpu" (web) or "cpu" (node). If using "webgpu", we recommend using dtype="fp32".
});
  return tts
}
