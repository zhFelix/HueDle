/** 路由表（DESIGN 第 13 节的页面清单）。 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import About from './pages/About.vue';
import BadgeBook from './pages/BadgeBook.vue';
import HistoryPage from './pages/History.vue';
import Home from './pages/Home.vue';
import Login from './pages/Login.vue';

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Home, meta: { title: '今日一色' } },
  { path: '/history', name: 'history', component: HistoryPage, meta: { title: '历史记录' } },
  { path: '/badges', name: 'badges', component: BadgeBook, meta: { title: '徽章图鉴' } },
  { path: '/about', name: 'about', component: About, meta: { title: '关于' } },
  { path: '/login', name: 'login', component: Login, meta: { title: '登录' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
