const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "social", "instagram", "viral-series-01");
const logoPath = path.join(root, "assets", "nakar-logo-transparent.png");
const audioPath = path.join(root, "social", "instagram", "nakar-game-beat.wav");
const ffmpegPath = path.join(
  root,
  ".codex-video-tools",
  "imageio_ffmpeg",
  "binaries",
  "ffmpeg-win-x86_64-v7.1.exe",
);

const W = 720;
const H = 1280;
const FPS = 24;
const DURATION = 12;
const FRAME_COUNT = FPS * DURATION;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = (value) => 1 - Math.pow(1 - clamp(value), 3);
const easeInOut = (value) => {
  const v = clamp(value);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function fade(t, start, end, edge = 0.28) {
  return clamp(Math.min((t - start) / edge, (end - t) / edge));
}

function base(t, index, accent = "#9b7bff") {
  const drift = Math.sin(t * 0.72) * 54;
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2.15);
  let dots = "";
  for (let i = 0; i < 28; i++) {
    const x = (i * 149 + 37) % W;
    const y = (i * 227 + 91 + t * (6 + (i % 4) * 3)) % H;
    const r = 0.8 + (i % 3) * 0.55;
    dots += `<circle cx="${x}" cy="${y.toFixed(1)}" r="${r}" fill="#ffffff" opacity="${0.025 + (i % 4) * 0.009}"/>`;
  }
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="14%" r="92%">
        <stop offset="0%" stop-color="#24294f"/>
        <stop offset="46%" stop-color="#111528"/>
        <stop offset="100%" stop-color="#070910"/>
      </radialGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${accent}"/><stop offset="100%" stop-color="#c9bbff"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="54"/></filter>
      <filter id="soft"><feGaussianBlur stdDeviation="13"/></filter>
      <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.42"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <circle cx="${110 + drift}" cy="180" r="200" fill="${accent}" opacity="${(0.095 + pulse * 0.025).toFixed(3)}" filter="url(#blur)"/>
    <circle cx="640" cy="1040" r="270" fill="#6d3ee8" opacity="0.085" filter="url(#blur)"/>
    ${dots}
    <rect x="54" y="52" width="148" height="44" rx="22" fill="#15182a" stroke="#3b4060"/>
    <text x="128" y="81" text-anchor="middle" fill="#b6bbd2" font-family="Segoe UI, Arial" font-size="17" font-weight="700" letter-spacing="1.6">MÜZİK TESTİ</text>
    <text x="648" y="82" text-anchor="end" fill="#858ba7" font-family="Segoe UI, Arial" font-size="18" font-weight="700">#0${index}</text>`;
}

function footer(t) {
  const width = 220;
  const x0 = (W - width) / 2;
  let bars = "";
  for (let i = 0; i < 27; i++) {
    const x = x0 + (i / 26) * width;
    const envelope = Math.sin((i / 26) * Math.PI);
    const h = 7 + 26 * envelope * (0.35 + 0.65 * Math.abs(Math.sin(t * 7.1 + i * 0.83)));
    bars += `<rect x="${x.toFixed(1)}" y="${(1192 - h / 2).toFixed(1)}" width="4" height="${h.toFixed(1)}" rx="2" fill="#a98cff" opacity="0.72"/>`;
  }
  return `<text x="360" y="1147" text-anchor="middle" fill="#858ba7" font-family="Segoe UI, Arial" font-size="18" font-weight="650">nakarmusic.com.tr</text>${bars}`;
}

function countdown(t, start, end, x = 360, y = 300) {
  const remaining = Math.max(1, Math.ceil(end - t));
  const progress = clamp((t - start) / (end - start));
  const circumference = 2 * Math.PI * 52;
  return `<g>
    <circle cx="${x}" cy="${y}" r="52" fill="#15182a" stroke="#343956" stroke-width="9"/>
    <circle cx="${x}" cy="${y}" r="52" fill="none" stroke="#a78bfa" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${(circumference * progress).toFixed(1)}" transform="rotate(-90 ${x} ${y})"/>
    <text x="${x}" y="${y + 15}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="44" font-weight="800">${remaining}</text>
  </g>`;
}

function personIcon(x, y) {
  return `<circle cx="${x}" cy="${y - 34}" r="24" fill="#d9d1ff"/>
    <path d="M${x - 53} ${y + 57} C${x - 49} ${y + 3}, ${x - 25} ${y - 1}, ${x} ${y - 1} C${x + 25} ${y - 1}, ${x + 49} ${y + 3}, ${x + 53} ${y + 57} Z" fill="#a78bfa"/>`;
}

function bulbIcon(x, y) {
  return `<circle cx="${x}" cy="${y - 12}" r="39" fill="#d9d1ff" opacity="0.96"/>
    <path d="M${x - 22} ${y + 10} C${x - 17} ${y + 30}, ${x - 13} ${y + 36}, ${x - 13} ${y + 47} L${x + 13} ${y + 47} C${x + 13} ${y + 36}, ${x + 17} ${y + 30}, ${x + 22} ${y + 10} Z" fill="#a78bfa"/>
    <rect x="${x - 12}" y="${y + 51}" width="24" height="8" rx="4" fill="#7f66d9"/>`;
}

function renderEmojiQuiz(t) {
  let svg = base(t, 1);
  const intro = fade(t, 0, 1.65, 0.24);
  const quiz = fade(t, 1.28, 7.38, 0.3);
  const reveal = fade(t, 7.05, 10.5, 0.3);
  const cta = clamp((t - 10.05) / 0.35);

  if (intro > 0) {
    const scale = 0.88 + 0.12 * easeOut(t / 0.65);
    svg += `<g opacity="${intro}" transform="translate(360 520) scale(${scale}) translate(-360 -520)">
      <text x="360" y="420" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="64" font-weight="850">3 İPUCU.</text>
      <text x="360" y="495" text-anchor="middle" fill="url(#accent)" font-family="Segoe UI, Arial" font-size="64" font-weight="850">1 ŞARKI.</text>
      <text x="360" y="565" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="27" font-weight="650">5 saniyede bulabilir misin?</text>
    </g>`;
  }

  if (quiz > 0) {
    const rise = 28 * (1 - easeOut((t - 1.28) / 0.5));
    svg += `<g opacity="${quiz}" transform="translate(0 ${rise.toFixed(1)})">
      ${countdown(t, 1.3, 7.0, 360, 260)}
      <text x="360" y="374" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="23" font-weight="700" letter-spacing="1.3">ŞARKIYI BUL</text>`;
    const tiles = [126, 360, 594];
    for (const x of tiles) {
      svg += `<rect x="${x - 94}" y="430" width="188" height="222" rx="34" fill="#171a2d" stroke="#3a3f5c" stroke-width="2" filter="url(#shadow)"/>`;
    }
    svg += `<text x="126" y="573" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="104" font-weight="850">1</text>
      ${personIcon(360, 535)}
      ${bulbIcon(594, 535)}
      <text x="360" y="742" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="31" font-weight="760">Cevabını söylemeden bekle.</text>
      <text x="360" y="790" text-anchor="middle" fill="#8e94ae" font-family="Segoe UI, Arial" font-size="22">Sonunda doğru cevap geliyor.</text>
    </g>`;
  }

  if (reveal > 0) {
    const pop = 0.82 + 0.18 * easeOut((t - 7.05) / 0.48);
    svg += `<g opacity="${reveal}" transform="translate(360 575) scale(${pop}) translate(-360 -575)">
      <text x="360" y="340" text-anchor="middle" fill="#8e94ae" font-family="Segoe UI, Arial" font-size="21" font-weight="700" letter-spacing="2">DOĞRU CEVAP</text>
      <rect x="64" y="400" width="592" height="325" rx="42" fill="#171a2d" stroke="#9f84ff" stroke-width="3" filter="url(#shadow)"/>
      <circle cx="360" cy="445" r="86" fill="#8b5cf6" opacity="0.14" filter="url(#soft)"/>
      <text x="360" y="532" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="56" font-weight="860">Bİ' TEK BEN</text>
      <text x="360" y="603" text-anchor="middle" fill="url(#accent)" font-family="Segoe UI, Arial" font-size="56" font-weight="860">ANLARIM</text>
      <text x="360" y="678" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="23" font-weight="650">İlk bakışta bildin mi?</text>
    </g>`;
  }

  if (cta > 0) {
    svg += `<g opacity="${cta}">
      <text x="360" y="910" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="34" font-weight="780">Bildiysen yoruma ⚡ bırak.</text>
      <rect x="174" y="965" width="372" height="68" rx="34" fill="#8b5cf6"/>
      <text x="360" y="1009" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="25" font-weight="780">Daha fazlası Nakar'da</text>
    </g>`;
  }

  svg += footer(t) + `</svg>`;
  return svg;
}

function renderMissingLetters(t) {
  let svg = base(t, 2, "#8f78ff");
  const intro = fade(t, 0, 1.55, 0.24);
  const quiz = fade(t, 1.2, 7.48, 0.28);
  const reveal = fade(t, 7.1, 10.45, 0.28);
  const cta = clamp((t - 10.0) / 0.36);

  if (intro > 0) {
    svg += `<g opacity="${intro}">
      <text x="360" y="405" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="56" font-weight="850">EKSİK HARFLERİ</text>
      <text x="360" y="478" text-anchor="middle" fill="url(#accent)" font-family="Segoe UI, Arial" font-size="64" font-weight="850">TAMAMLA.</text>
      <text x="360" y="550" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="26" font-weight="650">Türkçe pop dinleyen bunu bilir.</text>
    </g>`;
  }

  if (quiz > 0) {
    const pattern = ["_", "N", "T", "İ", "_", "E", "P", "R", "_", "S", "A", "N"];
    svg += `<g opacity="${quiz}">
      ${countdown(t, 1.25, 7.0, 360, 260)}
      <text x="360" y="366" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="21" font-weight="700" letter-spacing="1.8">12 HARF · TEK KELİME</text>
      <rect x="50" y="420" width="620" height="318" rx="42" fill="#15182a" stroke="#393e5c" stroke-width="2" filter="url(#shadow)"/>`;
    pattern.forEach((letter, i) => {
      const row = Math.floor(i / 6);
      const col = i % 6;
      const x = 85 + col * 97;
      const y = 468 + row * 118;
      const missing = letter === "_";
      svg += `<rect x="${x}" y="${y}" width="70" height="76" rx="18" fill="${missing ? "#2a2050" : "#20243a"}" stroke="${missing ? "#9f84ff" : "#3a405e"}" stroke-width="2"/>
        <text x="${x + 35}" y="${y + 53}" text-anchor="middle" fill="${missing ? "#a98cff" : "#ffffff"}" font-family="Segoe UI, Arial" font-size="39" font-weight="820">${letter}</text>`;
    });
    svg += `<text x="360" y="820" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="31" font-weight="760">Aklına gelen ilk cevabı tut.</text>
      <text x="360" y="867" text-anchor="middle" fill="#8e94ae" font-family="Segoe UI, Arial" font-size="22">İpucu: Son yılların en çok söylenenlerinden.</text>
    </g>`;
  }

  if (reveal > 0) {
    const sweep = clamp((t - 7.1) / 0.9);
    svg += `<g opacity="${reveal}">
      <text x="360" y="350" text-anchor="middle" fill="#8e94ae" font-family="Segoe UI, Arial" font-size="21" font-weight="700" letter-spacing="2">CEVAP</text>
      <rect x="54" y="420" width="612" height="276" rx="42" fill="#171a2d" stroke="#9f84ff" stroke-width="3" filter="url(#shadow)"/>
      <rect x="82" y="448" width="${(556 * sweep).toFixed(1)}" height="220" rx="28" fill="#8b5cf6" opacity="0.12"/>
      <text x="360" y="575" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="55" font-weight="860" letter-spacing="1.4">ANTİDEPRESAN</text>
      <text x="360" y="640" text-anchor="middle" fill="#b6bbd2" font-family="Segoe UI, Arial" font-size="23" font-weight="650">Kaçıncı saniyede buldun?</text>
    </g>`;
  }

  if (cta > 0) {
    svg += `<g opacity="${cta}">
      <text x="360" y="902" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="33" font-weight="780">Süreni yoruma yaz.</text>
      <rect x="168" y="958" width="384" height="72" rx="36" fill="#8b5cf6"/>
      <text x="360" y="1004" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="25" font-weight="780">Her gün yeni tahmin</text>
    </g>`;
  }

  svg += footer(t) + `</svg>`;
  return svg;
}

function renderPauseRoulette(t) {
  let svg = base(t, 3, "#a07dff");
  const intro = fade(t, 0, 1.7, 0.25);
  const spin = fade(t, 1.35, 8.95, 0.3);
  const cta = clamp((t - 8.55) / 0.35);
  const categories = ["90'LAR", "ARABESK", "TÜRKÇE RAP", "POP", "ROCK", "2000'LER", "YENİ NESİL"];
  const current = categories[Math.floor(Math.max(0, t - 1.35) * 7.8) % categories.length];
  const previous = categories[(categories.indexOf(current) + categories.length - 1) % categories.length];
  const next = categories[(categories.indexOf(current) + 1) % categories.length];

  if (intro > 0) {
    svg += `<g opacity="${intro}">
      <text x="360" y="395" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="59" font-weight="850">EKRANI</text>
      <text x="360" y="468" text-anchor="middle" fill="url(#accent)" font-family="Segoe UI, Arial" font-size="67" font-weight="850">DURDUR.</text>
      <text x="360" y="545" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="26" font-weight="650">Bugünkü müzik kategorin belli olsun.</text>
    </g>`;
  }

  if (spin > 0) {
    const wobble = Math.sin(t * 14) * 4;
    svg += `<g opacity="${spin}">
      <text x="360" y="238" text-anchor="middle" fill="#a9aec5" font-family="Segoe UI, Arial" font-size="23" font-weight="700" letter-spacing="1.6">ŞİMDİ DURDUR</text>
      <path d="M360 305 L335 345 L385 345 Z" fill="#a78bfa"/>
      <rect x="64" y="365" width="592" height="432" rx="44" fill="#15182a" stroke="#3b4060" stroke-width="2" filter="url(#shadow)"/>
      <rect x="88" y="389" width="544" height="384" rx="32" fill="#0e1120"/>
      <text x="360" y="478" text-anchor="middle" fill="#656b85" font-family="Segoe UI, Arial" font-size="28" font-weight="760">${esc(previous)}</text>
      <rect x="104" y="522" width="512" height="116" rx="28" fill="#8b5cf6" opacity="0.22" stroke="#a98cff" stroke-width="2"/>
      <text x="360" y="${(594 + wobble).toFixed(1)}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="48" font-weight="860">${esc(current)}</text>
      <text x="360" y="712" text-anchor="middle" fill="#656b85" font-family="Segoe UI, Arial" font-size="28" font-weight="760">${esc(next)}</text>
      <path d="M360 838 L335 798 L385 798 Z" fill="#a78bfa"/>
      <text x="360" y="930" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="32" font-weight="760">Ne çıktı?</text>
      <text x="360" y="977" text-anchor="middle" fill="#9ba1b9" font-family="Segoe UI, Arial" font-size="23">Yorumda kategorini savun.</text>
    </g>`;
  }

  if (cta > 0) {
    svg += `<g opacity="${cta}">
      <rect x="154" y="1030" width="412" height="70" rx="35" fill="#8b5cf6"/>
      <text x="360" y="1075" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="24" font-weight="780">Arkadaşına da gönder</text>
    </g>`;
  }

  svg += footer(t) + `</svg>`;
  return svg;
}

const videos = [
  { slug: "01-emoji-bi-tek-ben-anlarim", render: renderEmojiQuiz },
  { slug: "02-eksik-harf-antidepresan", render: renderMissingLetters },
  { slug: "03-ekrani-durdur-kategori", render: renderPauseRoulette },
];

async function renderVideo(video, logo) {
  const frameDir = path.join(outputRoot, `${video.slug}-frames`);
  fs.mkdirSync(frameDir, { recursive: true });

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const t = frame / FPS;
    const svg = video.render(t);
    const logoScale = 0.92 + 0.08 * Math.sin(t * 1.8);
    const size = Math.round(76 * logoScale);
    const frameBuffer = await sharp(Buffer.from(svg))
      .composite([{
        input: await sharp(logo).resize(size, size).png().toBuffer(),
        left: Math.round((W - size) / 2),
        top: Math.round(104 - (size - 76) / 2),
      }])
      .jpeg({ quality: 91, chromaSubsampling: "4:2:0" })
      .toBuffer();
    await fs.promises.writeFile(
      path.join(frameDir, `frame-${String(frame + 1).padStart(4, "0")}.jpg`),
      frameBuffer,
    );
    if ((frame + 1) % 72 === 0) {
      console.log(`${video.slug}: ${frame + 1}/${FRAME_COUNT} frames`);
    }
  }

  const outputPath = path.join(outputRoot, `${video.slug}.mp4`);
  const result = spawnSync(ffmpegPath, [
    "-y",
    "-framerate", String(FPS),
    "-i", path.join(frameDir, "frame-%04d.jpg"),
    "-i", audioPath,
    "-t", String(DURATION),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "19",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-af", "afade=t=in:st=0:d=0.18,afade=t=out:st=11.55:d=0.45,volume=0.9",
    "-movflags", "+faststart",
    "-shortest",
    outputPath,
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${video.slug}: ${result.stderr}`);
  }
  console.log(`VIDEO_SAVED ${outputPath}`);
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  if (!fs.existsSync(ffmpegPath)) throw new Error(`ffmpeg not found: ${ffmpegPath}`);
  if (!fs.existsSync(audioPath)) throw new Error(`audio not found: ${audioPath}`);

  const logo = await sharp(logoPath).resize(128, 128).png().toBuffer();
  for (const video of videos) {
    await renderVideo(video, logo);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
