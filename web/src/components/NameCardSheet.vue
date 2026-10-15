<script setup lang="ts">
import { onMounted, ref } from 'vue';
import mark from '../assets/brand/masterapp-mark.svg';
import { inWeChat } from '../device';
import { t } from '../i18n';
import BottomSheet from './BottomSheet.vue';

/**
 * 名片圖: the driver's card as a square picture with a QR code to their 名片頁, for where a link
 * shows no preview (WeChat, 朋友圈, 小紅書). Drawn here on the phone with its own fonts, so nothing
 * goes to the server. WeChat cannot save a download, so there the picture is shown to long-press.
 * The layout is the square one approved on 2026-10-15 (docs/DESIGN.md, 名片圖).
 */
const props = defineProps<{
  name: string;
  /** 「7座埃爾法・兩地牌」: as the public page shows it, never a plate number. */
  vehicle: string | null;
  languages: string[];
  completedTrips: number;
  photoUrl: string | null;
  url: string;
  published: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const SIZE = 1080;
const PHOTO_HEIGHT = 600;
const FONT = "-apple-system, 'PingFang TC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft JhengHei', 'Noto Sans CJK TC', sans-serif";
const picture = ref('');
const failed = ref(false);

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/** A line cut to fit `max`, ending in an ellipsis. */
function fit(context: CanvasRenderingContext2D, text: string, max: number) {
  if (context.measureText(text).width <= max) return text;
  let out = '';
  for (const char of text) {
    if (context.measureText(`${out}${char}…`).width > max) break;
    out += char;
  }
  return `${out}…`;
}

/** A rounded box drawn by hand: older WeChat browsers have no CanvasRenderingContext2D.roundRect. */
function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

async function draw() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  const brand = c.createLinearGradient(0, 0, SIZE, PHOTO_HEIGHT);
  brand.addColorStop(0, '#1f5fd6');
  brand.addColorStop(1, '#0e9f9a');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, SIZE, SIZE);

  // The top: the car photo cropped to fill, or the first character of the name on the brand colours.
  const photo = props.photoUrl ? await load(props.photoUrl).catch(() => null) : null;
  if (photo) {
    const scale = Math.max(SIZE / photo.width, PHOTO_HEIGHT / photo.height);
    const width = photo.width * scale;
    const height = photo.height * scale;
    // Clipped to the top: a portrait photo scaled to the width is taller than the space, and would
    // otherwise run down over the name and the QR code (seen in WeChat, 2026-10-15).
    c.save();
    c.beginPath();
    c.rect(0, 0, SIZE, PHOTO_HEIGHT);
    c.clip();
    c.drawImage(photo, (SIZE - width) / 2, (PHOTO_HEIGHT - height) / 2, width, height);
    c.restore();
    const shade = c.createLinearGradient(0, PHOTO_HEIGHT * 0.6, 0, PHOTO_HEIGHT);
    shade.addColorStop(0, 'rgba(10, 20, 35, 0)');
    shade.addColorStop(1, 'rgba(10, 20, 35, 0.4)');
    c.fillStyle = shade;
    c.fillRect(0, PHOTO_HEIGHT * 0.6, SIZE, PHOTO_HEIGHT * 0.4);
  } else {
    c.fillStyle = brand;
    c.fillRect(0, 0, SIZE, PHOTO_HEIGHT);
    c.beginPath();
    c.arc(SIZE / 2, PHOTO_HEIGHT / 2, 170, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.16)';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `800 190px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText([...props.name.trim()][0] ?? t('師'), SIZE / 2, PHOTO_HEIGHT / 2 + 8);
    c.textAlign = 'left';
  }

  // The bottom left: who, their car and languages, how many they have done, and whose card this is.
  // No routes: 名片頁 dropped them on 2026-10-14.
  const left = 56;
  const column = 640;
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#0e9f9a';
  c.font = `800 32px ${FONT}`;
  c.fillText(t('司機名片'), left, 682);
  c.fillStyle = '#142033';
  c.font = `800 84px ${FONT}`;
  c.fillText(fit(c, props.name, column), left, 776);
  let y = 776;
  const facts = [props.vehicle, props.languages.length ? `會說${props.languages.join('、')}` : null].filter(Boolean).join('・');
  if (facts) {
    y += 56;
    c.fillStyle = '#34445a';
    c.font = `700 32px ${FONT}`;
    c.fillText(fit(c, t(facts), column), left, y);
  }
  if (props.completedTrips > 0) {
    y += 30;
    c.font = `700 30px ${FONT}`;
    const label = t(`已在師傅幫完成 ${props.completedTrips} 張`);
    const width = c.measureText(label).width + 40;
    roundRect(c, left, y, width, 56, 28);
    c.fillStyle = '#fff3d6';
    c.fill();
    c.fillStyle = '#8a5a00';
    c.fillText(label, left + 20, y + 39);
  }
  roundRect(c, left, 976, 48, 48, 14);
  c.fillStyle = brand;
  c.fill();
  const logo = await load(mark).catch(() => null);
  if (logo) c.drawImage(logo, left + 8, 976 + 9, 32, 32 * (38 / 50));
  c.fillStyle = '#556579';
  c.font = `700 30px ${FONT}`;
  c.fillText(`${t('跨境師傅幫')}・MasterDriver`, left + 64, 1011);

  // The bottom right: the QR code to the 名片頁, with what scanning it does.
  const { toCanvas } = await import('qrcode');
  const qr = document.createElement('canvas');
  await toCanvas(qr, props.url, { width: 252, margin: 1, color: { dark: '#142033', light: '#ffffff' }, errorCorrectionLevel: 'M' });
  roundRect(c, 776, 640, 268, 268, 20);
  c.fillStyle = '#ffffff';
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#d3dce7';
  c.stroke();
  c.drawImage(qr, 784, 648, 252, 252);
  c.fillStyle = '#1f5fd6';
  c.font = `800 32px ${FONT}`;
  c.textAlign = 'center';
  c.fillText(t('掃碼預約'), 910, 958);
  c.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

