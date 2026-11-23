import sampleAmberSerumUrl from '../assets/images/sample_amber_serum_1795252637327.jpg';
import sampleCobaltVaseUrl from '../assets/images/sample_cobalt_vase_1795252638093.jpg';
import sampleHeadphonesUrl from '../assets/images/sample_studio_headphones_1795252638371.jpg';

/**
 * High-resolution studio backdrops and real photorealistic sample test images.
 * Local assets bundled directly into the app with procedural fallback.
 */

export interface BackdropPreset {
  id: string;
  name: string;
  previewCss: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

export interface SampleSubjectPreset {
  id: string;
  name: string;
  subtitle: string;
  filename: string;
  previewUrl: string;
  fallbackGradient: string;
  renderToBlob: () => Promise<Blob>;
}

async function fetchImageAssetBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

const backdropCanvasCache = new Map<string, HTMLCanvasElement>();

export const BACKDROP_PRESETS: BackdropPreset[] = [
  {
    id: 'travertine-stone',
    name: 'Travertine Studio',
    previewCss: 'linear-gradient(155deg, #EAE3D7 0%, #D9CEBC 58%, #C4B49C 100%)',
    render(ctx, w, h) {
      // Soft limestone wall + pedestal horizon
      const wallGrad = ctx.createLinearGradient(0, 0, w, h * 0.72);
      wallGrad.addColorStop(0, '#EFE9DF');
      wallGrad.addColorStop(0.55, '#DDD2C1');
      wallGrad.addColorStop(1, '#CBBCA6');
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, w, h);

      // Floor / stone table surface
      const floorY = h * 0.7;
      const floorGrad = ctx.createLinearGradient(0, floorY, 0, h);
      floorGrad.addColorStop(0, '#D4C7B4');
      floorGrad.addColorStop(1, '#B8A68E');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, floorY, w, h - floorY);

      // Subtle architectural sunlight beams
      ctx.save();
      ctx.globalAlpha = 0.22;
      const sunGrad = ctx.createLinearGradient(w * 0.1, 0, w * 0.7, h * 0.9);
      sunGrad.addColorStop(0, '#FFFDF7');
      sunGrad.addColorStop(1, 'rgba(255, 250, 235, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, 0);
      ctx.lineTo(w * 0.42, 0);
      ctx.lineTo(w * 0.85, h);
      ctx.lineTo(w * 0.35, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Fine travertine mineral grain
      ctx.save();
      ctx.globalAlpha = 0.045;
      for (let i = 0; i < 650; i++) {
        const rx = ((i * 7919) % 1000) / 1000 * w;
        const ry = ((i * 6271) % 1000) / 1000 * h;
        const rw = 8 + ((i * 17) % 45);
        const rh = 1.5 + ((i * 7) % 3);
        ctx.fillStyle = i % 2 === 0 ? '#6E5D46' : '#FFFDF9';
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.restore();
    },
  },
  {
    id: 'cyclorama-soft',
    name: 'Studio Cyclorama',
    previewCss: 'radial-gradient(circle at 50% 35%, #F8FAFC 0%, #CBD5E1 65%, #94A3B8 100%)',
    render(ctx, w, h) {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.36, w * 0.04, w * 0.5, h * 0.5, w * 0.78);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.45, '#E2E8F0');
      grad.addColorStop(0.85, '#B6C2D1');
      grad.addColorStop(1, '#8D9BAE');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle floor sweep curve
      const sweep = ctx.createLinearGradient(0, h * 0.68, 0, h);
      sweep.addColorStop(0, 'rgba(15, 23, 42, 0)');
      sweep.addColorStop(0.5, 'rgba(15, 23, 42, 0.06)');
      sweep.addColorStop(1, 'rgba(15, 23, 42, 0.14)');
      ctx.fillStyle = sweep;
      ctx.fillRect(0, h * 0.68, w, h * 0.32);
    },
  },
  {
    id: 'midnight-studio',
    name: 'Obsidian Spotlight',
    previewCss: 'radial-gradient(circle at 50% 38%, #2B3045 0%, #13151F 60%, #090A0F 100%)',
    render(ctx, w, h) {
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.38, w * 0.02, w * 0.5, h * 0.45, w * 0.75);
      bg.addColorStop(0, '#303652');
      bg.addColorStop(0.45, '#171A27');
      bg.addColorStop(1, '#090A0F');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Soft floor reflection ellipse
      const floor = ctx.createRadialGradient(w * 0.5, h * 0.78, w * 0.02, w * 0.5, h * 0.78, w * 0.42);
      floor.addColorStop(0, 'rgba(139, 110, 255, 0.16)');
      floor.addColorStop(0.6, 'rgba(99, 102, 241, 0.05)');
      floor.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);
    },
  },
  {
    id: 'botanical-bokeh',
    name: 'Warm Bokeh',
    previewCss: 'linear-gradient(135deg, #2C4A3E 0%, #5B7C64 48%, #D9B98B 100%)',
    render(ctx, w, h) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#1F3A32');
      bg.addColorStop(0.5, '#466B56');
      bg.addColorStop(1, '#C5A276');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Soft defocused light circles
      const circles = [
        [0.18, 0.22, 0.16, 'rgba(255, 244, 214, 0.22)'],
        [0.78, 0.28, 0.22, 'rgba(255, 232, 185, 0.24)'],
        [0.62, 0.72, 0.19, 'rgba(232, 247, 224, 0.15)'],
        [0.25, 0.78, 0.24, 'rgba(18, 42, 34, 0.35)'],
        [0.84, 0.76, 0.14, 'rgba(255, 220, 160, 0.2)'],
        [0.45, 0.18, 0.11, 'rgba(255, 255, 240, 0.18)'],
      ] as const;

      for (const [cx, cy, r, col] of circles) {
        const g = ctx.createRadialGradient(w * cx, h * cy, 0, w * cx, h * cy, w * r);
        g.addColorStop(0, col);
        g.addColorStop(0.7, col.replace(/[\d.]+\)$/, '0.06)'));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(w * cx, h * cy, w * r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'sunset-silk',
    name: 'Editorial Coral',
    previewCss: 'linear-gradient(145deg, #2D1B3D 0%, #8E3A59 50%, #F29C6B 100%)',
    render(ctx, w, h) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#241634');
      grad.addColorStop(0.45, '#7F3254');
      grad.addColorStop(0.82, '#DF7A5E');
      grad.addColorStop(1, '#F6B682');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(w * 0.72, h * 0.26, 0, w * 0.72, h * 0.26, w * 0.5);
      glow.addColorStop(0, 'rgba(255, 232, 198, 0.32)');
      glow.addColorStop(1, 'rgba(255, 232, 198, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sky-architecture',
    name: 'Nordic Daylight',
    previewCss: 'linear-gradient(160deg, #DBEAFE 0%, #EFF6FF 52%, #E2E8F0 100%)',
    render(ctx, w, h) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#CFE2FA');
      grad.addColorStop(0.55, '#EFF5FC');
      grad.addColorStop(1, '#D6DEE8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Architectural window light mullions shadow
      ctx.save();
      ctx.fillStyle = 'rgba(30, 58, 138, 0.05)';
      ctx.beginPath();
      ctx.moveTo(w * 0.55, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(w * 0.28, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },
];

export function getBackdropCanvas(presetId: string): HTMLCanvasElement | null {
  const existing = backdropCanvasCache.get(presetId);
  if (existing) return existing;

  const preset = BACKDROP_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    preset.render(ctx, canvas.width, canvas.height);
  }
  backdropCanvasCache.set(presetId, canvas);
  return canvas;
}

export const SOLID_SWATCHES = [
  '#FFFFFF',
  '#F4F1EA',
  '#111318',
  '#7C5CFF',
  '#2563EB',
  '#0D9488',
  '#E11D48',
  '#F59E0B',
];

export const GRADIENT_PRESETS = [
  { name: 'Indigo Rose', type: 'linear' as const, angle: 135, color1: '#4F46E5', color2: '#EC4899' },
  { name: 'Studio Silver', type: 'radial' as const, angle: 180, color1: '#F8FAFC', color2: '#94A3B8' },
  { name: 'Warm Sunset', type: 'linear' as const, angle: 135, color1: '#F97316', color2: '#DB2777' },
  { name: 'Ocean Depth', type: 'linear' as const, angle: 150, color1: '#0F172A', color2: '#0284C7' },
  { name: 'Emerald Mist', type: 'linear' as const, angle: 135, color1: '#065F46', color2: '#34D399' },
  { name: 'Sand & Cream', type: 'linear' as const, angle: 165, color1: '#FEF3C7', color2: '#D6B892' },
];

/**
 * Generates crisp high-res studio test scenes so users can immediately test
 * ONNX background removal, manual brush refinement, backdrops, and batch ZIP.
 */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode sample image'));
    }, 'image/png');
  });
}

