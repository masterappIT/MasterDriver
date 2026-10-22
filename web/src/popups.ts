import { reactive } from 'vue';

/**
 * The pop-ups over the driver app take turns: the App 意向問卷 waits while the 更新說明彈窗 is being
 * looked up or is showing, and comes up once it is closed, so the two never show at once.
 */
export const popups = reactive({ updateNotice: 'pending' as 'pending' | 'none' | 'shown' });
