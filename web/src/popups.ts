import { reactive } from 'vue';

/**
 * The pop-ups over the driver app take turns: the App 意向問卷 waits for the 更新說明彈窗, and when
 * that picture shows, the questions wait for the next time the app is opened, so a driver never
 * gets two in a row.
 */
export const popups = reactive({ updateNotice: 'pending' as 'pending' | 'none' | 'shown' });
