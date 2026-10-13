import type { Money } from './format';

/** 收款方式 as the API sends them. */
export type PaymentKind = 'WECHAT' | 'ALIPAY' | 'PAYME' | 'FPS' | 'BANK' | 'OTHER';

export interface PaymentMethod {
  id: string;
  kind: PaymentKind;
  label: string;
  account: string | null;
  qrUrl: string | null;
}

/** What the passenger's page shows: who to pay, how much (when known) and how. */
export interface PassengerPayment {
  payee: string | null;
  amount: Money | null;
  paid: boolean;
  methods: PaymentMethod[];
}

/** Each kind's name, and what it usually needs: a QR code, typed account details, or either. */
export const PAYMENT_KINDS: Record<PaymentKind, { name: string; asks: 'qr' | 'account' | 'either'; hint: string }> = {
  WECHAT: { name: '微信收款', asks: 'qr', hint: '上傳微信「收付款 → 二維碼收款」的截圖' },
  ALIPAY: { name: '支付寶收款', asks: 'qr', hint: '上傳支付寶收錢碼的截圖。在微信裡支付寶碼通常不能長按識別，乘客要截圖後到支付寶掃' },
  PAYME: { name: 'PayMe', asks: 'either', hint: '上傳 PayMe 二維碼，或填 PayMe 用的電話' },
  FPS: { name: '轉數快 FPS', asks: 'account', hint: '例如：FPS ID 1234567，或登記的電話、電郵' },
  BANK: { name: '銀行轉帳', asks: 'account', hint: '例如：滙豐 123-456789-001 陳大文' },
  OTHER: { name: '其他', asks: 'either', hint: '例如：上車付現金' },
};