export const SAMPLE_SUBJECTS: SampleSubjectPreset[] = [
  {
    id: 'amber-serum',
    name: 'Amber Serum Bottle',
    subtitle: 'Product packshot · Travertine',
    filename: 'Amber_Serum_Packshot.jpg',
    previewUrl: sampleAmberSerumUrl,
    fallbackGradient: 'linear-gradient(145deg, #6E543C 0%, #B88746 55%, #3C2C1E 100%)',
    async renderToBlob() {
      const realBlob = await fetchImageAssetBlob(sampleAmberSerumUrl);
      if (realBlob) return realBlob;
      const w = 1024;
      const h = 1024;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;

      // Warm bathroom/vanity background with depth and bokeh
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#5A4A3A');
      bg.addColorStop(0.55, '#8A745C');
      bg.addColorStop(1, '#3D3126');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Background out-of-focus foliage & warm tiles
      const bokeh = [
        [180, 210, 170, 'rgba(65, 92, 62, 0.65)'],
        [840, 240, 210, 'rgba(255, 232, 189, 0.35)'],
        [240, 440, 140, 'rgba(42, 66, 44, 0.55)'],
        [770, 520, 160, 'rgba(195, 162, 118, 0.45)'],
      ] as const;
      for (const [bx, by, br, col] of bokeh) {
        const g = ctx.createRadialGradient(bx, by, 10, bx, by, br);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // Marble counter surface
      const tableGrad = ctx.createLinearGradient(0, 740, 0, h);
      tableGrad.addColorStop(0, '#E2D4C0');
      tableGrad.addColorStop(0.5, '#CBB89E');
      tableGrad.addColorStop(1, '#9E886D');
      ctx.fillStyle = tableGrad;
      ctx.fillRect(0, 740, w, h - 740);

      // Contact shadow on counter
      const contact = ctx.createRadialGradient(512, 855, 20, 512, 855, 195);
      contact.addColorStop(0, 'rgba(20, 12, 6, 0.58)');
      contact.addColorStop(1, 'rgba(20, 12, 6, 0)');
      ctx.fillStyle = contact;
      ctx.beginPath();
      ctx.ellipse(512, 855, 195, 42, 0, 0, Math.PI * 2);
      ctx.fill();

      // Dropper bulb (top)
      const bulbGrad = ctx.createLinearGradient(468, 155, 556, 265);
      bulbGrad.addColorStop(0, '#F5EFE6');
      bulbGrad.addColorStop(0.55, '#DFD2C0');
      bulbGrad.addColorStop(1, '#AE9D87');
      ctx.fillStyle = bulbGrad;
      ctx.beginPath();
      ctx.roundRect(470, 155, 84, 130, [42, 42, 8, 8]);
      ctx.fill();

      // Metallic gold collar
      const collarGrad = ctx.createLinearGradient(446, 275, 578, 275);
      collarGrad.addColorStop(0, '#8A6623');
      collarGrad.addColorStop(0.28, '#F6DA8B');
      collarGrad.addColorStop(0.52, '#C89B3C');
      collarGrad.addColorStop(0.8, '#FCE49E');
      collarGrad.addColorStop(1, '#7C5A1C');
      ctx.fillStyle = collarGrad;
      ctx.beginPath();
      ctx.roundRect(446, 274, 132, 64, 10);
      ctx.fill();

      // Collar fine ribs
      ctx.strokeStyle = 'rgba(65, 42, 10, 0.28)';
      ctx.lineWidth = 2;
      for (let x = 456; x <= 568; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 280);
        ctx.lineTo(x, 332);
        ctx.stroke();
      }

      // Glass bottle shoulder + body
      const bodyGrad = ctx.createLinearGradient(355, 340, 669, 340);
      bodyGrad.addColorStop(0, '#4E2608');
      bodyGrad.addColorStop(0.16, '#B86A1E');
      bodyGrad.addColorStop(0.35, '#F0B254');
      bodyGrad.addColorStop(0.55, '#B05B14');
      bodyGrad.addColorStop(0.82, '#E49B38');
      bodyGrad.addColorStop(1, '#3D1B05');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(458, 338);
      ctx.lineTo(566, 338);
      ctx.quadraticCurveTo(664, 372, 668, 456);
      ctx.lineTo(668, 818);
      ctx.quadraticCurveTo(668, 862, 618, 862);
      ctx.lineTo(406, 862);
      ctx.quadraticCurveTo(356, 862, 356, 818);
      ctx.lineTo(356, 456);
      ctx.quadraticCurveTo(360, 372, 458, 338);
      ctx.closePath();
      ctx.fill();

      // Thick glass bottom reflection
      const baseGlass = ctx.createLinearGradient(0, 815, 0, 862);
      baseGlass.addColorStop(0, 'rgba(255, 224, 155, 0.25)');
      baseGlass.addColorStop(1, 'rgba(35, 14, 3, 0.72)');
      ctx.fillStyle = baseGlass;
      ctx.beginPath();
      ctx.roundRect(360, 812, 304, 48, [0, 0, 42, 42]);
      ctx.fill();

      // Vertical specular highlight on bottle glass
      const spec = ctx.createLinearGradient(382, 400, 425, 400);
      spec.addColorStop(0, 'rgba(255,255,255,0)');
      spec.addColorStop(0.5, 'rgba(255,248,230,0.48)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(382, 398, 42, 422);

      // Minimal luxury paper label
      const labelGrad = ctx.createLinearGradient(380, 470, 644, 470);
      labelGrad.addColorStop(0, '#DDD3C2');
      labelGrad.addColorStop(0.25, '#FAF6EE');
      labelGrad.addColorStop(0.75, '#F3ECE0');
      labelGrad.addColorStop(1, '#CFC2AE');
      ctx.fillStyle = labelGrad;
      ctx.beginPath();
      ctx.roundRect(380, 476, 264, 294, 4);
      ctx.fill();

      // Crisp label typography
      ctx.fillStyle = '#2A2118';
      ctx.textAlign = 'center';
      ctx.font = '600 32px Georgia, serif';
      ctx.fillText('SOLARIS', 512, 558);

      ctx.strokeStyle = '#B89352';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(452, 578);
      ctx.lineTo(572, 578);
      ctx.stroke();

      ctx.fillStyle = '#5E4F3D';
      ctx.font = '500 16px sans-serif';
      ctx.fillText('BOTANICAL ELIXIR', 512, 612);
      ctx.fillStyle = '#857461';
      ctx.font = '400 13px sans-serif';
      ctx.fillText('COLD PRESSED VITAMIN C', 512, 640);
      ctx.fillText('50 ML / 1.7 FL OZ', 512, 738);

      return canvasToPngBlob(c);
    },
  },
  {
    id: 'ceramic-vase',
    name: 'Sculptural Vase',
    subtitle: 'Cobalt ceramic · Botanicals',
    filename: 'Cobalt_Ceramic_Vase.jpg',
    previewUrl: sampleCobaltVaseUrl,
    fallbackGradient: 'linear-gradient(145deg, #1E3A8A 0%, #3B82F6 50%, #D6C7B2 100%)',
    async renderToBlob() {
      const realBlob = await fetchImageAssetBlob(sampleCobaltVaseUrl);
      if (realBlob) return realBlob;
      const w = 1024;
      const h = 1024;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;

      // Sunlit gallery wall backdrop
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#E8DFD1');
      bg.addColorStop(0.62, '#D8CBB8');
      bg.addColorStop(1, '#B4A28C');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Diagonal window shadow bar
      ctx.fillStyle = 'rgba(62, 52, 40, 0.14)';
      ctx.beginPath();
      ctx.moveTo(0, 120);
      ctx.lineTo(w, 420);
      ctx.lineTo(w, 600);
      ctx.lineTo(0, 300);
      ctx.closePath();
      ctx.fill();

      // Oak surface
      const desk = ctx.createLinearGradient(0, 770, 0, h);
      desk.addColorStop(0, '#9E7B56');
      desk.addColorStop(1, '#6B4F33');
      ctx.fillStyle = desk;
      ctx.fillRect(0, 770, w, h - 770);

      // Soft cast shadow
      const sh = ctx.createRadialGradient(545, 860, 15, 545, 860, 210);
      sh.addColorStop(0, 'rgba(24, 16, 10, 0.52)');
      sh.addColorStop(1, 'rgba(24, 16, 10, 0)');
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.ellipse(545, 860, 210, 44, 0, 0, Math.PI * 2);
      ctx.fill();

      // Botanical eucalyptus stem peeking out
      ctx.strokeStyle = '#335946';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(512, 340);
      ctx.quadraticCurveTo(545, 220, 610, 130);
      ctx.stroke();

      const leaves = [
        [548, 250, -0.45, 36, 22],
        [578, 200, 0.55, 34, 20],
        [604, 148, -0.3, 30, 19],
        [524, 285, 0.7, 32, 19],
      ] as const;
      for (const [lx, ly, rot, rx, ry] of leaves) {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rot);
        ctx.fillStyle = '#4B7A62';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Cobalt glazed sculptural ceramic vase
      const vaseGrad = ctx.createLinearGradient(315, 340, 705, 860);
      vaseGrad.addColorStop(0, '#102A63');
      vaseGrad.addColorStop(0.28, '#2C5CE0');
      vaseGrad.addColorStop(0.55, '#1D42B0');
      vaseGrad.addColorStop(0.84, '#0E245E');
      vaseGrad.addColorStop(1, '#081538');
      ctx.fillStyle = vaseGrad;

      ctx.beginPath();
      ctx.moveTo(456, 300);
      ctx.lineTo(568, 300);
      ctx.bezierCurveTo(564, 410, 698, 490, 692, 650);
      ctx.bezierCurveTo(686, 780, 616, 855, 586, 862);
      ctx.lineTo(438, 862);
      ctx.bezierCurveTo(408, 855, 338, 780, 332, 650);
      ctx.bezierCurveTo(326, 490, 460, 410, 456, 300);
      ctx.closePath();
      ctx.fill();

      // Glaze rim ellipse
      ctx.fillStyle = '#0D1E4D';
      ctx.beginPath();
      ctx.ellipse(512, 300, 56, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // Ceramic studio light sheen
      const sheen = ctx.createRadialGradient(428, 570, 10, 442, 590, 145);
      sheen.addColorStop(0, 'rgba(196, 224, 255, 0.62)');
      sheen.addColorStop(0.45, 'rgba(130, 178, 255, 0.16)');
      sheen.addColorStop(1, 'rgba(130, 178, 255, 0)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.ellipse(438, 592, 64, 155, -0.18, 0, Math.PI * 2);
      ctx.fill();

      return canvasToPngBlob(c);
    },
  },
  {
    id: 'studio-headphones',
    name: 'Studio Headphones',
    subtitle: 'Matte audio · Dark slate',
    filename: 'Studio_Headphones_Gear.jpg',
    previewUrl: sampleHeadphonesUrl,
    fallbackGradient: 'linear-gradient(145deg, #1E2432 0%, #39445B 55%, #11141C 100%)',
    async renderToBlob() {
      const realBlob = await fetchImageAssetBlob(sampleHeadphonesUrl);
      if (realBlob) return realBlob;
      const w = 1024;
      const h = 1024;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;

      // Studio gradient background with warm desk clutter hint
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#2A3548');
      bg.addColorStop(0.55, '#465872');
      bg.addColorStop(1, '#1F2838');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle architectural grid wall lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      for (let i = 0; i < w; i += 96) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }

      // Headband outer arch
      ctx.strokeStyle = '#181A20';
      ctx.lineWidth = 54;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(512, 510, 265, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();

      // Headband metallic highlight
      ctx.strokeStyle = '#4B5263';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(512, 510, 282, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Metal yokes
      ctx.strokeStyle = '#D1D5DB';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(255, 495);
      ctx.lineTo(270, 610);
      ctx.moveTo(769, 495);
      ctx.lineTo(754, 610);
      ctx.stroke();

      // Left & Right earcups
      const drawCup = (cx: number, cy: number, side: -1 | 1) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(side * -0.12);

        // Outer metallic cup shell
        const cupGrad = ctx.createLinearGradient(-70, -110, 70, 110);
        cupGrad.addColorStop(0, '#2B2F3B');
        cupGrad.addColorStop(0.4, '#4C5264');
        cupGrad.addColorStop(1, '#15171E');
        ctx.fillStyle = cupGrad;
        ctx.beginPath();
        ctx.ellipse(side * -22, 0, 64, 138, 0, 0, Math.PI * 2);
        ctx.fill();

        // Accent copper ring
        ctx.strokeStyle = '#D97757';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(side * -30, 0, 44, 102, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Soft leather ear cushion
        const padGrad = ctx.createLinearGradient(-45, 0, 45, 0);
        padGrad.addColorStop(0, '#111217');
        padGrad.addColorStop(0.5, '#252832');
        padGrad.addColorStop(1, '#0C0D11');
        ctx.fillStyle = padGrad;
        ctx.beginPath();
        ctx.ellipse(side * 24, 0, 46, 132, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      };

      drawCup(300, 665, -1);
      drawCup(724, 665, 1);

      return canvasToPngBlob(c);
    },
  },
];
