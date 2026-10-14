import { createApp } from 'vue';
import App from './App.vue';
import { reportLoad } from './load-report';
import { router } from './router';
import { reloadOnStaleBuild } from './stale-build';
import './styles/base.css';

reloadOnStaleBuild(router);
const app = createApp(App).use(router);
// The loading screen in index.html stays until the first page is ready to show, not just the code.
router.isReady().then(
  () => {
    app.mount('#app');
    reportLoad('ready', router.currentRoute.value.matched);
  },
  // The first page could not be opened: the loading screen offers 重新載入 at once.
  () => document.documentElement.classList.add('boot-failed'),
);
