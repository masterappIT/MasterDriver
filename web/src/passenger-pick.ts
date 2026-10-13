import { ref } from 'vue';

/** One line of the 客人通訊錄: a passenger of the orders this driver put out. */
export interface BookPassenger {
  contact: string;
  name: string | null;
  trips: number;
  lastPickupAt: string;
  lastRoute: string;
}

/**
 * The passenger chosen in the 客人通訊錄 for a new order. Kept in memory for the one step to
 * the order form, so a name and phone never travel in the address.
 */
export const pickedPassenger = ref<BookPassenger | null>(null);
