const PLATE_KIND = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' } as const;

export interface ShareProfile {
  name: string | null;
  vehicleType: string | null;
  seats: number | null;
  plateType: keyof typeof PLATE_KIND | null;
}

/**
 * Text the driver pastes with their 名片頁 link (a group, a chat, 朋友圈). It must say who they
 * are on its own, because WeChat usually shows our link without a preview card. The name, the
 * car and the link; no phone number, the link leads to those.
 */
export function profileShareText(profile: ShareProfile, url: string): string {
  const car = [profile.vehicleType, profile.seats ? `${profile.seats}座` : null, profile.plateType ? PLATE_KIND[profile.plateType] : null]
    .filter(Boolean)
    .join('｜');
  return [
    `【跨境接送】${profile.name ?? '司機'}`,
    car || null,
    `要用車直接在這裡約我，不用註冊：${url}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
