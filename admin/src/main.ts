import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { reloadOnStaleBuild } from './stale-build';
import './styles/base.css';

reloadOnStaleBuild(router);
createApp(App).use(router).mount('#app');
