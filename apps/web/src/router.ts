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
  history: createWebHistory(),
  routes,
});
