# HueDle 徽章总表

本表由 `allBadges`（`packages/shared/src/badges/index.ts`）渲染生成，是徽章配额、判定条件与取代关系的只读快照。

> ⚠️ **本文件由脚本生成，请勿手改。** 修改徽章代码后请运行 `pnpm -C packages/shared run docs` 重新生成。

## 配额看板

- 徽章总数：**76**
- 家族数：**10**
- 取代组（group）：**2** 组，覆盖 **11** 条徽章
- 被取代关系数：**9**（同组内除 CP 最高者外，计分时会被吞掉的成员数）

### 按 family 分布

| family | 中文 | 条数 | 代表色 |
|---|---|---:|---|
| gray | 灰阶 | 6 | `#808080` |
| extreme | 极端 | 6 | `#FF0000` |
| pure | 纯色 | 6 | `#FF0000` |
| channel | 通道 | 6 | `#00FF00` |
| math | 数学 | 10 | `#010101` |
| perception | 感知 | 8 | `#FF6600` |
| pattern | 模式 | 8 | `#A5A5A5` |
| culture | 文化 | 8 | `#002FA7` |
| lucky | 玄学 | 6 | `#FFD700` |
| casino | 牌型 | 12 | `#C8102E` |

### 按 rarity 分布

| rarity | 条数 |
|---|---:|
| common | 11 |
| uncommon | 11 |
| rare | 14 |
| epic | 8 |
| anomaly | 16 |
| mythic | 16 |

## 家族明细

家族按规范固定顺序排列；表内保持 `allBadges` 的声明顺序。

### gray — 灰阶

- 条数：**6**
- 代表色：`#808080`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| gray-true-monochrome | 灰阶行者 | R = G = B | anomaly | 256 | 1.53e-5 | 6,553,600 | — |
| gray-near-neutral | 近灰窄带 | 三通道极差为正，且不超过 2 | epic | 4,578 | 2.73e-4 | 366,475 | — |
| gray-shadow-zone | 幽影灰域 | 三通道极差 ≤ 4，且最大值 ≤ 24 | anomaly | 1,345 | 8.02e-5 | 1,247,377 | — |
| gray-frost-zone | 霜白灰域 | 三通道极差 ≤ 4，且最小值 ≥ 231 | anomaly | 1,345 | 8.02e-5 | 1,247,377 | — |
| gray-mid-zone | 中庸灰域 | 三通道极差 ≤ 1，且三通道都落在 100–156 | anomaly | 393 | 2.34e-5 | 4,269,012 | — |
| gray-core-echo | 灰核残响 | 三通道极差 = 3，且最小值 = 128 | mythic | 18 | 1.07e-6 | 93,206,756 | — |

### extreme — 极端

- 条数：**6**
- 代表色：`#FF0000`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| extreme-absolute-black | 绝对零度 | R = G = B = 0 | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| extreme-absolute-white | 白垩尽头 | R = G = B = 255 | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| extreme-full-span | 双极贯通 | 三通道极差 = 255（一个通道为 0，另一个通道为 255） | anomaly | 1,530 | 9.12e-5 | 1,096,550 | — |
| extreme-dual-max | 双峰满值 | R、G、B 中恰有两个等于 255 | anomaly | 765 | 4.56e-5 | 2,193,100 | — |
| extreme-floor-glow | 贴地微光 | 0 < R + G + B ≤ 15 | anomaly | 815 | 4.86e-5 | 2,058,554 | — |
| extreme-ceiling-glow | 贴顶余晖 | 750 ≤ R + G + B ≤ 764 | anomaly | 815 | 4.86e-5 | 2,058,554 | — |

### pure — 纯色

- 条数：**6**
- 代表色：`#FF0000`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| pure-only-red | 唯赤 | R > 0 且 G = 0 且 B = 0 | anomaly | 255 | 1.52e-5 | 6,579,300 | — |
| pure-only-green | 唯绿 | G > 0 且 R = 0 且 B = 0 | anomaly | 255 | 1.52e-5 | 6,579,300 | — |
| pure-only-blue | 唯蓝 | B > 0 且 R = 0 且 G = 0 | anomaly | 255 | 1.52e-5 | 6,579,300 | — |
| pure-yellow-twin | 鹅黄双峰 | R = G 且 R > 0 且 B = 0 | anomaly | 255 | 1.52e-5 | 6,579,300 | — |
| pure-cyan-twin | 青碧双峰 | G = B 且 G > 0 且 R = 0 | anomaly | 255 | 1.52e-5 | 6,579,300 | — |
| pure-magenta-full | 品红满值 | R = 255 且 G = 0 且 B = 255 | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |

