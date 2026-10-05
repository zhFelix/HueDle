// family: culture — 代表色 #002FA7
import type { BadgeDef } from '../types';

/**
 * 精确色值比较：文化家族的特许例外（规范第 5 节 check 约束 3）。
 * 契约保证 `ColorInfo.hex` 为大写、带 `#`、恒 7 字符，故直接全等比较即可。
 */
// private
export const exactHex = (hex: string, target: string): boolean => hex === target;

export const cultureBadges: BadgeDef[] = [
  {
    id: 'culture-klein-blue',
    name: '克莱因蓝',
    description: 'HEX 精确等于 #002FA7（国际克莱因蓝 IKB）',
    family: 'culture',
    check: color => exactHex(color.hex, '#002FA7'),
  },
  {
    id: 'culture-tiffany-blue',
    name: '蒂芙尼蓝',
    description: 'HEX 精确等于 #0ABAB5（蒂芙尼蓝 / 知更鸟蛋蓝）',
    family: 'culture',
    check: color => exactHex(color.hex, '#0ABAB5'),
  },
  {
    id: 'culture-marrs-green',
    name: '马尔斯绿',
    description: 'HEX 精确等于 #018574（2017 年英国票选世界最受欢迎颜色）',
    family: 'culture',
    check: color => exactHex(color.hex, '#018574'),
  },
  {
    id: 'culture-prussian-blue',
    name: '普鲁士蓝',
    description: 'HEX 精确等于 #003153',
    family: 'culture',
    check: color => exactHex(color.hex, '#003153'),
  },
  {
    id: 'culture-titian-red',
    name: '提香红',
    description: 'HEX 精确等于 #BA3B40（提香红 / Titian red）',
    family: 'culture',
    check: color => exactHex(color.hex, '#BA3B40'),
  },
  {
    id: 'culture-van-gogh-blue',
    name: '梵高星空蓝',
    description: 'HEX 精确等于 #1B3B6F（梵高《星月夜》夜空蓝近似值）',
    family: 'culture',
    check: color => exactHex(color.hex, '#1B3B6F'),
  },
  {
    id: 'culture-bamboo-green',
    name: '竹青',
    description: 'HEX 精确等于 #789262（中国传统色「竹青」）',
    family: 'culture',
    check: color => exactHex(color.hex, '#789262'),
  },
  {
    id: 'culture-rouge',
    name: '胭脂',
    description: 'HEX 精确等于 #9D2933（中国传统色「胭脂」）',
    family: 'culture',
    check: color => exactHex(color.hex, '#9D2933'),
  },
    {
    id: 'culture-facebook-blue',
    name: 'Facebook 蓝',
    description: 'HEX 精确等于 #1877F2',
    family: 'culture',
    check: c => c.hex === '#1877F2',
  },
  {
    id: 'culture-instagram-pink',
    name: 'Instagram 粉',
    description: 'HEX 精确等于 #E4405F',
    family: 'culture',
    check: c => c.hex === '#E4405F',
  },
  {
    id: 'culture-whatsapp-green',
    name: 'WhatsApp 绿',
    description: 'HEX 精确等于 #25D366',
    family: 'culture',
    check: c => c.hex === '#25D366',
  },
  {
    id: 'culture-discord-blurple',
    name: 'Discord 紫',
    description: 'HEX 精确等于 #5865F2',
    family: 'culture',
    check: c => c.hex === '#5865F2',
  },
  {
    id: 'culture-spotify-green',
    name: 'Spotify 绿',
    description: 'HEX 精确等于 #1DB954',
    family: 'culture',
    check: c => c.hex === '#1DB954',
  },
  {
    id: 'culture-tiktok-pink',
    name: 'TikTok 粉',
    description: 'HEX 精确等于 #FE2C55',
    family: 'culture',
    check: c => c.hex === '#FE2C55',
  },
  {
    id: 'culture-youtube-red',
    name: 'YouTube 红',
    description: 'HEX 精确等于 #FF0000',
    family: 'culture',
    check: c => c.hex === '#FF0000',
  },
  {
    id: 'culture-miku-green',
    name: 'Miku Miku Miku!',
    description: 'HEX 精确等于 #39C5BB',
    family: 'culture',
    check: color => exactHex(color.hex, "#39C5BB"),
  },
  {
    id: 'culture-teto-red',
    name: 'Teto Teto Teto!',
    description: 'HEX 精确等于 #B22222',
    family: 'culture',
    check: color => exactHex(color.hex, "#B22222"),
  },
];
