<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import mark from '../assets/brand/masterapp-mark.svg';
import { dealLimits, dealTime, type DriverDeal } from '../deal';
import { inWeChat } from '../device';
import { money } from '../format';
import { t } from '../i18n';
import BottomSheet from './BottomSheet.vue';

/**
 * 特價車分享圖: the deal as a picture with a QR code to its link, for where a link shows no
 * preview. Upright 3:4 for 小紅書 and 朋友圈, which show upright pictures larger, or wide 4:3 for
 * WhatsApp and Facebook (2026-10-22). Drawn here on the phone with its own fonts, so nothing goes
 * to the server. Both have the 名片圖's frame on the brand colours (MasterDriver above, the whole
 * car photo, never cut, and when it leaves in the band below): on top when upright, on the left when wide. Beside
 * or under it: 特價車 with 多組可訂, the route, the price with 原價 and 省, the limits, the driver's
 * note, and the QR code. WeChat cannot save a download, so there the picture is shown to
 * long-press. The driver may leave the price off the picture (2026-10-22); passengers then see it
 * when they scan.
 */
const props = defineProps<{ deal: DriverDeal }>();
const emit = defineEmits<{ close: [] }>();

type Shape = 'upright' | 'wide';
/** Canvas size, the brand frame's size (at the top left), and where the words and the QR code go. */
const LAYOUT = {
  upright: { width: 1080, height: 1440, frame: { width: 1080, height: 760 }, left: 64, top: 842, routeWidth: 952, routeFont: 56, column: 650, qr: { x: 776, y: 1056 } },
  wide: { width: 1440, height: 1080, frame: { width: 720, height: 1080 }, left: 780, top: 150, routeWidth: 612, routeFont: 50, column: 612, qr: { x: 780, y: 772 } },
} as const;
const BAND = 90;
const QR_BOX = 268;
const FONT = "-apple-system, 'PingFang TC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft JhengHei', 'Noto Sans CJK TC', sans-serif";
const picture = ref('');
const failed = ref(false);
/** 直式 or 橫式; upright first, as 小紅書 and 朋友圈 are where most go. */
const shape = ref<Shape>('upright');
/** 圖上顯示價錢: off, the price and 原價 give way to 「掃碼看特價」. */
const showPrice = ref(true);

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

