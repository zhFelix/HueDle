# 定价迁移报告：手填 CP → 概率定价（EP）

> **本文件由 `pnpm -C packages/shared run enumerate` 自动生成，请勿手改。**
> 契约：[PRICING-SPEC.md](../PRICING-SPEC.md) 第 2/3/4/5/6/7 节；
> 数据源：全色域 2²⁴ 精确枚举（非采样）。
> 本阶段**只出数据和报告**：未改计分模型，未改任何徽章定义，`PRICING` 尚未接入 `calculateScore`。

## 0. 生成指纹

- 徽章条数：**128**
- 全色域：16777216（2²⁴）
- 第一趟（hits）耗时：**132.20 s**
- 第二趟（总分）耗时：**135.79 s**
- 两趟合计：**267.99 s**
- `src/pricing.gen.ts` md5：`4ae09abd6a888e38a4778b9ed97bc769`
- 取代组：2 个（`casino-rank-count`、`casino-sequence`），共 11 条成员

## 1. 总览

- `ep` 范围：**107 … 1677721600**（hits = 15644160 … 1）
- 最稀有的徽章：`channel-extreme-shift`（hits = 1，ep = 1677721600）
- 数量级跨度：**7.19 个数量级**（ep_max / ep_min = 1.56e+7）

### 1.1 新 rarity 分布 vs 旧 rarity 分布

| 档位 | 旧（手填） | 新（ep 导出） | 变化 |
|---|---:|---:|---:|
| `common` | 17 | 17 | 0 |
| `uncommon` | 16 | 16 | 0 |
| `rare` | 23 | 23 | 0 |
| `epic` | 19 | 19 | 0 |
| `anomaly` | 20 | 20 | 0 |
| `mythic` | 31 | 33 | +2 |

- 档位发生变化的条目：**0 / 128**（升档 0，降档 0）

## 2. 逐条对照表（按 `ep` 降序）