### channel — 通道

- 条数：**6**
- 代表色：`#00FF00`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| channel-descending | 递减序 | R > G 且 G > B | common | 2,763,520 | 16.47% | 607 | — |
| channel-ascending | 递增序 | R < G 且 G < B | common | 2,763,520 | 16.47% | 607 | — |
| channel-all-high | 高值通道 | R ≥ 128 且 G ≥ 128 且 B ≥ 128 | common | 2,097,152 | 12.50% | 800 | — |
| channel-all-low | 低值通道 | R ≤ 127 且 G ≤ 127 且 B ≤ 127 | common | 2,097,152 | 12.50% | 800 | — |
| channel-twin-high | 双峰突起 | R = G 且 R > 0 且 B > R，或 G = B 且 G > 0 且 R > G，或 R = B 且 R > 0 且 G > R | rare | 97,155 | 0.58% | 17,269 | — |
| channel-extreme-shift | 极值错位 | R = 255 且 G = 0 且 B = 128 | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |

### math — 数学

- 条数：**10**
- 代表色：`#010101`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| math-power-trinity | 幂次三重 | R、G、B 均为 2 的幂 | anomaly | 512 | 3.05e-5 | 3,276,800 | — |
| math-square-trinity | 完全平方 | R、G、B 均为完全平方数 | epic | 4,096 | 2.44e-4 | 409,600 | — |
| math-prime-trinity | 素数之约 | R、G、B 均为质数 | rare | 157,464 | 0.94% | 10,655 | — |
| math-fibonacci-trinity | 斐波那契 | R、G、B 均为斐波那契数 | epic | 2,197 | 1.31e-4 | 763,642 | — |
| math-palindrome-trinity | 回文三重 | R、G、B 均为回文数（0–9 或 11、22、…、252 这类正读反读相同的数） | rare | 42,875 | 0.26% | 39,131 | — |
| math-sum-255 | 满盈之数 | R + G + B = 255 | rare | 32,896 | 0.20% | 51,001 | — |
| math-digit-sum-equal | 数位同和 | R、G、B 的十进制数位和两两相等 | rare | 92,542 | 0.55% | 18,129 | — |
| math-coprime-trinity | 互质三数 | R、G、B 的最大公约数为 1 | common | 13,936,093 | 83.07% | 120 | — |
| math-bitwise-or-255 | 位满八极 | R、G、B 按位或的结果为 255 | common | 5,764,801 | 34.36% | 291 | — |
| math-doubling-ladder | 倍增之链 | 将 R、G、B 升序排列后成 1 : 2 : 4 的比例，且最小通道大于 0、三通道之和为完全平方数 | mythic | 18 | 1.07e-6 | 93,206,756 | — |

### perception — 感知

- 条数：**8**
- 代表色：`#FF6600`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| perception-night-owl | 暗夜低语 | 亮度 ≤ 12 且饱和度 ≤ 25 | epic | 7,387 | 4.40e-4 | 227,118 | — |
| perception-daylight | 炽白之昼 | 亮度 ≥ 90 | rare | 70,604 | 0.42% | 23,762 | — |
| perception-lime-glow | 青柠微光 | 色相 75°–105°，饱和度 ≥ 30，亮度 ≥ 20 | uncommon | 1,237,437 | 7.38% | 1,356 | — |
| perception-teal-breath | 青绿之息 | 色相 160°–200°，饱和度 ≥ 30，亮度 ≥ 20 | uncommon | 1,650,637 | 9.84% | 1,016 | — |
| perception-misty | 雾面感 | 饱和度 ≤ 10，亮度 30–70 | rare | 130,476 | 0.78% | 12,858 | — |
| perception-violet-dream | 紫罗兰梦 | 色相 265°–295°，饱和度 ≥ 30，亮度 ≥ 15 | uncommon | 1,257,769 | 7.50% | 1,334 | — |
| perception-neon-alarm | 霓虹警报 | 饱和度 ≥ 85，亮度 35–65 | common | 3,123,048 | 18.61% | 537 | — |
| perception-void-paradox | 虚空悖论 | 亮度 ≤ 12 且饱和度 ≥ 95——极暗，却近乎全饱和 | rare | 17,748 | 0.11% | 94,530 | — |

