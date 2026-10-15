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
 * Version C (2026-10-15): the top is a fixed frame on the brand colours, the whole car photo fitted
 * in its middle (never cut), the brand above and the car's plate places below (docs/DESIGN.md, 名片圖).
 */
const props = defineProps<{
  name: string;
  /** 「埃爾法・黑」: the car's type and colour; its plates and seats are in the band. */
  vehicle: string | null;
  languages: string[];
  /** Where the plates are from (「香港」「粵Z」), never the numbers, and 「兩地牌・7座」. */
  plateRegions: string[];
  plateLabel: string | null;
  /** The ways to reach them the public page shows, as labels. */
  contacts: { whatsapp: boolean; wechat: boolean; phone: boolean };
  completedTrips: number;
  photoUrl: string | null;
  url: string;
  published: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const SIZE = 1080;
/** The frame at the top: a band for the brand, the photo's space, a band for the plates. */
const FRAME_HEIGHT = 600;
const BAND = 90;
const PHOTO_HEIGHT = FRAME_HEIGHT - BAND * 2;
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
  const brand = c.createLinearGradient(0, 0, SIZE, FRAME_HEIGHT);
  brand.addColorStop(0, '#1f5fd6');
  brand.addColorStop(1, '#0e9f9a');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, SIZE, SIZE);
  c.fillStyle = brand;
  c.fillRect(0, 0, SIZE, FRAME_HEIGHT);
  c.textBaseline = 'alphabetic';

  // The band above: the white cloud M and 跨境師傅幫, centred.
  const logo = await load(mark).catch(() => null);
  c.font = `800 34px ${FONT}`;
  const markText = t('跨境師傅幫');
  const markWidth = 64 + c.measureText(markText).width;
  const markX = (SIZE - markWidth) / 2;
  if (logo) c.drawImage(logo, markX, BAND / 2 - 19, 50, 38);
  c.fillStyle = '#ffffff';
  c.fillText(markText, markX + 64, BAND / 2 + 12);

  // The middle: the whole photo, as large as fits, never cut; or the first character of the name.
  const photo = props.photoUrl ? await load(props.photoUrl).catch(() => null) : null;
  if (photo) {
    const scale = Math.min(SIZE / photo.width, PHOTO_HEIGHT / photo.height);
    const width = photo.width * scale;
    const height = photo.height * scale;
    c.drawImage(photo, (SIZE - width) / 2, BAND + (PHOTO_HEIGHT - height) / 2, width, height);
  } else {
    c.beginPath();
    c.arc(SIZE / 2, FRAME_HEIGHT / 2, 150, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.16)';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `800 170px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText([...props.name.trim()][0] ?? t('師'), SIZE / 2, FRAME_HEIGHT / 2 + 8);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }

  // The band below: the plate places drawn like plates (Hong Kong gold, the others black), and 兩地牌・7座.
  if (props.plateRegions.length || props.plateLabel) {
    c.font = `800 32px ${FONT}`;
    const tags = props.plateRegions.map((region) => ({ region, width: c.measureText(region).width + 40 }));
    c.font = `700 30px ${FONT}`;
    const label = props.plateLabel ? t(props.plateLabel) : '';
    const labelWidth = label ? c.measureText(label).width : 0;
    let x = (SIZE - (tags.reduce((sum, tag) => sum + tag.width + 16, 0) + labelWidth)) / 2;
    const y = FRAME_HEIGHT - BAND / 2 - 28;
    for (const tag of tags) {
      const hk = tag.region === '香港';
      roundRect(c, x, y, tag.width, 56, 10);
      c.fillStyle = hk ? '#f5c518' : '#16191f';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = hk ? 'rgba(23, 23, 23, 0.55)' : 'rgba(255, 255, 255, 0.7)';
      c.stroke();
      c.fillStyle = hk ? '#171717' : '#ffffff';
      c.font = `800 32px ${FONT}`;
      c.fillText(t(tag.region), x + 20, y + 40);
      x += tag.width + 16;
    }
    if (label) {
      c.fillStyle = '#ffffff';
      c.font = `700 30px ${FONT}`;
      c.fillText(label, x, y + 39);
    }
  }

  // The bottom left: who, the car and languages, how to reach them, how many they have done.
  // No routes: 名片頁 dropped them on 2026-10-14.
  const left = 56;
  const column = 660;
  c.fillStyle = '#0e9f9a';
  c.font = `800 32px ${FONT}`;
  c.fillText(t('司機名片'), left, 680);
  c.fillStyle = '#142033';
  c.font = `800 84px ${FONT}`;
  c.fillText(fit(c, props.name, column), left, 774);
  const facts = [props.vehicle, props.languages.length ? `會說${props.languages.join('、')}` : null].filter(Boolean).join('・');
  if (facts) {
    c.fillStyle = '#34445a';
    c.font = `700 32px ${FONT}`;
    c.fillText(fit(c, t(facts), column), left, 834);
  }
  const chips: { label: string; fill: string; ink: string }[] = [];
  if (props.contacts.whatsapp) chips.push({ label: 'WhatsApp', fill: '#dcf5e6', ink: '#137044' });
  if (props.contacts.wechat) chips.push({ label: t('微信'), fill: '#e5edfb', ink: '#1f5fd6' });
  if (props.contacts.phone) chips.push({ label: t('電話'), fill: '#e5edfb', ink: '#1f5fd6' });
  if (props.completedTrips > 0) chips.push({ label: t(`已完成 ${props.completedTrips} 張`), fill: '#fff3d6', ink: '#8a5a00' });
  let chipX = left;
  const chipY = 870;
  c.font = `600 26px ${FONT}`;
  if (chips.length && props.contacts) {
    c.fillStyle = '#8f9db0';
    c.fillText(t('可用'), chipX, chipY + 37);
    chipX += c.measureText(t('可用')).width + 14;
  }
  c.font = `700 28px ${FONT}`;
  for (const chip of chips) {
    const width = c.measureText(chip.label).width + 36;
    if (chipX + width > left + column) break;
    roundRect(c, chipX, chipY, width, 52, 26);
    c.fillStyle = chip.fill;
    c.fill();
    c.fillStyle = chip.ink;
    c.fillText(chip.label, chipX + 18, chipY + 36);
    chipX += width + 12;
  }
  c.fillStyle = '#8f9db0';
  c.font = `600 24px ${FONT}`;
  c.fillText(`${t('跨境師傅幫')}・MasterDriver`, left, 1024);

  // The bottom right: the QR code to the 名片頁, with what scanning it does.
  const { toCanvas } = await import('qrcode');
  const qr = document.createElement('canvas');
  await toCanvas(qr, props.url, { width: 252, margin: 1, color: { dark: '#142033', light: '#ffffff' }, errorCorrectionLevel: 'M' });
  roundRect(c, 776, 646, 268, 268, 20);
  c.fillStyle = '#ffffff';
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#d3dce7';
  c.stroke();
  c.drawImage(qr, 784, 654, 252, 252);
  c.fillStyle = '#1f5fd6';
  c.font = `800 32px ${FONT}`;
  c.textAlign = 'center';
  c.fillText(t('掃碼預約'), 910, 964);
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