| id | 名称 | hits | p | ep | 旧 rarity | 新 rarity | 旧 CP | 档位变化 |
|---|---|---:|---:|---:|---|---|---:|---|
| `channel-extreme-shift` | 极值错位 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-bamboo-green` | 竹青 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-discord-blurple` | Discord 紫 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-facebook-blue` | Facebook 蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-instagram-pink` | Instagram 粉 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-klein-blue` | 克莱因蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-marrs-green` | 马尔斯绿 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-miku-green` | Miku Miku Miku! | 1 | 5.960e-8 | 1677721600 | — | `mythic` | — | **新增** |
| `culture-prussian-blue` | 普鲁士蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-rouge` | 胭脂 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-spotify-green` | Spotify 绿 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-teto-red` | Teto Teto Teto! | 1 | 5.960e-8 | 1677721600 | — | `mythic` | — | **新增** |
| `culture-tiffany-blue` | 蒂芙尼蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-tiktok-pink` | TikTok 粉 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-titian-red` | 提香红 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-van-gogh-blue` | 梵高星空蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-whatsapp-green` | WhatsApp 绿 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `culture-youtube-red` | YouTube 红 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `extreme-absolute-black` | 绝对零度 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `extreme-absolute-white` | 白垩尽头 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `lucky-golden-tone` | 金玉满堂 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `pure-dim-blue` | 暗蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `pure-dim-green` | 暗绿 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `pure-dim-red` | 暗赤 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `pure-dim-yellow` | 暗黄 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `pure-magenta-full` | 品红满值 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | — | = |
| `gray-binary-power` | 灰之幂 | 8 | 4.768e-7 | 209715200 | `mythic` | `mythic` | — | = |
| `casino-six-kind` | 六条同辉 | 16 | 9.537e-7 | 104857600 | `mythic` | `mythic` | — | = |
| `gray-multiple-16` | 十六分灰 | 16 | 9.537e-7 | 104857600 | `mythic` | `mythic` | — | = |
| `gray-core-echo` | 灰核残响 | 18 | 1.073e-6 | 93206755.55555555 | `mythic` | `mythic` | — | = |
| `math-doubling-ladder` | 倍增之链 | 18 | 1.073e-6 | 93206755.55555555 | `mythic` | `mythic` | — | = |
| `gray-palindrome` | 灰之回文 | 35 | 2.086e-6 | 47934902.85714286 | `mythic` | `mythic` | — | = |
| `gray-prime` | 灰之质数 | 54 | 3.219e-6 | 31068918.51851852 | `mythic` | `mythic` | — | = |
| `math-catalan-trinity` | 加泰三连 | 216 | 1.287e-5 | 7767229.62962963 | `anomaly` | `anomaly` | — | = |
| `pattern-alternating` | 交错排列 | 240 | 1.431e-5 | 6990506.666666667 | `anomaly` | `anomaly` | — | = |
| `pattern-triple-blocks` | 三三分块 | 240 | 1.431e-5 | 6990506.666666667 | `anomaly` | `anomaly` | — | = |
| `pure-cyan-twin` | 青碧双峰 | 255 | 1.520e-5 | 6579300.392156863 | `anomaly` | `anomaly` | — | = |
| `pure-only-blue` | 唯蓝 | 255 | 1.520e-5 | 6579300.392156863 | `anomaly` | `anomaly` | — | = |
| `pure-only-green` | 唯绿 | 255 | 1.520e-5 | 6579300.392156863 | `anomaly` | `anomaly` | — | = |
| `pure-only-red` | 唯赤 | 255 | 1.520e-5 | 6579300.392156863 | `anomaly` | `anomaly` | — | = |
| `pure-yellow-twin` | 鹅黄双峰 | 255 | 1.520e-5 | 6579300.392156863 | `anomaly` | `anomaly` | — | = |
| `gray-true-monochrome` | 灰阶行者 | 256 | 1.526e-5 | 6553600 | `anomaly` | `anomaly` | — | = |
| `gray-mid-zone` | 中庸灰域 | 393 | 2.342e-5 | 4269011.704834606 | `anomaly` | `anomaly` | — | = |
| `math-power-trinity` | 幂次三重 | 512 | 3.052e-5 | 3276800 | `anomaly` | `anomaly` | — | = |
| `casino-royal` | 皇家同花顺 | 720 | 4.292e-5 | 2330168.888888889 | `anomaly` | `anomaly` | — | = |
| `extreme-dual-max` | 双峰满值 | 765 | 4.560e-5 | 2193100.1307189544 | `anomaly` | `anomaly` | — | = |
| `extreme-ceiling-glow` | 贴顶余晖 | 815 | 4.858e-5 | 2058554.1104294478 | `anomaly` | `anomaly` | — | = |
| `extreme-floor-glow` | 贴地微光 | 815 | 4.858e-5 | 2058554.1104294478 | `anomaly` | `anomaly` | — | = |
| `math-pythagorean-triad` | 勾股三数 | 1014 | 6.044e-5 | 1654557.7909270218 | `anomaly` | `anomaly` | — | = |
| `gray-frost-zone` | 霜白灰域 | 1345 | 8.017e-5 | 1247376.654275093 | `anomaly` | `anomaly` | — | = |
| `gray-shadow-zone` | 幽影灰域 | 1345 | 8.017e-5 | 1247376.654275093 | `anomaly` | `anomaly` | — | = |
| `casino-five-kind` | 五条通天 | 1456 | 8.678e-5 | 1152281.3186813188 | `anomaly` | `anomaly` | — | = |
| `extreme-full-span` | 双极贯通 | 1530 | 9.120e-5 | 1096550.0653594772 | `anomaly` | `anomaly` | — | = |
| `math-fibonacci-trinity` | 斐波那契 | 2197 | 1.310e-4 | 763642.0573509331 | `epic` | `epic` | — | = |
| `casino-three-three` | 三三同辉 | 2400 | 1.431e-4 | 699050.6666666666 | `epic` | `epic` | — | = |
| `casino-four-two` | 四二组合 | 3600 | 2.146e-4 | 466033.77777777775 | `epic` | `epic` | — | = |
| `math-square-trinity` | 完全平方 | 4096 | 2.441e-4 | 409600 | `epic` | `epic` | — | = |
| `pattern-double-blocks` | 二二二分块 | 4096 | 2.441e-4 | 409600 | `epic` | `epic` | — | = |
| `pattern-half-loop` | 半身回环 | 4096 | 2.441e-4 | 409600 | `epic` | `epic` | — | = |
| `pattern-palindrome-loop` | 六字回文 | 4096 | 2.441e-4 | 409600 | `epic` | `epic` | — | = |
| `gray-near-neutral` | 近灰窄带 | 4578 | 2.729e-4 | 366474.7924858017 | `epic` | `epic` | — | = |
| `lucky-sum-666` | 六六六同心 | 5050 | 3.010e-4 | 332222.099009901 | `epic` | `epic` | — | = |
| `perception-night-owl` | 暗夜低语 | 7387 | 4.403e-4 | 227118.1264383376 | `epic` | `epic` | — | = |
| `casino-straight-six` | 六连顺 | 7920 | 4.721e-4 | 211833.53535353535 | `epic` | `epic` | — | = |
| `pattern-falling-strict` | 六符递降 | 8008 | 4.773e-4 | 209505.6943056943 | `epic` | `epic` | — | = |
| `pattern-rising-strict` | 六符递升 | 8008 | 4.773e-4 | 209505.6943056943 | `epic` | `epic` | — | = |
| `casino-extreme-flush` | 极端同花 | 8192 | 4.883e-4 | 204800 | `epic` | `epic` | — | = |
| `math-triangular-trinity` | 三角三连 | 12167 | 7.252e-4 | 137891.1481877209 | `epic` | `epic` | — | = |
| `lucky-triple-eight` | 八方来财 | 15616 | 9.308e-4 | 107436.0655737705 | `epic` | `epic` | — | = |
| `lucky-triple-nine` | 九九归一 | 15616 | 9.308e-4 | 107436.0655737705 | `epic` | `epic` | — | = |
| `lucky-triple-seven` | 七连三 | 15616 | 9.308e-4 | 107436.0655737705 | `epic` | `epic` | — | = |
| `lucky-triple-six` | 六六大顺 | 15616 | 9.308e-4 | 107436.0655737705 | `epic` | `epic` | — | = |
| `perception-void-paradox` | 虚空悖论 | 17748 | 0.001058 | 94530.17804823078 | `rare` | `rare` | — | = |
| `casino-straight-pair` | 顺子带对 | 21600 | 0.001287 | 77672.29629629629 | `rare` | `rare` | — | = |
| `lucky-sum-555` | 五五五同心 | 22366 | 0.001333 | 75012.14343199499 | `rare` | `rare` | — | = |
| `extreme-single-max` | 单峰满值 | 30000 | 0.001788 | 55924.05333333334 | `rare` | `rare` | — | = |
| `lucky-sum-520` | 五二零同心 | 30381 | 0.001811 | 55222.724729271584 | `rare` | `rare` | — | = |
| `math-sum-255` | 满盈之数 | 32896 | 0.001961 | 51000.77821011673 | `rare` | `rare` | — | = |
| `math-palindrome-trinity` | 回文三重 | 42875 | 0.002556 | 39130.53294460641 | `rare` | `rare` | — | = |
| `casino-triple-pair` | 三对连环 | 50400 | 0.003004 | 33288.12698412698 | `rare` | `rare` | — | = |
| `casino-four-kind` | 四条压阵 | 55456 | 0.003305 | 30253.202538949798 | `rare` | `rare` | — | = |
| `lucky-tail-double-eight` | 双八压轴 | 65536 | 0.003906 | 25600 | `rare` | `rare` | — | = |
| `pattern-mirror-bytes` | 首尾呼应 | 65536 | 0.003906 | 25600 | `rare` | `rare` | — | = |
| `perception-daylight` | 炽白之昼 | 70604 | 0.004208 | 23762.415727154268 | `rare` | `rare` | — | = |
| `channel-tight-spread` | 通道紧密 | 82426 | 0.004913 | 20354.276563220345 | `rare` | `rare` | — | = |
| `extreme-double-low` | 双低同现 | 88935 | 0.005301 | 18864.58199808849 | `rare` | `rare` | — | = |
| `math-digit-sum-equal` | 数位同和 | 92542 | 0.005516 | 18129.29912904411 | `rare` | `rare` | — | = |
| `channel-twin-high` | 双峰突起 | 97155 | 0.005791 | 17268.504966290977 | `rare` | `rare` | — | = |
| `math-arithmetic-triad` | 等差三数 | 97536 | 0.005814 | 17201.049868766404 | `rare` | `rare` | — | = |
| `math-sum-fibonacci` | 斐氏和 | 106213 | 0.006331 | 15795.821603758486 | `rare` | `rare` | — | = |
| `casino-straight` | 五连顺 | 108720 | 0.006480 | 15431.58204562178 | `rare` | `rare` | — | = |
| `perception-misty` | 雾面感 | 130476 | 0.007777 | 12858.468990465679 | `rare` | `rare` | — | = |
| `channel-mid-only` | 中间地带 | 132651 | 0.007907 | 12647.636278656022 | `rare` | `rare` | — | = |
| `math-prime-trinity` | 素数之约 | 157464 | 0.009386 | 10654.635980287558 | `rare` | `rare` | — | = |
| `channel-three-peaks` | 三峰齐高 | 166375 | 0.009917 | 10083.976558978213 | `rare` | `rare` | — | = |
| `pattern-twin-peaks` | 双子星 | 195840 | 0.01167 | 8566.797385620916 | `uncommon` | `uncommon` | — | = |
| `extreme-near-span` | 近域全跨 | 198390 | 0.01182 | 8456.684308684913 | `uncommon` | `uncommon` | — | = |
| `channel-wide-spread` | 通道广域 | 199920 | 0.01192 | 8391.964785914366 | `uncommon` | `uncommon` | — | = |
| `casino-full-house` | 葫芦满堂 | 207600 | 0.01237 | 8081.510597302505 | `uncommon` | `uncommon` | — | = |
| `perception-pastel` | 粉彩色 | 213318 | 0.01271 | 7864.88528863012 | `uncommon` | `uncommon` | — | = |
| `pattern-even-glyphs` | 偶数符 | 262144 | 0.01563 | 6400 | `uncommon` | `uncommon` | — | = |
| `pattern-odd-glyphs` | 奇数符 | 262144 | 0.01563 | 6400 | `uncommon` | `uncommon` | — | = |
| `extreme-mid-extreme` | 一低一高 | 368640 | 0.02197 | 4551.111111111111 | `uncommon` | `uncommon` | — | = |
| `math-sum-perfect-square` | 平方之和 | 453595 | 0.02704 | 3698.7215467542633 | `uncommon` | `uncommon` | — | = |
| `casino-flush` | 同花 | 524288 | 0.03125 | 3200 | `uncommon` | `uncommon` | — | = |
| `lucky-avoid-four` | 避四纳八 | 634145 | 0.03780 | 2645.6435042458743 | `uncommon` | `uncommon` | — | = |
| `pattern-digit-only` | 纯数字 | 1000000 | 0.05960 | 1677.7216 | `uncommon` | `uncommon` | — | = |
| `casino-three-kind` | 三条鼎立 | 1133056 | 0.06754 | 1480.7049254405783 | `uncommon` | `uncommon` | — | = |
| `perception-lime-glow` | 青柠微光 | 1237437 | 0.07376 | 1355.8036489938477 | `uncommon` | `uncommon` | — | = |
| `perception-violet-dream` | 紫罗兰梦 | 1257769 | 0.07497 | 1333.8869061011999 | `uncommon` | `uncommon` | — | = |
| `perception-teal-breath` | 青绿之息 | 1650637 | 0.09839 | 1016.4085743867367 | `uncommon` | `uncommon` | — | = |
| `channel-far-apart` | 双峰远隔 | 1730064 | 0.1031 | 969.7453967020873 | `common` | `common` | — | = |
| `channel-all-high` | 高值通道 | 2097152 | 0.1250 | 800 | `common` | `common` | — | = |
| `channel-all-low` | 低值通道 | 2097152 | 0.1250 | 800 | `common` | `common` | — | = |
| `casino-two-pair` | 双对临门 | 2223600 | 0.1325 | 754.5069257060622 | `common` | `common` | — | = |
| `math-sum-prime` | 质数之和 | 2760769 | 0.1646 | 607.7008253859703 | `common` | `common` | — | = |
| `channel-ascending` | 递增序 | 2763520 | 0.1647 | 607.0958777211672 | `common` | `common` | — | = |
| `channel-descending` | 递减序 | 2763520 | 0.1647 | 607.0958777211672 | `common` | `common` | — | = |
| `perception-neon-alarm` | 霓虹警报 | 3123048 | 0.1861 | 537.2064726510768 | `common` | `common` | — | = |
| `perception-deep-jewel` | 深宝色 | 3264126 | 0.1946 | 513.9880016886603 | `common` | `common` | — | = |
| `perception-cool-tone` | 冷色调 | 4218071 | 0.2514 | 397.74617354710244 | `common` | `common` | — | = |
| `pattern-echo` | 重影 | 4627216 | 0.2758 | 362.5768928876456 | `common` | `common` | — | = |
| `perception-warm-tone` | 暖色调 | 5625216 | 0.3353 | 298.25016497144287 | `common` | `common` | — | = |
| `math-bitwise-or-255` | 位满八极 | 5764801 | 0.3436 | 291.0285368046529 | `common` | `common` | — | = |
| `pattern-all-distinct` | 独步六符 | 5765760 | 0.3437 | 290.980130980131 | `common` | `common` | — | = |
| `casino-pair` | 起手对子 | 11011456 | 0.6563 | 152.36146791123716 | `common` | `common` | — | = |
| `math-coprime-trinity` | 互质三数 | 13936093 | 0.8307 | 120.38679707433066 | `common` | `common` | — | = |
| `pattern-no-triple` | 无三重 | 15644160 | 0.9325 | 107.24267713958436 | `common` | `common` | — | = |