### pattern — 模式

- 条数：**8**
- 代表色：`#A5A5A5`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| pattern-echo | 重影 | HEX 的六个字符中至少存在一对相邻且相同的字符 | common | 4,627,216 | 27.58% | 363 | — |
| pattern-all-distinct | 独步六符 | HEX 的六个字符两两不同 | common | 5,765,760 | 34.37% | 291 | — |
| pattern-digit-only | 纯数字 | HEX 的六个字符全部是十进制数字 0–9 | uncommon | 1,000,000 | 5.96% | 1,678 | — |
| pattern-even-glyphs | 偶数符 | HEX 的六个字符全部取自偶数位字符集 0 / 2 / 4 / 6 / 8 / A / C / E | uncommon | 262,144 | 1.56% | 6,400 | — |
| pattern-odd-glyphs | 奇数符 | HEX 的六个字符全部取自奇数位字符集 1 / 3 / 5 / 7 / 9 / B / D / F | uncommon | 262,144 | 1.56% | 6,400 | — |
| pattern-twin-peaks | 双子星 | R、G、B 中恰好有两个相等，第三个不同 | uncommon | 195,840 | 1.17% | 8,567 | — |
| pattern-mirror-bytes | 首尾呼应 | R = B | rare | 65,536 | 0.39% | 25,600 | — |
| pattern-half-loop | 半身回环 | HEX 的前三位字符与后三位字符完全相同（如 #ABCABC） | epic | 4,096 | 2.44e-4 | 409,600 | — |

### culture — 文化

- 条数：**8**
- 代表色：`#002FA7`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| culture-klein-blue | 克莱因蓝 | HEX 精确等于 #002FA7（国际克莱因蓝 IKB） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-tiffany-blue | 蒂芙尼蓝 | HEX 精确等于 #0ABAB5（蒂芙尼蓝 / 知更鸟蛋蓝） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-marrs-green | 马尔斯绿 | HEX 精确等于 #018574（2017 年英国票选世界最受欢迎颜色） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-prussian-blue | 普鲁士蓝 | HEX 精确等于 #003153 | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-titian-red | 提香红 | HEX 精确等于 #BA3B40（提香红 / Titian red） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-van-gogh-blue | 梵高星空蓝 | HEX 精确等于 #1B3B6F（梵高《星月夜》夜空蓝近似值） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-bamboo-green | 竹青 | HEX 精确等于 #789262（中国传统色「竹青」） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |
| culture-rouge | 胭脂 | HEX 精确等于 #9D2933（中国传统色「胭脂」） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |

### lucky — 玄学

- 条数：**6**
- 代表色：`#FFD700`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| lucky-triple-six | 六六大顺 | HEX 的 6 位十六进制数字连写后含连续三个 6 | epic | 15,616 | 9.31e-4 | 107,436 | — |
| lucky-triple-eight | 八方来财 | HEX 的 6 位十六进制数字连写后含连续三个 8 | epic | 15,616 | 9.31e-4 | 107,436 | — |
| lucky-tail-double-eight | 双八压轴 | HEX 末两位为 88 | rare | 65,536 | 0.39% | 25,600 | — |
| lucky-sum-520 | 五二零同心 | R + G + B = 520（「我爱你」的谐音） | rare | 30,381 | 0.18% | 55,223 | — |
| lucky-avoid-four | 避四纳八 | HEX 的 6 位十六进制数字中不含 4，且 8 至少出现两次 | uncommon | 634,145 | 3.78% | 2,646 | — |
| lucky-golden-tone | 金玉满堂 | R = 255 且 G = 215 且 B = 0（正金 #FFD700） | mythic | 1 | 5.96e-8 | 1,677,721,600 | — |

### casino — 牌型

- 条数：**12**
- 代表色：`#C8102E`

| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |
|---|---|---|---|---:|---:|---:|---|
| casino-pair | 起手对子 | HEX 的 6 个字符中至少有一对相同 | common | 11,011,456 | 65.63% | 152 | casino-rank-count |
| casino-two-pair | 双对临门 | HEX 的 6 个字符中至少有 2 种点数各出现至少 2 次 | common | 2,223,600 | 13.25% | 755 | casino-rank-count |
| casino-triple-pair | 三对连环 | HEX 的 6 个字符中至少有 3 种点数各出现至少 2 次 | rare | 50,400 | 0.30% | 33,288 | casino-rank-count |
| casino-three-kind | 三条鼎立 | HEX 的 6 个字符中至少有一种点数出现至少 3 次 | uncommon | 1,133,056 | 6.75% | 1,481 | casino-rank-count |
| casino-full-house | 葫芦满堂 | HEX 的 6 个字符中至少有一种点数出现至少 3 次，且另有至少一种点数出现至少 2 次 | uncommon | 207,600 | 1.24% | 8,082 | casino-rank-count |
| casino-four-kind | 四条压阵 | HEX 的 6 个字符中至少有一种点数出现至少 4 次 | rare | 55,456 | 0.33% | 30,253 | casino-rank-count |
| casino-five-kind | 五条通天 | HEX 的 6 个字符中至少有一种点数出现至少 5 次 | anomaly | 1,456 | 8.68e-5 | 1,152,281 | casino-rank-count |
| casino-six-kind | 六条同辉 | HEX 的 6 个字符全部相同 | mythic | 16 | 9.54e-7 | 104,857,600 | casino-rank-count |
| casino-straight | 五连顺 | HEX 的 6 个字符中存在 5 个互不相同的点数，其点数恰为 5 个连续整数 | rare | 108,720 | 0.65% | 15,432 | casino-sequence |
| casino-straight-six | 六连顺 | HEX 的 6 个字符两两不同，且其点数恰为 6 个连续整数 | epic | 7,920 | 4.72e-4 | 211,834 | casino-sequence |
| casino-royal | 皇家同花顺 | HEX 的 6 个字符恰为 A、B、C、D、E、F 各一次（点数 10–15 的六连顺） | anomaly | 720 | 4.29e-5 | 2,330,169 | casino-sequence |
| casino-flush | 同花 | HEX 的 6 个字符全部落在 0–7（低半花色），或全部落在 8–F（高半花色） | uncommon | 524,288 | 3.13% | 3,200 | — |

## 取代组（supersession）

计分时，**同一 group 只取 CP 最高的一条**；其余成员仍算「已获得」，但不计分（superseded）。没有 `group` 的徽章全部计分。

### `casino-rank-count`（8 条）

| id | 名称 | CP | 计分 |
|---|---|---:|---|
| casino-six-kind | 六条同辉 | 104857600 | ✅ 计分 |
| casino-five-kind | 五条通天 | 1152281.3186813188 | 被取代 |
| casino-triple-pair | 三对连环 | 33288.12698412698 | 被取代 |
| casino-four-kind | 四条压阵 | 30253.202538949798 | 被取代 |
| casino-full-house | 葫芦满堂 | 8081.510597302505 | 被取代 |
| casino-three-kind | 三条鼎立 | 1480.7049254405783 | 被取代 |
| casino-two-pair | 双对临门 | 754.5069257060622 | 被取代 |
| casino-pair | 起手对子 | 152.36146791123716 | 被取代 |

- 生效：`casino-six-kind`（CP 104857600）
- 被取代：`casino-five-kind`、`casino-triple-pair`、`casino-four-kind`、`casino-full-house`、`casino-three-kind`、`casino-two-pair`、`casino-pair`

### `casino-sequence`（3 条）

| id | 名称 | CP | 计分 |
|---|---|---:|---|
| casino-royal | 皇家同花顺 | 2330168.888888889 | ✅ 计分 |
| casino-straight-six | 六连顺 | 211833.53535353535 | 被取代 |
| casino-straight | 五连顺 | 15431.58204562178 | 被取代 |

- 生效：`casino-royal`（CP 2330168.888888889）
- 被取代：`casino-straight-six`、`casino-straight`

---

本文件由 `packages/shared/src/badges/renderDoc.ts` 渲染，数据来源为 `packages/shared/src/badges/index.ts` 的 `allBadges`。
重新生成：`pnpm -C packages/shared run docs`。

**本文件由脚本生成，请勿手改。**