/** The brand frame at the top left: MasterDriver above (2026-10-22: no Chinese name there), the whole car photo (or the name's first character), when it leaves below. */
async function drawFrame(c: CanvasRenderingContext2D, deal: DriverDeal, width: number, height: number) {
  const brand = c.createLinearGradient(0, 0, width, height);
  brand.addColorStop(0, '#1f5fd6');
  brand.addColorStop(1, '#0e9f9a');
  c.fillStyle = brand;
  c.fillRect(0, 0, width, height);

  const logo = await load(mark).catch(() => null);
  c.font = `800 34px ${FONT}`;
  const markText = 'MasterDriver';
  const markX = (width - (64 + c.measureText(markText).width)) / 2;
  if (logo) c.drawImage(logo, markX, BAND / 2 - 19, 50, 38);
  c.fillStyle = '#ffffff';
  c.fillText(markText, markX + 64, BAND / 2 + 12);

  const photoHeight = height - BAND * 2;
  const photo = deal.car.photoUrl ? await load(deal.car.photoUrl).catch(() => null) : null;
  if (photo) {
    const scale = Math.min(width / photo.width, photoHeight / photo.height);
    c.drawImage(photo, (width - photo.width * scale) / 2, BAND + (photoHeight - photo.height * scale) / 2, photo.width * scale, photo.height * scale);
  } else {
    c.beginPath();
    c.arc(width / 2, height / 2, 170, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.16)';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `800 190px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText([...(deal.car.name ?? '').trim()][0] ?? t('師'), width / 2, height / 2 + 8);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }

  c.font = `800 38px ${FONT}`;
  const when = t(deal.pickupUntil ? `${dealTime(deal)} 任選出發` : `${dealTime(deal)} 出發`);
  const whenWidth = Math.min(c.measureText(when).width, width - 96) + 56;
  roundRect(c, (width - whenWidth) / 2, height - BAND / 2 - 34, whenWidth, 68, 34);
  c.fillStyle = '#ffffff';
  c.fill();
  c.fillStyle = '#142033';
  c.textAlign = 'center';
  c.fillText(fit(c, when, width - 96), width / 2, height - BAND / 2 + 14);
  c.textAlign = 'left';
}

/** 特價車 with 多組可訂, the route, the price with 原價 and 省, the limits and the driver's note. */
function drawDetails(c: CanvasRenderingContext2D, deal: DriverDeal, layout: (typeof LAYOUT)[Shape]) {
  const { left, routeWidth, routeFont, column } = layout;
  let y = layout.top;
  c.fillStyle = '#d9480f';
  c.font = `800 36px ${FONT}`;
  const label = t('特價車');
  c.fillText(label, left, y);
  const many = t('多組可訂');
  c.font = `700 28px ${FONT}`;
  const manyX = left + c.measureText(label).width + 56;
  const manyWidth = c.measureText(many).width + 32;
  roundRect(c, manyX, y - 36, manyWidth, 46, 23);
  c.fillStyle = '#dcf3f1';
  c.fill();
  c.fillStyle = '#0b7a76';
  c.fillText(many, manyX + 16, y - 3);

  c.fillStyle = '#142033';
  c.font = `800 ${routeFont}px ${FONT}`;
  // Too long for a line: break after the arrow when each end fits, rather than inside a place name.
  const whole = t(`${deal.origin} → ${deal.destination}`);
  const from = t(`${deal.origin} →`);
  const to = t(deal.destination);
  const route =
    c.measureText(whole).width > routeWidth && c.measureText(from).width <= routeWidth && c.measureText(to).width <= routeWidth
      ? [from, to]
      : wrap(c, whole, routeWidth, 2);
  for (const line of route) {
    y += routeFont + 20;
    c.fillText(line, left, y);
  }

  y += 96;
  // The price is never cut: a long one is drawn smaller until it fits the column.
  c.fillStyle = '#d9480f';
  const price = showPrice.value ? t(`包車 ${money(deal.price)}`) : t('掃碼看特價');
  let size = 80;
  c.font = `800 ${size}px ${FONT}`;
  while (size > 48 && c.measureText(price).width > column) {
    size -= 4;
    c.font = `800 ${size}px ${FONT}`;
  }
  c.fillText(fit(c, price, column), left, y);
  if (showPrice.value && deal.originalPrice) {
    y += 60;
    const original = t(`原價 ${money(deal.originalPrice)}`);
    c.font = `600 34px ${FONT}`;
    const originalWidth = c.measureText(original).width;
    c.fillStyle = '#8f9db0';
    c.fillText(original, left, y);
    c.fillRect(left, y - 12, originalWidth, 3);
    const saved = deal.originalPrice.amount - deal.price.amount;
    if (saved > 0) {
      const save = t(`省 ${money({ amount: saved, currency: deal.price.currency })}`);
      c.font = `800 32px ${FONT}`;
      const saveX = left + originalWidth + 24;
      roundRect(c, saveX, y - 38, c.measureText(save).width + 36, 52, 26);
      c.fillStyle = '#d9480f';
      c.fill();
      c.fillStyle = '#ffffff';
      c.fillText(save, saveX + 18, y);
    }
  }
  const limits = dealLimits(deal);
  if (limits) {
    y += 62;
    c.fillStyle = '#34445a';
    c.font = `700 32px ${FONT}`;
    c.fillText(fit(c, t(limits), column), left, y);
  }
  // The driver's note, as far as two lines go.
  if (deal.notes) {
    c.fillStyle = '#8a5a00';
    c.font = `600 30px ${FONT}`;
    for (const line of wrap(c, t(deal.notes.replace(/\s+/g, ' ')), column, 2)) {
      y += 50;
      c.fillText(line, left, y);
    }
  }
}

/** The QR code to the deal's link, with what scanning it does under it (upright) or beside it (wide), and who drives. */
async function drawQr(c: CanvasRenderingContext2D, deal: DriverDeal, layout: (typeof LAYOUT)[Shape]) {
  const { toCanvas } = await import('qrcode');
  const qr = document.createElement('canvas');
  await toCanvas(qr, deal.url, { width: QR_BOX - 16, margin: 1, color: { dark: '#142033', light: '#ffffff' }, errorCorrectionLevel: 'M' });
  const { x, y } = layout.qr;
  roundRect(c, x, y, QR_BOX, QR_BOX, 20);
  c.fillStyle = '#ffffff';
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#d3dce7';
  c.stroke();
  c.drawImage(qr, x + 8, y + 8, QR_BOX - 16, QR_BOX - 16);

  const car = [deal.car.vehicleType, deal.car.seats && !deal.car.vehicleType?.includes(`${deal.car.seats}座`) ? `${deal.car.seats}座` : null]
    .filter(Boolean)
    .join('・');
  const who = t([deal.car.name, car].filter(Boolean).join('・')) || 'MasterDriver';
  const upright = layout === LAYOUT.upright;
  // Upright: the words under the code, the driver at the bottom left. Wide: all beside the code.
  const textX = upright ? x + QR_BOX / 2 : x + QR_BOX + 36;
  c.textAlign = upright ? 'center' : 'left';
  c.fillStyle = '#1f5fd6';
  c.font = `800 ${upright ? 32 : 40}px ${FONT}`;
  c.fillText(t('掃碼預約'), textX, upright ? y + QR_BOX + 46 : y + 110);
  c.fillStyle = '#8f9db0';
  c.font = `600 ${upright ? 24 : 28}px ${FONT}`;
  c.fillText(t('不用註冊'), textX, upright ? y + QR_BOX + 82 : y + 152);
  c.textAlign = 'left';
  c.font = `600 28px ${FONT}`;
  if (upright) c.fillText(fit(c, who, layout.column), layout.left, y + QR_BOX + 80);
  else c.fillText(fit(c, who, layout.width - textX - 48), textX, y + QR_BOX - 20);
}

async function draw() {
  const deal = props.deal;
  const layout = LAYOUT[shape.value];
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, layout.width, layout.height);
  c.textBaseline = 'alphabetic';
  await drawFrame(c, deal, layout.frame.width, layout.frame.height);
  drawDetails(c, deal, layout);
  await drawQr(c, deal, layout);
  return canvas.toDataURL('image/png');
}