## 3. 最受影响的 10 条

| id | 旧 rarity | 新 rarity | 档位变化 | hits | ep | 原因 |
|---|---|---|---|---:|---:|---|

## 4. 分数分布（`cp` = 保留徽章的 `ep` 之和，含 group 取代）

| 统计量 | 值 |
|---|---:|
| min | 259.6041450508215 |
| p1 | 379.9909421251522 |
| p50 | 2323.451656462316 |
| p75 | 3834.761994154831 |
| p90 | 12526.940016757278 |
| p95 | 24922.294540213643 |
| p99 | 100529.00982819914 |
| max | 1946279978.04384 |
| mean | 12715.1 |
| 不同取值数 | 140245 |

分布形状要点：

- **底部是一个大原子**：最小值 259.6041450508215 覆盖 **63700** 个颜色（占 0.3797%）；
- 顶部同样是一个原子：最大值 1946279978.04384 覆盖 **1** 个颜色（占 0.0000%）；
- `max / p99 = 19360×`：最顶端的分数比「神话线」高 4 个数量级以上，
  因为一条 `hits = 1` 的徽章单独就有 `ep = 1.68×10⁹`。

### 4.1 各 ScoreRarity 档的实际占比 vs 定义区间

把分位表当阈值用（`cp < p1` → trash，`p1 ≤ cp < p50` → common，……，`cp ≥ p99` → mythic）
反算各档实际占比：

