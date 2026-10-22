import type { CharterExtra } from '@masterdriver/shared/charter';

type Price = { amount: number; currency: string } | null;

/**
 * 包車 (按小時計費) on an order, as the API gives it: what the driver is paid an hour to anyone who
 * sees the driver price, the passenger's prices an hour only to the dispatcher. 超時 without a price
 * of its own comes as the hourly price.
 */
export interface OrderCharter {
  minutes: number;
  driverHourly: Price;
  overtimeDriverHourly: Price;
  overtimeUnitMinutes: number;
  overtimeGraceMinutes: number;
  extras: CharterExtra[];
  passengerHourly?: Price;
  overtimePassengerHourly?: Price;
}

/** 包車 on the passenger's link: their prices an hour only when the dispatcher shows their price. */
export interface PassengerCharter {
  minutes: number;
  hourly: Price;
  overtimeHourly: Price;
  overtimeUnitMinutes: number;
  overtimeGraceMinutes: number;
  extras: CharterExtra[];
}
