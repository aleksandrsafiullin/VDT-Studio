const repository = "https://huggingface.co/rhasspy/piper-voices";
const revision = "cf910fb59f1d79ab3b625a63993a108751c6c25d";

export interface NeuralVoiceAsset {
  readonly name: "model.onnx" | "model.onnx.json" | "MODEL_CARD";
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface NeuralVoice {
  readonly id: string;
  readonly label: string;
  readonly locale: "en-US" | "ru-RU";
  readonly revision: string;
  readonly sampleRate: 22_050;
  readonly provenance: {
    readonly modelCardUrl: string;
    readonly datasetUrl: string;
    readonly datasetLicense: "CC0-1.0";
    readonly baseModelCardUrl: string;
    readonly baseDatasetUrl: string;
    readonly baseDatasetLicense: "CC0-1.0";
    readonly distribution: "upstream_download_only";
  };
  readonly assets: readonly NeuralVoiceAsset[];
}

// These model cards require Piper 1.5 or later. Its license and the engine's
// installation and runtime verification are distinct from the voice assets.
export const NEURAL_VOICE_ENGINE = Object.freeze({
  name: "Piper", minimumVersion: "1.5", license: "GPL-3.0-or-later",
  licenseUrl: "https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING"
});

function voice(id: string, label: string, locale: NeuralVoice["locale"], directory: string,
  hashes: readonly [string, string, string], sizes: readonly [number, number, number]): NeuralVoice {
  const source = `${repository}/resolve/${revision}/${directory}`;
  const assets: NeuralVoiceAsset[] = [
    { name: "model.onnx", url: `${source}/${id}.onnx`, bytes: sizes[0], sha256: hashes[0] },
    { name: "model.onnx.json", url: `${source}/${id}.onnx.json`, bytes: sizes[1], sha256: hashes[1] },
    { name: "MODEL_CARD", url: `${source}/MODEL_CARD`, bytes: sizes[2], sha256: hashes[2] }
  ];
  const dataset = directory.split("/").slice(1, -1).join("/");
  return Object.freeze({ id, label, locale, revision, sampleRate: 22_050,
    provenance: Object.freeze({
      modelCardUrl: `${source}/MODEL_CARD`, datasetUrl: `https://github.com/OHF-Voice/voice-datasets/tree/master/${dataset}`,
      datasetLicense: "CC0-1.0",
      baseModelCardUrl: `${repository}/resolve/${revision}/nl/nl_BE/rdh/medium/MODEL_CARD`,
      baseDatasetUrl: "https://github.com/r-dh/dutch-vl-tts", baseDatasetLicense: "CC0-1.0", distribution: "upstream_download_only"
    }),
    assets: Object.freeze(assets.map(asset => Object.freeze(asset)))
  });
}

// Weight pins come from the upstream LFS SHA-256 and size at this revision.
// Config and model-card pins are SHA-256 of their raw upstream bytes. Older
// versions of these voices trained from Lessac are excluded by the revision.
export const NEURAL_VOICES = Object.freeze([
  voice("en_US-joe-medium", "Joe", "en-US", "en/en_US/joe/medium", [
    "abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2",
    "7b5f0293c0bf5bda8e377be1696da84af798befeef31038e43beefc01fe858da",
    "4b319248135916e8f5433ce7a9fe5271026b05cb598bab05807b22cb17fd129b"
  ], [63_221_984, 5_465, 423]),
  voice("ru_RU-denis-medium", "Denis", "ru-RU", "ru/ru_RU/denis/medium", [
    "879bc365cb14d1380e3f5ed6044162ccf54c99f6161871569b7f830aec3ce841",
    "e4fb4ab60262d1ab802c8c39301976c4135e545bc834a33c6eedc1f764df3bd6",
    "917110d5056810771fd3daea2644bbadf1341816b7631f2043b33be245903432"
  ], [63_221_984, 5_464, 418])
]);
