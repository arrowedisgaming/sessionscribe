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

  constructor(sampleRate: number, channels: number) {
    this.encoder = new OpusEncoderClass(sampleRate, channels);
  }

  decode(opusPacket: Buffer): Buffer {
    return this.encoder.decode(opusPacket);
  }

  destroy(): void {
    if (this.encoder.delete) {
      this.encoder.delete();
    }
  }
}
