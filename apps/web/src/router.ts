/** 路由表（DESIGN 第 13 节的页面清单）。 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import About from './pages/About.vue';
import BadgeBook from './pages/BadgeBook.vue';
import Profile from './pages/Profile.vue';
import Home from './pages/Home.vue';
import Login from './pages/Login.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Home, meta: { title: '今日一色' } },
  // 个人主页：身份 + 统计 + 颜色历史（组件仍是复用历史页的那个页面）。
  { path: '/me', name: 'me', component: Profile, meta: { title: '我的' } },
  // 旧地址保留为重定向——可能有人存了书签，直接删掉会 404。
  { path: '/history', redirect: { name: 'me' } },
  { path: '/badges', name: 'badges', component: BadgeBook, meta: { title: '徽章图鉴' } },
  { path: '/about', name: 'about', component: About, meta: { title: '关于' } },
  { path: '/login', name: 'login', component: Login, meta: { title: '登录' } },
];

export const router = createRouter({
  // **必须显式传 BASE_URL**：`createWebHistory()` 不读 Vite 的 `base`，
  // 它只认 `<base href>` 标签，没有就退回 `'/'`。
  // 部署到 GitHub Pages 的子路径（`/HueDle/`）时，不传这个参数会导致
  // **一条路由都匹配不上**——页面只剩导航外壳、内容空白，
  // 而本地开发（base 为 `/`）完全看不出问题。
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
