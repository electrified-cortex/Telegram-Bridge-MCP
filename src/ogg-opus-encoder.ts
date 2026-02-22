/**
 * PCM Float32 → OGG/Opus encoder.
 *
 * Uses opusscript (WASM libopus, MIT) for Opus frame encoding and
 * a hand-written OGG container muxer (RFC 3533 + RFC 7845).
 *
 * Zero native compilation required — pure WASM.
 */

import { createRequire } from "module";

// ---------------------------------------------------------------------------
// CRC-32 table — polynomial 0x04C11DB7 in bit-reversed form (RFC 3533 §A)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i;
    for (let j = 0; j < 8; j++) r = r & 1 ? 0xedb88320 ^ (r >>> 1) : r >>> 1;
    t[i] = r;
  }
  return t;
})();

function crc32ogg(data: Buffer): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return crc;
}

// ---------------------------------------------------------------------------
// OGG page builder (RFC 3533 §6)
//
// headerType flags:
//   0x02  = beginning of stream (bos)
//   0x04  = end of stream (eos)
//   0x00  = ordinary interior page
//
// granulePos: sample-accurate position; 0n for header pages.
// Each call encodes exactly one complete packet per page.
// ---------------------------------------------------------------------------

function writeOggPage(
  serialNo: number,
  seqNo: number,
  granulePos: bigint,
  headerType: number,
  packet: Uint8Array,
): Buffer {
  // Lacing table splits packet into 255-byte chunks; last chunk < 255 terminates.
  const lacings: number[] = [];
  let rem = packet.length;
  while (rem >= 255) {
    lacings.push(255);
    rem -= 255;
  }
  lacings.push(rem); // 0–254 — always present; terminates the packet

  const pageLen = 27 + lacings.length + packet.length;
  const page = Buffer.alloc(pageLen, 0);

  page.write("OggS", 0, "ascii"); //  0– 3: capture_pattern
  page[4] = 0; //  4: stream_structure_version
  page[5] = headerType; //  5: header_type_flag
  page.writeBigInt64LE(granulePos, 6); //  6–13: granule_position
  page.writeUInt32LE(serialNo >>> 0, 14); // 14–17: bitstream_serial_number
  page.writeUInt32LE(seqNo >>> 0, 18); // 18–21: page_sequence_no
  // 22–25: CRC — left as 0x00000000 until computed below
  page[26] = lacings.length; // 26: number_page_segments
  for (let i = 0; i < lacings.length; i++) page[27 + i] = lacings[i];

  const dataStart = 27 + lacings.length;
  Buffer.from(packet).copy(page, dataStart);

  page.writeUInt32LE(crc32ogg(page), 22); // fill in CRC
  return page;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encodes mono Float32 PCM to an OGG/Opus buffer (RFC 7845).
 *
 * @param float32          Mono PCM samples in the range [−1, 1].
 * @param inputSampleRate  Sample rate of the input (Hz).
 * @returns Buffer containing a valid OGG/Opus file for Telegram sendVoice.
 */
export async function pcmToOggOpus(float32: Float32Array, inputSampleRate: number): Promise<Buffer> {
  const TARGET_RATE = 48000;
  const CHANNELS = 1;
  const FRAME_SAMPLES = 960; // 20 ms at 48 kHz

  // --- Resample to 48 kHz (linear interpolation) ---
  let pcm: Float32Array;
  if (inputSampleRate === TARGET_RATE) {
    pcm = float32;
  } else {
    const ratio = inputSampleRate / TARGET_RATE;
    const newLen = Math.floor(float32.length / ratio);
    pcm = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) pcm[i] = float32[Math.floor(i * ratio)];
  }

  // --- Float32 [−1,1] → Int16LE (opusscript expects Int16 PCM) ---
  const pcmBytes = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    pcmBytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), i * 2);
  }

  // --- Load opusscript (CJS module) via createRequire for ESM compatibility ---
  const requireCjs = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OpusScript = requireCjs("opusscript") as any;
  const encoder = new OpusScript(TARGET_RATE, CHANNELS, OpusScript.Application.AUDIO);

  const serialNo = (Math.random() * 0xffffffff) | 0;
  const pages: Buffer[] = [];
  let seqNo = 0;

  // --- ID header page (RFC 7845 §5.1) ---
  const head = Buffer.alloc(19, 0);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1; // version = 1
  head[9] = CHANNELS; // channel count
  head.writeUInt16LE(3840, 10); // pre-skip (80 ms standard)
  head.writeUInt32LE(inputSampleRate, 12); // original sample rate (informational)
  head.writeUInt16LE(0, 16); // output gain = 0
  head[18] = 0; // channel mapping family 0
  pages.push(writeOggPage(serialNo, seqNo++, 0n, 0x02, head));

  // --- Comment header page (RFC 7845 §5.2) ---
  const vendor = "opusscript";
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4, 0);
  tags.write("OpusTags", 0, "ascii");
  tags.writeUInt32LE(vendor.length, 8);
  tags.write(vendor, 12, "ascii");
  tags.writeUInt32LE(0, 12 + vendor.length); // zero user comments
  pages.push(writeOggPage(serialNo, seqNo++, 0n, 0x00, tags));

  // --- Audio data pages ---
  const totalSamples = pcm.length;
  const totalFrames = Math.ceil(totalSamples / FRAME_SAMPLES);
  let granulePos = 0n;

  for (let f = 0; f < totalFrames; f++) {
    const byteStart = f * FRAME_SAMPLES * 2;
    const byteEnd = Math.min(byteStart + FRAME_SAMPLES * 2, pcmBytes.length);

    let frameData: Buffer;
    if (byteEnd - byteStart === FRAME_SAMPLES * 2) {
      frameData = pcmBytes.slice(byteStart, byteEnd);
    } else {
      // Pad the last partial frame with silence
      frameData = Buffer.alloc(FRAME_SAMPLES * 2, 0);
      pcmBytes.copy(frameData, 0, byteStart, byteEnd);
    }

    const opus: Buffer = encoder.encode(frameData, FRAME_SAMPLES);
    granulePos += BigInt(FRAME_SAMPLES);

    const isEos = f === totalFrames - 1;
    pages.push(writeOggPage(serialNo, seqNo++, granulePos, isEos ? 0x04 : 0x00, new Uint8Array(opus)));
  }

  encoder.delete(); // free WASM memory

  return Buffer.concat(pages);
}