async function render() {
  picture.value = '';
  failed.value = false;
  try {
    picture.value = await draw();
  } catch {
    failed.value = true;
  }
}

onMounted(render);
watch([showPrice, shape], render);
</script>

<template>
  <BottomSheet :title="t('特價車分享圖')" @close="emit('close')">
    <p class="deal-card__lead">{{ t('發朋友圈、小紅書或傳給熟客；乘客掃碼就能打開預約。') }}</p>
    <div class="segment segment--block deal-card__shape" role="group" :aria-label="t('圖片方向')">
      <button type="button" :aria-pressed="shape === 'upright'" @click="shape = 'upright'">{{ t('直式') }}</button>
      <button type="button" :aria-pressed="shape === 'wide'" @click="shape = 'wide'">{{ t('橫式') }}</button>
    </div>
    <p class="hint deal-card__shape-hint">
      {{ shape === 'upright' ? t('直式適合小紅書、朋友圈。') : t('橫式適合 WhatsApp、Facebook。') }}
    </p>
    <label class="deal-card__switch">
      <span>
        {{ t('圖上顯示價錢') }}
        <small>{{ showPrice ? t('關掉後圖上寫「掃碼看特價」，乘客掃碼才看到價錢') : t('圖上不寫價錢，乘客掃碼才看到') }}</small>
      </span>
      <input v-model="showPrice" class="switch" type="checkbox" />
    </label>
    <img v-if="picture" class="deal-card__picture" :class="`deal-card__picture--${shape}`" :src="picture" :alt="t('特價車分享圖')" />
    <p v-else-if="failed" class="notice error">{{ t('分享圖做不出來，請重新打開這一頁再試。') }}</p>
    <p v-else class="deal-card__loading" role="status">{{ t('製作中…') }}</p>
    <p v-if="picture && inWeChat" class="deal-card__hint">{{ t('長按圖片 → 儲存圖片') }}</p>
    <a v-if="picture && !inWeChat" class="button block deal-card__save" :href="picture" :download="`${t('特價車')}${shape === 'upright' ? t('直式') : t('橫式')}.png`">{{ t('下載圖片') }}</a>
  </BottomSheet>
</template>

<style scoped>
.deal-card__lead {
  margin: 0 0 var(--space-md);
  color: var(--color-text-secondary);
}
.deal-card__shape-hint {
  margin: var(--space-xs) 0 var(--space-sm);
}
.deal-card__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 48px;
  margin-bottom: var(--space-md);
  font-weight: 600;
}
.deal-card__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.deal-card__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
/* Shown at its own proportions; in WeChat a long press on it saves it. */
.deal-card__picture {
  display: block;
  width: 100%;
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  -webkit-touch-callout: default;
}
.deal-card__picture--upright {
  aspect-ratio: 3 / 4;
}
.deal-card__picture--wide {
  aspect-ratio: 4 / 3;
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
