import { z } from 'zod';
import { COUNTRY_CODES, isValidMobile, normalizePhone } from './phone';

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

const plate = optionalText(12).transform((value) => value?.toUpperCase());

export const driverProfileSchema = z.object({
  name: text(30),
  hkPlate: plate,
  macauPlate: plate,
  mainlandPlate: plate,
  vehicleType: optionalText(30),
  seats: z.number().int().min(1).max(60).optional(),
  color: optionalText(20),
});
export type DriverProfileInput = z.infer<typeof driverProfileSchema>;

/** Money is entered as a decimal (e.g. 850 or 850.5) and stored in minor units. */
const priceSchema = z.object({
  amount: z.number().min(0).max(1_000_000),
  currency: z.enum(CURRENCIES),
});

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
  passengerContact: text(60),
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

export const orderListQuerySchema = z.object({
  role: z.enum(['dispatched', 'claimed']),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