| ScoreRarity | 定义区间宽度 | 实际占比 | 实际条数 | 偏差(pp) | 边界并列块(pp) | 判定 |
|---|---:|---:|---:|---:|---:|---|
| `trash` | 1 | 0.37968% | 63700 | -0.62032 | max(0.0000, 0.9785) | ⚠️ 由并列块解释 |
| `common` | 49 | 49.37438% | 8283646 | +0.37438 | max(0.9785, 0.3286) | ⚠️ 由并列块解释 |
| `uncommon` | 25 | 25.24558% | 4235506 | +0.24558 | max(0.3286, 0.0018) | ⚠️ 由并列块解释 |
| `rare` | 15 | 15.00000% | 2516582 | -0.00000 | max(0.0018, 0.0009) | ✅ |
| `epic` | 5 | 5.00014% | 838885 | +0.00014 | max(0.0009, 0.0025) | ✅ |
| `anomaly` | 4 | 4.00013% | 671110 | +0.00013 | max(0.0025, 0.0012) | ✅ |
| `mythic` | 1 | 1.00009% | 167787 | +0.00009 | max(0.0012, 0.0000) | ✅ |

- 判定规则：偏差 ≤ 0.05pp 记 ✅；偏差超出但不超过边界并列块占比记 ⚠️（并列块整块只能落在一侧，属分位法的固有分辨率限制）；两者皆不满足记 ❌。
- 总体：**4 / 7 档偏差 ≤ 0.05pp ✅；另有 3 档偏差由边界并列块解释 ⚠️；越界档 0 个**。
- 结论：**分位表自洽（越界完全由并列解释）**。

  - `trash` 实际为 63700 条：最小值原子占 0.3797% > 1%，最近秩 `p1` 因此等于最小值，`cp < p1` 为空集；
  - `common` 因此多吃了整个底部原子，偏差 0.3744pp，由同一并列块解释；
  - 另有 4 档偏差 ≤ 0.05pp ✅；`uncommon` 偏差 0.24558pp，由其边界并列块（0.3286pp）解释 ⚠️。