onMounted(async () => {
  try {
    picture.value = await draw();
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <BottomSheet :title="t('你的名片圖')" @close="emit('close')">
    <p class="name-card__lead">{{ t('傳給熟客、發朋友圈或小紅書；客人掃碼就能打開你的名片頁預約。') }}</p>
    <p v-if="!published" class="notice name-card__warn">{{ t('名片頁還沒公開，客人掃碼會打不開。公開後再傳出去。') }}</p>
    <img v-if="picture" class="name-card__picture" :src="picture" :alt="t('名片圖')" />
    <p v-else-if="failed" class="notice error">{{ t('名片圖做不出來，請重新打開這一頁再試。') }}</p>
    <p v-else class="name-card__loading" role="status">{{ t('製作中…') }}</p>
    <p v-if="picture && inWeChat" class="name-card__hint">{{ t('長按圖片 → 儲存圖片') }}</p>
    <a v-if="picture && !inWeChat" class="button block name-card__save" :href="picture" :download="`${t('名片圖')}.png`">{{ t('下載圖片') }}</a>
  </BottomSheet>
</template>

<style scoped>
.name-card__lead {
  margin: 0 0 var(--space-md);
  color: var(--color-text-secondary);
}
.name-card__warn {
  margin-bottom: var(--space-md);
}
/* Shown at its own square proportions; in WeChat a long press on it saves it. */
.name-card__picture {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  -webkit-touch-callout: default;
}
.name-card__loading {
  padding: var(--space-xl) 0;
  color: var(--color-text-secondary);
  text-align: center;
}
.name-card__hint {
  margin: var(--space-md) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-weight: 700;
  text-align: center;
}
.name-card__save {
  margin-top: var(--space-md);
}
</style>
