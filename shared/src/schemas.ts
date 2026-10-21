import { z } from 'zod';
import { COUNTRY_CODES, formatPassengerPhone, isValidMobile, normalizePhone, splitPassengerPhone } from './phone';
import { PLATE_TYPES, VEHICLE_OWNERSHIPS, normalizeVehiclePlates, vehiclePlateError } from './vehicle-plate';

export const ORDER_STATUSES = ['OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CURRENCIES = ['HKD', 'CNY', 'MOP'] as const;
export type Currency = (typeof CURRENCIES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * A passenger's phone with its country code, e.g. "+852 91234567", stored as formatPassengerPhone
 * writes it. Used for orders and for 名片頁 bookings alike.
 */
export const passengerPhoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parts = splitPassengerPhone(value);
    if (!parts || !/^\+(852|853|86)\s?\d/.test(value.replace(/[\-()]/g, ''))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_PASSENGER_PHONE' });
      return z.NEVER;
    }
    return formatPassengerPhone(parts.countryCode, parts.phone);
  });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const phoneObject = z.object({
  countryCode: z.enum(COUNTRY_CODES),
  phone: z.string().transform(normalizePhone),
});

const validMobile = (value: z.infer<typeof phoneObject>) => isValidMobile(value.countryCode, value.phone);
const invalidPhone = { message: 'INVALID_PHONE', path: ['phone'] };

export const otpRequestSchema = phoneObject.refine(validMobile, invalidPhone);
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = phoneObject
  .extend({ code: z.string().regex(/^\d{6}$/) })
  .refine(validMobile, invalidPhone);
export type OtpVerify = z.infer<typeof otpVerifySchema>;

const plate = optionalText(16);

/**
 * 車輛歸屬地 and 車牌類型 decide which plates are asked for and their format
 * (shared/src/vehicle-plate.ts). Plates are stored normalized; a plate the
 * chosen type does not carry is dropped.
 */
/**
 * One of a driver's two contact numbers, typed with its code: "+852 91234567". `codes` are the
 * codes that side of the border uses. Blank means not given. Stored as "+852 91234567".
 */
const contactPhone = (codes: readonly (typeof COUNTRY_CODES)[number][], message: string) =>
  z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((value, context) => {
      if (!value) return undefined;
      const typed = normalizePhone(value);
      const code = codes.find((item) => typed.startsWith(item));
      const number = code ? typed.slice(code.length) : '';
      if (!code || !isValidMobile(code, number)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return `${code} ${number}`;
    });

export const driverProfileSchema = z
  .object({
    name: text(30),
    vehicleOwnership: z.enum(VEHICLE_OWNERSHIPS),
    plateType: z.enum(PLATE_TYPES),
    hkPlate: plate,
    macauPlate: plate,
    mainlandPlate: plate,
    /** 車型, typed freely, e.g. 埃爾法. */
    vehicleType: text(30),
    seats: z.number().int().min(1).max(60).optional(),
    color: optionalText(20),
    /** 港澳號碼 and 內地號碼: how to reach the driver on each side; neither is required. */
    hkMacauPhone: contactPhone(['+852', '+853'], 'HK_MACAU_PHONE_INVALID'),
    mainlandPhone: contactPhone(['+86'], 'MAINLAND_PHONE_INVALID'),
    /** The driver's plates are not shown to passengers. */
    hidePlates: z.boolean().default(false),
  })
  .transform((value) => ({ ...value, ...normalizeVehiclePlates(value) }))
  .superRefine((value, context) => {
    const error = vehiclePlateError(value);
    if (error) context.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ['plateType'] });
  });
export type DriverProfileInput = z.infer<typeof driverProfileSchema>;

/** Money is entered as a decimal (e.g. 850 or 850.5) and stored in minor units. */
const priceSchema = z.object({
  amount: z.number().min(0).max(1_000_000),
  currency: z.enum(CURRENCIES),
});