## 5. 验收核对（PRICING-SPEC 第 7 节）

### 5.1 同概率同分

- 全表共 **83** 个不同的 `hits` 值；`hits` 相同的组 **14** 个；
- 组内 `ep` 不一致的组：**0**（必须为 0）；
- 最大组：`hits = 1`，共 **26** 条（`channel-extreme-shift`、`culture-bamboo-green`、`culture-discord-blurple`、`culture-facebook-blue`、`culture-instagram-pink`、`culture-klein-blue`、`culture-marrs-green`、`culture-miku-green`、`culture-prussian-blue`、`culture-rouge`、`culture-spotify-green`、`culture-teto-red`、`culture-tiffany-blue`、`culture-tiktok-pink`、`culture-titian-red`、`culture-van-gogh-blue`、`culture-whatsapp-green`、`culture-youtube-red`、`extreme-absolute-black`、`extreme-absolute-white`、`lucky-golden-tone`、`pure-dim-blue`、`pure-dim-green`、`pure-dim-red`、`pure-dim-yellow`、`pure-magenta-full`），它们的 `ep` 全部为 **1677721600**。

> 说明：`ep = 100 * N / hits` 是 `hits` 的纯函数，同 `hits` 必然同 `ep`，
> 此处是对生成数据的**数据侧复核**，不是公式重述。

