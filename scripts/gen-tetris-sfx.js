// 把 miniprogram/utils/tetris-sfx.js 合成的木头音效导出成 mp3,
// 作为不支持 WebAudio 时的兜底(页面里有 WebAudio 会直接现场合成,不读这些文件)。
// 用法:node scripts/gen-tetris-sfx.js   (需要本机有 ffmpeg,带 libmp3lame)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderSfx } = require('../miniprogram/utils/tetris-sfx.js');

const NAMES = ['lock', 'harddrop', 'clear1', 'clear2', 'clear3', 'clear4'];
const SR = 44100;
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'assets', 'sounds');

function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tetris-sfx-'));
NAMES.forEach(name => {
  const wav = path.join(tmp, `${name}.wav`);
  const mp3 = path.join(OUT_DIR, `tetris-${name}.mp3`);
  fs.writeFileSync(wav, toWav(renderSfx(name, SR)));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '96k', mp3]);
  console.log(`${path.relative(process.cwd(), mp3)}  ${fs.statSync(mp3).size} bytes`);
});
fs.rmSync(tmp, { recursive: true, force: true });
