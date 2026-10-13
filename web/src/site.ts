import { reactive } from 'vue';
import { api } from './api';

interface PublicSettings {
  logoUrl: string | null;
  upgradeUrl: string | null;
  support: { wechatId: string | null; whatsapp: string | null };
  announcement: string | null;
}

/** What the platform admin set for every page (一般設定): logo, links, announcement. Loaded once. */
export const site = reactive<{ settings: PublicSettings | null }>({ settings: null });

let loading: Promise<void> | null = null;

export function loadSite() {
  loading ??= api<PublicSettings>('GET', '/public/settings')
    .then((settings) => {
      site.settings = settings;
    })
    .catch(() => {
      // Pages work without it; try again the next time one asks.
      loading = null;
    });
  return loading;
}