### 5.2 单调性

- 验证方式：对全部 8128 个无序对逐一检查「`hits` 较小 ⟺ `ep` 较大」；
- 违反次数：**0**（必须为 0）；
- 等价做法：`ep` 是 `hits` 的严格递减函数 `100N/hits`，因此 Spearman 秩相关恒为 **−1**。

### 5.3 空徽章（`hits === 0`）—— 严重问题

**无。** 76 条徽章在全色域上均至少命中 1 个颜色，不存在永不命中的规则。✅

### 5.4 `hits === N`（全命中）

无。没有任何徽章命中全部 16,777,216 个颜色。

### 5.5 百分位自洽

验证方式：用分位表作阈值反算各档实际占比（第 4.1 节表）。

- 4 个档位偏差 ≤ 0.05pp，直接落在定义区间内 ✅；
- 3 个档位（`trash`、`common` 等边界上有并列块者）的偏差不超过该边界并列块占比，属分位法固有分辨率限制 ⚠️；
- 无法用并列解释的越界档：**0**；
- 判定：**通过（越界由并列块解释）**。
- 结构性结论：分位表本身自洽；但「按值取阈值」在并列块上的分辨率极限是真实存在的，`trash` 档当前不可达，需人决策（见第 6.1 节）。

### 5.6 可复现