/**
 * A trip has two legs, each its own order: 接駁 (meeting at one 接駁位置) or 往返 (there and
 * back, the second leg the first one turned around).
 */
export const MAX_JOURNEY_LEGS = 2;

export const JOURNEY_KINDS = ['TRANSFER', 'ROUND_TRIP'] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

/** Where a car is registered; an order may ask for one or more of these plates. */
export const PLATE_REGIONS = ['HK', 'MACAU', 'MAINLAND'] as const;
export type PlateRegion = (typeof PLATE_REGIONS)[number];

/** The plates an order asks for, in a fixed order; only stated to drivers, never enforced. */
const requiredPlatesSchema = z
  .array(z.enum(PLATE_REGIONS))
  .max(PLATE_REGIONS.length)
  .default([])
  .transform((plates) => PLATE_REGIONS.filter((plate) => plates.includes(plate)));

/** Up to 24 hours before pickup, or null for "as soon as the order is claimed". */
export const contactReveal = z.number().int().min(0).max(1440).nullable();

export const createOrderSchema = z.object({
  /** ISO 8601 date-time with offset, e.g. 2026-10-15T14:30:00+08:00. */
  pickupAt: z.string().datetime({ offset: true }),
  origin: text(120),
  destination: text(120),
  waypoints: z.array(text(120)).max(5).default([]),
  passengers: z.number().int().min(1).max(60),
  luggage: z.number().int().min(0).max(60).default(0),
  vehicleType: optionalText(30),
  /** What the dispatcher pays the driver; shown in the group and on the claim page. */
  driverPrice: priceSchema.optional(),
  /** What the passenger pays; never shown to drivers. */
  passengerPrice: priceSchema.optional(),
  /** Show the passenger price on the confirmation page. */
  showPassengerPrice: z.boolean().default(false),
  notes: optionalText(500),
  passengerName: optionalText(40),
  /**
   * The passenger's phone with its country code, e.g. "+852 91234567". Passengers give a
   * phone, not a WeChat ID, when an order is put out; stored as formatPassengerPhone writes it.
   */
  passengerContact: passengerPhoneSchema,
  /** The one-line text the order was written from, as typed. */
  rawText: optionalText(300),
  /** 航班號 of an airport pickup or drop-off, e.g. "CX123". With 往返, the way there's. */
  flightNo: optionalText(20),
  /** 先給常用司機: for the first 30 minutes only the dispatcher's 常用司機 may claim it. */
  favoritesFirst: z.boolean().default(false),
  /**
   * 即時單: leave now. The API takes the time it is put out as the pickup time (with 接駁, the
   * first leg's); `pickupAt` is ignored. 先給常用司機 does not apply. Goes into the 接單池 unless
   * `inPool` says otherwise.
   */
  immediate: z.boolean().default(false),
  /** Minutes before pickup when the winning driver sees the passenger's contact; null: right away. Defaults to the dispatcher's preference. */
  contactRevealMinutes: contactReveal.optional(),
  /**
   * 接駁 instead of 直達: one order in two legs, each taken by its own driver. The trip runs from
   * `origin` to `destination` and changes cars at `transfer.place`; the fields above (time,
   * driver price, plates) are the first leg's, `transfer` holds the second leg's. The passenger
   * price is for the whole trip.
   */
  transfer: z
    .object({
      /** 接駁位置: set by the dispatcher; the first leg ends and the second starts here. */
      place: text(120),
      /** The second leg's pickup time; not before the first leg's (checked by the API). */
      pickupAt: z.string().datetime({ offset: true }),
      driverPrice: priceSchema.optional(),
      requiredPlates: requiredPlatesSchema,
      /** 這段我自己做: the dispatcher drives one of the two legs (never both). */
      selfDriveLeg: z.union([z.literal(1), z.literal(2)]).nullable().default(null),
    })
    .optional(),
  /**
   * 往返 instead of 直達: one order in two legs, there (`origin` to `destination`, the fields above)
   * and back (`destination` to `origin`, the time and driver price here). Both legs ask for the
   * same plates. The passenger price is for the whole trip. Not together with `transfer`.
   */
  roundTrip: z
    .object({
      /** The way back's pickup time; not before the way there (checked by the API). */
      pickupAt: z.string().datetime({ offset: true }),
      driverPrice: priceSchema.optional(),
      /** The way back's 航班號: a different flight from the way there's. */
      flightNo: optionalText(20),
      /**
       * Where the way back leaves from and goes to; absent means the way there reversed
       * (`destination` to `origin`). The passenger may come back from or to somewhere else.
       */
      origin: optionalText(120),
      destination: optionalText(120),
      /**
       * 同一位司機來回: one claim takes both legs. False: 可分開接, each leg is claimed on its own,
       * and one driver may take both.
       */
      sameDriver: z.boolean().default(true),
      /** 可分開接 only: the dispatcher drives one of the legs. With sameDriver, `selfDrive` drives both. */
      selfDriveLeg: z.union([z.literal(1), z.literal(2)]).nullable().default(null),
    })
    .optional(),
  /** Plates the car needs, e.g. ['MACAU']; only stated to drivers, never enforced. With 接駁, the first leg's. */
  requiredPlates: requiredPlatesSchema,
  /** 名片頁: the booking request this order is made from; it must be the dispatcher's own and still open. */
  bookingId: z.string().trim().min(1).max(40).optional(),
  /**
   * 這單我自己做: the dispatcher drives this order, so it is not offered for claiming. 直達, or both
   * legs of a 往返 taken by one driver; 接駁 and 可分開接 use selfDriveLeg.
   */
  selfDrive: z.boolean().default(false),
  /** 接單池: also list the order for every signed-in driver. Defaults to the dispatcher's preference. */
  inPool: z.boolean().optional(),
  /** 收款方式: show the dispatcher's own ways to be paid on the passenger's confirmation page. */
  showPaymentMethods: z.boolean().default(false),
})
  .refine((value) => !(value.transfer && value.roundTrip), { message: 'ONE_JOURNEY_KIND', path: ['roundTrip'] })
  .refine((value) => !(value.transfer && value.selfDrive), { message: 'SELF_DRIVE_ONE_LEG', path: ['selfDrive'] })
  .refine((value) => !(value.roundTrip && !value.roundTrip.sameDriver && value.selfDrive), {
    message: 'SELF_DRIVE_ONE_LEG',
    path: ['selfDrive'],
  })
  .refine((value) => !(value.roundTrip?.sameDriver && value.roundTrip.selfDriveLeg !== null), {
    message: 'SELF_DRIVE_BOTH_LEGS',
    path: ['roundTrip', 'selfDriveLeg'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * The dispatcher's later price changes. Null clears a price. The driver price
 * can only change while nobody has claimed the order.
 */
export const updateOrderPricesSchema = z
  .object({
    driverPrice: priceSchema.nullable().optional(),
    passengerPrice: priceSchema.nullable().optional(),
    showPassengerPrice: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' });
export type UpdateOrderPricesInput = z.infer<typeof updateOrderPricesSchema>;

/**
 * 收款: whether the passenger's confirmation page shows the dispatcher's ways to be paid, and
 * whether the dispatcher has received the fare (they check their own account and mark it).
 * For a trip with 接駁 both apply to every leg: the passenger pays once.
 */
export const orderPaymentUpdateSchema = z
  .object({
    showPaymentMethods: z.boolean().optional(),
    paid: z.boolean().optional(),
  })
  .refine((value) => value.showPaymentMethods !== undefined || value.paid !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type OrderPaymentUpdate = z.infer<typeof orderPaymentUpdateSchema>;

/**
 * 已結清: the dispatcher marks the account with the driver who took the order as settled, or
 * takes the mark back. A mark only; no amount, and the platform does not check it.
 */
export const orderSettlementUpdateSchema = z.object({ settled: z.boolean() });
export type OrderSettlementUpdate = z.infer<typeof orderSettlementUpdateSchema>;

/** 出單者代確認: the dispatcher confirms the trip for the passenger, or takes their own confirmation back. */
export const passengerConfirmUpdateSchema = z.object({ confirmed: z.boolean() });
export type PassengerConfirmUpdate = z.infer<typeof passengerConfirmUpdateSchema>;

/** Admin update of development-mode sign-in. A missing code keeps the stored one. */
export const developmentLoginUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine((value) => value.enabled !== undefined || value.code !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type DevelopmentLoginUpdate = z.infer<typeof developmentLoginUpdateSchema>;

/** Admin update of the platform service fee. The fee is a decimal amount per order. */
export const commissionUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    fee: z.number().min(0).max(10_000).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.fee !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type CommissionUpdate = z.infer<typeof commissionUpdateSchema>;

export const contactRevealUpdateSchema = z.object({ contactRevealMinutes: contactReveal });
export type ContactRevealUpdate = z.infer<typeof contactRevealUpdateSchema>;

/** Dispatcher defaults applied to new orders (我的 → 出單預設). */
export const preferencesUpdateSchema = z
  .object({ contactRevealMinutes: contactReveal, poolByDefault: z.boolean() })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' });
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

export const poolUpdateSchema = z.object({ inPool: z.boolean() });
export type PoolUpdate = z.infer<typeof poolUpdateSchema>;

/** 先給常用司機: how long an order is the dispatcher's 常用司機's alone before everyone may claim it. */
export const FAVORITES_FIRST_MINUTES = 30;
/** 先給常用司機 is only offered for an order that leaves more than this long after it is put out; never for 即時單. */
export const FAVORITES_FIRST_MIN_LEAD_MINUTES = 60;
/** 即時單: how long an unclaimed one stays in the 接單池, and when its dispatcher hears nobody has taken it. */
export const IMMEDIATE_POOL_MINUTES = 120;
export const IMMEDIATE_UNCLAIMED_MINUTES = 10;

/** 行程進度: what the driver who took the order reports, in this order. */
export const TRIP_PROGRESS_STEPS = ['DEPARTED', 'ARRIVED', 'PICKED_UP'] as const;
export const orderProgressSchema = z.object({ step: z.enum(TRIP_PROGRESS_STEPS) });
export type OrderProgress = z.infer<typeof orderProgressSchema>;

/**
 * 修改行程: the dispatcher changes the trip after putting it out. With 接駁, `pickupAt` is the leg's
 * own time; `origin` is the trip's start, `destination` its end and `transferPlace` where the cars
 * change. A driver who already took a changed leg confirms it with 知道了.
 */
export const updateTripSchema = z
  .object({
    pickupAt: z.string().datetime({ offset: true }).optional(),
    origin: text(120).optional(),
    destination: text(120).optional(),
    transferPlace: text(120).optional(),
    passengers: z.number().int().min(1).max(60).optional(),
    luggage: z.number().int().min(0).max(60).optional(),
    vehicleType: z.string().trim().min(1).max(30).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    flightNo: z.string().trim().max(20).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' });
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

/** 我的司機: the dispatcher's own mark and note on a driver who took their orders. */
export const driverNoteUpdateSchema = z
  .object({
    favorite: z.boolean().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => value.favorite !== undefined || value.note !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type DriverNoteUpdate = z.infer<typeof driverNoteUpdateSchema>;

/** 接單池 filters: a day in Hong Kong time (YYYY-MM-DD) and a word in the origin or destination. */
export const poolQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)))
    .optional(),
  q: optionalText(40),
});
export type PoolQuery = z.infer<typeof poolQuerySchema>;

export const orderListQuerySchema = z.object({
  role: z.enum(['dispatched', 'claimed']),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const GROUP_PLATFORMS = ['WECHAT', 'WHATSAPP', 'WECHAT_CONTACT'] as const;
export type GroupPlatform = (typeof GROUP_PLATFORMS)[number];

/** WhatsApp group invite links look like https://chat.whatsapp.com/AbCdEf123456. */
export const WHATSAPP_INVITE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
/** A QR image sent as a data URL: PNG, JPEG or WebP. Size is checked on the server after decoding. */
export const QR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * 行程群: the dispatcher's own group for one trip (passenger, dispatcher, driver): a WhatsApp
 * invite link or a WeChat group QR; `platform: null` takes it away.
 */
export const tripGroupUpdateSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('WHATSAPP'), inviteUrl: z.string().trim().regex(WHATSAPP_INVITE, 'WHATSAPP_INVITE_INVALID') }),
  z.object({ platform: z.literal('WECHAT'), qrImage: z.string().regex(QR_DATA_URL, 'QR_IMAGE_REQUIRED') }),
  z.object({ platform: z.literal(null) }),
]);
export type TripGroupUpdate = z.infer<typeof tripGroupUpdateSchema>;

export const groupInviteCreateSchema = z
  .object({
    platform: z.enum(GROUP_PLATFORMS),
    /** No longer asked (2026-10-14): the type and the QR code or link say which group it is. */
    name: z.string().trim().max(40).default(''),
    inviteUrl: z.string().trim().optional(),
    qrImage: z.string().optional(),
    showOnClaimPage: z.boolean().default(true),
  })
  .refine((value) => (value.platform === 'WHATSAPP' ? WHATSAPP_INVITE.test(value.inviteUrl ?? '') : true), {
    message: 'WHATSAPP_INVITE_INVALID',
    path: ['inviteUrl'],
  })
  .refine((value) => (value.platform !== 'WHATSAPP' ? QR_DATA_URL.test(value.qrImage ?? '') : true), {
    message: 'QR_IMAGE_REQUIRED',
    path: ['qrImage'],
  });
export type GroupInviteCreate = z.infer<typeof groupInviteCreateSchema>;

export const groupInviteUpdateSchema = z
  .object({
    name: text(40),
    showOnClaimPage: z.boolean(),
    inviteUrl: z.string().trim().regex(WHATSAPP_INVITE, 'WHATSAPP_INVITE_INVALID'),
    qrImage: z.string().regex(QR_DATA_URL, 'QR_IMAGE_REQUIRED'),
  })
  .partial();
export type GroupInviteUpdate = z.infer<typeof groupInviteUpdateSchema>;

/** 收款方式: how a dispatcher can be paid. The money goes straight to them, never through the platform. */
export const PAYMENT_KINDS = ['WECHAT', 'ALIPAY', 'PAYME', 'FPS', 'BANK', 'OTHER'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const MAX_PAYMENT_METHODS = 5;

/** A way to be paid needs something to pay to: typed account details, a QR image, or both. */
export const paymentMethodCreateSchema = z
  .object({
    kind: z.enum(PAYMENT_KINDS),
    label: text(30),
    account: optionalText(80),
    qrImage: z.string().regex(QR_DATA_URL, 'QR_IMAGE_INVALID').optional(),
  })
  .refine((value) => Boolean(value.account || value.qrImage), { message: 'PAYMENT_METHOD_EMPTY', path: ['account'] });
export type PaymentMethodCreate = z.infer<typeof paymentMethodCreateSchema>;

/** Null clears the account or the QR image; a method must still keep one of them. */
export const paymentMethodUpdateSchema = z
  .object({
    label: text(30),
    account: z.string().trim().max(80).nullable(),
    qrImage: z.string().regex(QR_DATA_URL, 'QR_IMAGE_INVALID').nullable(),
  })
  .partial();
export type PaymentMethodUpdate = z.infer<typeof paymentMethodUpdateSchema>;
