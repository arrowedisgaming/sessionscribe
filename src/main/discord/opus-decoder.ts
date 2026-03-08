/**
 * Session Scribe — Opus Decoder Wrapper
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 *
 * Tries @discordjs/opus (native, fast) first, falls back to opusscript (pure JS).
 */

let OpusEncoderClass: new (rate: number, channels: number) => { decode: (buf: Buffer) => Buffer; delete?: () => void };

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nativeOpus = require('@discordjs/opus');
  OpusEncoderClass = nativeOpus.OpusEncoder || nativeOpus.default?.OpusEncoder;
  if (!OpusEncoderClass) throw new Error('No OpusEncoder export');
  console.log('Using @discordjs/opus (native)');
} catch {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const OpusScript = require('opusscript');
  // opusscript has a different API — wrap it
  OpusEncoderClass = class OpusScriptWrapper {
    private opus: { decode: (buf: Buffer) => Buffer };
    constructor(sampleRate: number, channels: number) {
      this.opus = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO);
    }
    decode(buf: Buffer): Buffer {
      return Buffer.from(this.opus.decode(buf));
    }
  } as unknown as typeof OpusEncoderClass;
  console.log('Using opusscript (pure JS fallback)');
}

export class OpusDecoder {
  private encoder: { decode: (buf: Buffer) => Buffer; delete?: () => void };
  private outputChannels: number;

  constructor(sampleRate: number, outputChannels: number) {
    // Discord sends stereo Opus — always decode as 2 channels
    this.encoder = new OpusEncoderClass(sampleRate, 2);
    this.outputChannels = outputChannels;
  }

  decode(opusPacket: Buffer): Buffer {
    const pcm = this.encoder.decode(opusPacket);

    // If caller wants mono, downmix stereo → mono by averaging L+R
    if (this.outputChannels === 1) {
      const sampleCount = pcm.length / 4; // 2 bytes/sample * 2 channels
      const mono = Buffer.alloc(sampleCount * 2);
      for (let i = 0; i < sampleCount; i++) {
        const left = pcm.readInt16LE(i * 4);
        const right = pcm.readInt16LE(i * 4 + 2);
        mono.writeInt16LE(Math.round((left + right) / 2), i * 2);
      }
      return mono;
    }

    return pcm;
  }

  destroy(): void {
    if (this.encoder.delete) {
      this.encoder.delete();
    }
  }
}