- `pricing.gen.ts` 本次 md5：`4ae09abd6a888e38a4778b9ed97bc769`；
- 生成过程不含时间戳、随机数、`Set`/`Map` 迭代顺序依赖或浮点累加顺序差异；键序按 id 显式升序排序；

- **复现证据（2026-10-03，连续两次完整枚举，脚本与徽章代码完全相同）**：
  - `pricing.gen.ts`：两次 md5 均为 `78781bff78aaea7a7b0d4a9421762e05`，**逐字节相同** ✅；
  - 本报告：两次正文逐字节相同，**唯一差异是「耗时」字段**（wall-clock 实测值，天然不可复现）⚠️；
  - 复核命令：`diff <(cp 第一次) <(cp 第二次)`，或比较两次打印的 md5。

> 逐字节复现要求（PRICING-SPEC 第 7 节第 6 条）针对的是**定价数据** `pricing.gen.ts`；本报告含实测耗时，两次运行必然不同，属预期。

## 6. 需要人判断的疑点

### 6.1 `trash` 档当前不可达 —— 需决策

- 分布底部是一个大原子：`min = 259.6041450508215`（63700 色，占 0.3797%）——**它由哪几条徽章构成会随徽章表变化，这里刻意不写死**（原先硬编码为「只命中 casino-pair 一条」，增补徽章后已不成立：现在最低分同时命中 casino-pair 与 pattern-no-triple，107.24 + 152.36 = 259.60）；
- 最近秩 `p1` 因此等于最小值，`cp < p1` 是空集，`trash` 档 0 条；
- 可选处理：
  1. **接受 trash 为空**（推荐先这样）：它只影响最底档，其余 6 档不受影响；
  2. 把 trash 语义改成「`cp = 0`（未命中任何计分徽章）」——但本表最"bare"的颜色也有 152 分，trash 仍然恒空；
  3. 在并列块内部用确定性次序（如 hex 升序）人为切出 1%——会破坏「同分同档」，与验收第 1 条冲突，**不推荐**；
  4. 把 p > 0.5 的「必中型」规则（`casino-pair`，p = 65.6%）移出计分集合——这属于计分范围问题，会让总分基线归零，需单独评估。

- **需要你拍板**：选 1 还是 4（或都要）。本阶段未动。

### 6.2 总分被单条极端徽章主导（PRICING-SPEC §9 的遗留问题被实证）

- `max / p99 = 19360×`；13 条 `hits = 1` 的规则各自 `ep = 1,677,721,600`，命中任意一条即接近封顶；
- `mythic`（前 1%）内部混了两类完全不同的颜色：命中某条 1/16,777,216 精确色（cp ≈ 1.68×10⁹），以及 5.31×10⁴ ≤ cp < 1.68×10⁹ 的「常见组合」；
- 即**档位内部跨 4.5 个数量级**：百分位只说明「在人群中的位置」，不说明「绝对有多稀有」；
- 需要你决定：展示层是否做对数压缩（§9 未决），以及是否给单条 `ep` 设上限。**本阶段不动。**

### 6.3 档位跳变的合理性（逐类看，未发现计算错误）

