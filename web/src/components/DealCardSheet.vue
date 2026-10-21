<script setup lang="ts">
import { onMounted, ref } from 'vue';
import mark from '../assets/brand/masterapp-mark.svg';
import { dealLimits, dealTime, type DriverDeal } from '../deal';
import { inWeChat } from '../device';
import { money } from '../format';
import { t } from '../i18n';
import BottomSheet from './BottomSheet.vue';

/**
 * 特價車分享圖: the deal as a square picture with a QR code to its link, for where a link shows no
 * preview (WeChat, 朋友圈, 小紅書). Drawn here on the phone with its own fonts, so nothing goes to
 * the server. The top is the 名片圖's frame on the brand colours (the whole car photo, never cut,
 * and when it leaves in the band below); the route, the price and the QR code are under it.
 * WeChat cannot save a download, so there the picture is shown to long-press.
 */
const props = defineProps<{ deal: DriverDeal }>();
const emit = defineEmits<{ close: [] }>();

const SIZE = 1080;
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

/** The text in at most `lines` lines of `max` width, the last cut with an ellipsis. */
function wrap(context: CanvasRenderingContext2D, text: string, max: number, lines: number) {
  const out: string[] = [];
  let rest = text;
  while (rest && out.length < lines - 1) {
    let line = '';
    for (const char of rest) {
      if (context.measureText(line + char).width > max) break;
      line += char;
    }
    if (line === rest) break;
    out.push(line);
    rest = rest.slice(line.length);
  }
  if (rest) out.push(fit(context, rest, max));
  return out;
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
  const deal = props.deal;
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
  const photo = deal.car.photoUrl ? await load(deal.car.photoUrl).catch(() => null) : null;
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
    c.fillText([...(deal.car.name ?? '').trim()][0] ?? t('師'), SIZE / 2, FRAME_HEIGHT / 2 + 8);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }

  // The band below: when it leaves, as a pill on the photo's edge.
  c.font = `800 36px ${FONT}`;
  const when = t(deal.pickupUntil ? `${dealTime(deal)} 任選出發` : `${dealTime(deal)} 出發`);
  const whenWidth = Math.min(c.measureText(when).width, SIZE - 160) + 64;
  roundRect(c, (SIZE - whenWidth) / 2, FRAME_HEIGHT - BAND / 2 - 32, whenWidth, 64, 32);
  c.fillStyle = '#ffffff';
  c.fill();
  c.fillStyle = '#142033';
  c.textAlign = 'center';
  c.fillText(fit(c, when, SIZE - 160), SIZE / 2, FRAME_HEIGHT - BAND / 2 + 13);
  c.textAlign = 'left';

  // The bottom left: 特價車, the route, the price (the original struck through), and the limits.
  const left = 56;
  const column = 660;
  c.fillStyle = '#d9480f';
  c.font = `800 32px ${FONT}`;
  c.fillText(t('特價車'), left, 678);
  c.fillStyle = '#142033';
  c.font = `800 52px ${FONT}`;
  const route = wrap(c, t(`${deal.origin} → ${deal.destination}`), column, 2);
  let y = 746;
  for (const line of route) {
    c.fillText(line, left, y);
    y += 62;
  }
  y += 34;
  c.fillStyle = '#d9480f';
  c.font = `800 76px ${FONT}`;
  const price = t(`整車 ${money(deal.price)}`);
  c.fillText(fit(c, price, column), left, y);
  if (deal.originalPrice) {
    const priceWidth = Math.min(c.measureText(price).width, column);
    const original = t(`原價 ${money(deal.originalPrice)}`);
    c.font = `600 30px ${FONT}`;
    const originalWidth = c.measureText(original).width;
    // Beside the price when it fits, else under it.
    const beside = left + priceWidth + 24 + originalWidth <= left + column;
    const x = beside ? left + priceWidth + 24 : left;
    const baseline = beside ? y - 6 : y + 44;
    c.fillStyle = '#8f9db0';
    c.fillText(original, x, baseline);
    c.fillRect(x, baseline - 11, originalWidth, 3);
    if (!beside) y += 44;
  }
  const limits = dealLimits(deal);
  if (limits) {
    c.fillStyle = '#34445a';
    c.font = `700 30px ${FONT}`;
    c.fillText(fit(c, t(limits), column), left, y + 50);
  }
  const car = [deal.car.vehicleType, deal.car.seats && !deal.car.vehicleType?.includes(`${deal.car.seats}座`) ? `${deal.car.seats}座` : null]
    .filter(Boolean)
    .join('・');
  c.fillStyle = '#8f9db0';
  c.font = `600 26px ${FONT}`;
  c.fillText(fit(c, t([deal.car.name, car].filter(Boolean).join('・') || '跨境師傅幫'), column), left, 1030);

  // The bottom right: the QR code to the deal's link, with what scanning it does.
  const { toCanvas } = await import('qrcode');
  const qr = document.createElement('canvas');
  await toCanvas(qr, deal.url, { width: 252, margin: 1, color: { dark: '#142033', light: '#ffffff' }, errorCorrectionLevel: 'M' });
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
  c.fillStyle = '#8f9db0';
  c.font = `600 24px ${FONT}`;
  c.fillText(t('不用註冊'), 910, 1004);
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
  <BottomSheet :title="t('特價車分享圖')" @close="emit('close')">
    <p class="deal-card__lead">{{ t('發朋友圈、小紅書或傳給熟客；乘客掃碼就能打開預約。') }}</p>
    <img v-if="picture" class="deal-card__picture" :src="picture" :alt="t('特價車分享圖')" />
    <p v-else-if="failed" class="notice error">{{ t('分享圖做不出來，請重新打開這一頁再試。') }}</p>
    <p v-else class="deal-card__loading" role="status">{{ t('製作中…') }}</p>
    <p v-if="picture && inWeChat" class="deal-card__hint">{{ t('長按圖片 → 儲存圖片') }}</p>
    <a v-if="picture && !inWeChat" class="button block deal-card__save" :href="picture" :download="`${t('特價車')}.png`">{{ t('下載圖片') }}</a>
  </BottomSheet>
</template>

<style scoped>
.deal-card__lead {
  margin: 0 0 var(--space-md);
  color: var(--color-text-secondary);
}
/* Shown at its own square proportions; in WeChat a long press on it saves it. */
.deal-card__picture {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  -webkit-touch-callout: default;
}
.deal-card__loading {
  padding: var(--space-xl) 0;
  color: var(--color-text-secondary);
  text-align: center;
}
.deal-card__hint {
  margin: var(--space-md) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-weight: 700;
  text-align: center;
}
.deal-card__save {
  margin-top: var(--space-md);
}
</style>
