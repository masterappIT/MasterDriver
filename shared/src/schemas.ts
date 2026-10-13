import { z } from 'zod';
import { COUNTRY_CODES, formatPassengerPhone, isValidMobile, normalizePhone, splitPassengerPhone } from './phone';
import { PLATE_TYPES, VEHICLE_OWNERSHIPS, normalizeVehiclePlates, vehiclePlateError } from './vehicle-plate';

export const ORDER_STATUSES = ['OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CURRENCIES = ['HKD', 'CNY', 'MOP'] as const;
export type Currency = (typeof CURRENCIES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
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

/** 接駁: a trip has at most this many legs, each its own order. */
export const MAX_JOURNEY_LEGS = 4;

/** Where a car is registered; an order may ask for one or more of these plates. */
export const PLATE_REGIONS = ['HK', 'MACAU', 'MAINLAND'] as const;
export type PlateRegion = (typeof PLATE_REGIONS)[number];

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
  passengerContact: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parts = splitPassengerPhone(value);
      if (!parts || !/^\+(852|853|86)\s?\d/.test(value.replace(/[\-()]/g, ''))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_PASSENGER_PHONE' });
        return z.NEVER;
      }
      return formatPassengerPhone(parts.countryCode, parts.phone);
    }),
  /** The one-line text the order was written from, as typed. */
  rawText: optionalText(300),
  /** Minutes before pickup when the winning driver sees the passenger's contact; null: right away. Defaults to the dispatcher's preference. */
  contactRevealMinutes: contactReveal.optional(),
  /**
   * 接駁: add this order as the next leg after the last leg of the dispatcher's
   * trip. Its origin is the 接駁位置, which is also the previous leg's destination.
   */
  afterOrderId: z.string().trim().min(1).max(40).optional(),
  /**
   * 接駁 instead of 直達: this order is the first leg of a trip and ends at the
   * 接駁位置, where the next leg's car takes over. Ignored with afterOrderId.
   */
  transfer: z.boolean().default(false),
  /** Plates the car needs, e.g. ['MACAU']; only stated to drivers, never enforced. */
  requiredPlates: z
    .array(z.enum(PLATE_REGIONS))
    .max(PLATE_REGIONS.length)
    .default([])
    .transform((plates) => PLATE_REGIONS.filter((plate) => plates.includes(plate))),
  /** 名片頁: the booking request this order is made from; it must be the dispatcher's own and still open. */
  bookingId: z.string().trim().min(1).max(40).optional(),
  /** 這段我自己做: the dispatcher drives this order, so it is not offered for claiming. */
  selfDrive: z.boolean().default(false),
  /** 接單池: also list the order for every signed-in driver. Defaults to the dispatcher's preference. */
  inPool: z.boolean().optional(),
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

export const groupInviteCreateSchema = z
  .object({
    platform: z.enum(GROUP_PLATFORMS),
    name: text(40),
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