- ✅ 合理修正：`channel-ascending` / `channel-descending` 覆盖 **16.47%** 颜色却被手填成 `epic`（CP 145/140），新模型给 `common`（ep 607）——这是手填模型最严重的错配；
- ✅ 合理修正：`culture-*` 8 条精确色原本按作者口味散落在 `uncommon`…`mythic`，现在与 `extreme-absolute-black` / `extreme-absolute-white` 等共 13 条统一为 `mythic` / `ep = 1,677,721,600`——正是「同概率同分」的核心收益；
- ⚠️ 心理落差：`pure-only-red` / `green` / `blue`（各 255 色）与 `gray-true-monochrome`（256 色）从 `common` 直跳 `anomaly`（ep ≈ 6.6×10⁶）。它们与 `culture-*` 只差 1 个数量级（255 vs 1），而手填 CP 是 10–14 vs 700（差 50 倍，方向相反）；
- ✅ 与规范预言一致：`pattern-half-loop` 由 `mythic` 降为 `epic`（↓2，PRICING-SPEC §8 已点名）；
- 结论：所有跳变都能由 `hits` 直接解释，没有发现概率算错的情形。

### 6.4 语义上「该稀有却常见 / 该常见却稀有」

- `casino-pair` p = 65.6%：作为扑克牌型确实常见，但它同时是总分基线（152 分），使「什么都没抽到」这一状态不存在 → 见 6.1 决策 4；
- `math-coprime-trinity` p = 83.1%（手填 `common` / CP 12）、`pattern-echo` p = 27.6%（CP 9）、`math-bitwise-or-255` p = 34.4%（CP 8）：与概率一致，无异议；
- 唯一「反直觉但正确」的是 13 条精确色：**克莱因蓝与纯黑难度完全相同**，因此同档同分。这是概率定价的必然后果；若希望区分，只能改规则（例如给文化色附加额外约束），不能改阈值。

### 6.5 取代组在新权重下的行为

- 全表只有 2 个 group、11 条成员（均在 casino）：`casino-rank-count`（8 条）与 `casino-sequence`（3 条），都是包含链；
- 新权重下组内取 max 仍然等于「取链最顶端」：`ep` 与 `hits` 成反比，链上越稀有者 `ep` 越大。逐条核对组内顺序（pair 152 < two-pair 755 < … < six-kind 1.05×10⁸；straight 15432 < straight-six 211834 < royal 2330169），**未出现反转**；
- ❗未验证：这 11 条成员「被同组更高 ep 取代的比例」（需要第三趟遍历）。若某条 100% 被取代，它在计分上就是死徽章。GROUP-AUDIT 就旧 CP 做过这份工作，但 ep 权重下需重跑——**建议作为下一阶段的第一项**。

### 6.6 新 rarity 分布明显膨胀

- `mythic` 4 → 33、`anomaly` 6 → 20、`rare` 28 → 23；
- 原因：十进制阈值（10⁵/10⁶/10⁷）恰好落在本表 `hits` 密集的 255–4096 区间上，是分布事实而非调参；
- 若认为 `mythic` 太多：PRICING-SPEC §8 已明确配额失效，正确做法是改规则或接受，**不要动 ep 阈值**。需要你确认接受该分布。

### 6.7 本阶段未覆盖

- 第二趟只统计了 `cp`，未记录「每个 cp 由哪些徽章组成」；若要复核 mythic 档的构成，需第三趟记录 top 贡献者；
- `PRICING` 未接入 `calculateScore`；`SCORE_THRESHOLDS` / `getRarity` 仍是旧模型，`docs/BADGES.md` 也仍是旧 CP（本阶段严禁改动）；
- 未验证 76 条两两之间的包含/重叠关系在 ep 权重下是否会产生新的「静默吞分」组合。

## 7. 复现记录

| 项目 | 值 |
|---|---|
| 生成命令 | `pnpm -C packages/shared run enumerate` |
| pricing.gen.ts md5 | `4ae09abd6a888e38a4778b9ed97bc769` |
| 第一趟耗时 | 132.20 s |
| 第二趟耗时 | 135.79 s |
| 两次运行 `pricing.gen.ts` | md5 相同（`78781bff78aaea7a7b0d4a9421762e05`），逐字节相同 ✅ |
| 两次运行本报告 | 仅「耗时」字段不同，其余逐字节相同 ⚠️ |
