# HueDle

> 每天随机获得一种颜色，看看它藏着哪些稀有徽章。

一个双模式的每日颜色收集游戏。前后端共用同一套颜色生成、徽章判定与计分逻辑，**只有种子来源和存储位置不同**。

---

## 玩法

- 每天 00:00 UTC，每位玩家独立获得一种 24 位真彩色（共 16,777,216 种）。
- 颜色由 `(身份, 日期)` 经 FNV-1a 哈希确定性地推导——**不是随机数**。
- 点「开启今日颜色」揭晓，六个 HEX 字符像老虎机一样滚动，页面背景跟随变色。
- 颜色会命中一堆规则，每条规则是一枚徽章；徽章按**实测概率**折算成 CP，汇总得到稀有度。

### 两条模式

| | 本地模式 | 登录模式 |
|---|---|---|
| 身份 | localStorage 里的匿名 UUID | 服务端账户 ID |
| 种子 | `日期:local:匿名ID` | `日期:user:用户ID` |
| 结果 | 前端纯函数计算 | 服务端计算（前端只展示） |
| 跨设备 | 不一致 | 一致 |
| 后端 | 不需要 | 需要 |

**两种模式使用不同的种子，所以同一天会得到不同的颜色。** 登录不会合并本地历史——它们本来就是两次不同的抽取。

### 抽出即定

当天首次抽取后结果就冻结了。之后无论徽章表怎么变（新增徽章、修正规则、重跑定价），**这一天都不会变**。「刷新不变」因此是无条件的。

---

## 计分：概率定价

每条徽章的 CP 不是手填的，而是由它的**实测概率**推出来的：

```
N  = 2²⁴ = 16,777,216        # 颜色空间
p  = hits / N                # 该徽章命中多少种颜色（全色域精确枚举）
ep = 100 / p                 # 该徽章的 CP
```

徽章稀有度是 `ep` 的十进制分档；**抽取稀有度是总分在全色域分布中的百分位**（神话恒为前 1%）。

这样做的好处是**同概率必然同分**——手填分值时做不到这点。实测过：`#000000` 与 `#002FA7` 的抽中概率完全相同（都是 `1/2²⁴`），手填模型却给出 2337 vs 876 CP，差两个档。

规则见 [docs/PRICING-SPEC.md](docs/PRICING-SPEC.md)。

---

## 仓库结构

```
packages/shared/   前后端共享：类型、颜色转换、种子、76 条徽章、计分
apps/web/          Vue 3 + Vite + Tailwind v4 + Pinia
apps/api/          Hono + PostgreSQL
docs/              设计文档与验证报告
```

## 快速开始

```bash
pnpm install

# 配置数据库（Postgres；Supabase 用 Session pooler 连接串最稳妥）
cp apps/api/.env.example apps/api/.env
# 编辑 apps/api/.env，填入 DATABASE_URL

pnpm -C apps/api migrate        # 建表
pnpm -C apps/api dev            # 后端 :3001
pnpm -C apps/web dev            # 前端 :5173
```

跑测试：

```bash
pnpm -r test                    # 全部
pnpm -C packages/shared test    # 177 例，纯内存，秒级
pnpm -C apps/web test           # 112 例，jsdom
pnpm -C apps/api test           # 34 例，需要真实 Postgres
```

> `apps/api` 的测试连真实 Postgres，但跑在独立 schema `huedle_test` 里，**不会碰 `public`**。
>
> 它还强制校验 `extra_float_digits=1`：Supabase 默认是 0，会让 `cp` 在存取之间丢精度
> （`20521.809090190152` → `20521.8090901902`），那样「同概率同分」在最后几位就不成立。
> 参数不生效时服务会**拒绝启动**，而不是悄悄降级。

## 改了徽章规则之后必须重跑

徽章的 CP 来自全色域枚举，所以改动任何 `check` 之后都要重新枚举，否则定价会和规则脱节：

```bash
pnpm -C packages/shared run enumerate      # 2²⁴ 全色域枚举，约 3 分钟，重写 src/pricing.gen.ts
pnpm -C packages/shared run supersession   # 取代审计：有没有徽章被 100% 取代（即永不单独计分）
pnpm -C packages/shared run docs           # 重新生成 docs/BADGES.md
```

`packages/shared` 里有一条一致性测试会在 `docs/BADGES.md` 过期时失败，提醒你跑 `run docs`。

---

## CI

`.github/workflows/ci.yml` 在每次 push 与 PR 上跑全部 323 个测试：

| Job | 内容 |
|---|---|
| `shared + web` | shared 177 例、web 类型检查 + 173 例 + 构建 |
| `api` | api 类型检查 + 52 例，**自带一个 Postgres 17 service 容器** |

**不需要任何配置**，push 就会跑。它存在的意义不是"证明代码能跑"，而是让那些**一致性约束真的会被执行**：
`docs/BADGES.md` 与代码是否同步、徽章定价与规则是否脱节、取代组是否合法、界面文案是否踩红线、
登录模式是否污染了本地存储键。**没人跑的测试等于没有测试。**

> 本地跑 `apps/api` 测试要 100 多秒（数据库在美东，每次查询跨洋 ~343ms）；
> CI 里 Postgres 与 runner 同机，这一项会掉到几秒。

## 部署

### 前端 → GitHub Pages

`.github/workflows/deploy-pages.yml` 会在 push 到 `main` 后自动构建并部署。**首次需要在仓库里开启**：

> Settings → Pages → **Source** 选 **GitHub Actions**

站点地址：`https://<用户名>.github.io/HueDle/`

三个容易踩的坑，配置里都已经处理好了——改动时别弄丢：

1. **必须设 `base`**：项目页在子路径下，构建要用 `vite build --base=/HueDle/`，
   否则资源路径全错。
2. **必须显式给路由传 base**：`createWebHistory(import.meta.env.BASE_URL)`。
   `createWebHistory()` 不读 Vite 的 `base`（它只认 `<base href>` 标签），
   不传就会**一条路由都匹配不上**——页面只剩导航外壳、内容空白，
   而本地开发看不出任何问题。
3. **必须生成 `404.html`**：GitHub Pages 没有 SPA rewrite，直接访问 `/HueDle/me` 会 404。
   把 `index.html` 复制成 `404.html` 作为兜底，应用启动后由前端路由接管。

### 后端 → Railway（仓库根目录已有 `Dockerfile`）

1. Railway → **New Project** → **Deploy from GitHub repo** → 选 `HueDle`
   （根目录有 `Dockerfile`，它会直接用它构建，不走自动检测）

2. **把区域设成与 Supabase 同区**（通常是 `us-east`）
   > 这一条比看起来重要：一次请求有 1–3 次数据库查询，但只有一跳浏览器→API。
   > 让多跳的那一段走局域网，整体快一倍以上。

3. **Variables** 里设三个：

   | 变量 | 值 | 说明 |
   |---|---|---|
   | `DATABASE_URL` | Session pooler 连接串 | **别用直连**，见下面的坑 ① |
   | `HUEDLE_ORIGIN` | `https://zhFelix.github.io` | CORS 白名单，不带结尾斜杠 |
   | `HUEDLE_TRUST_PROXY` | `1` | **必须设**，见坑 ② |

   `PORT` 不用设——Railway 会注入，代码读的就是它。

4. Settings → Networking → **Generate Domain**，拿到 `https://xxx.up.railway.app`

5. **建表跑一次**（本地执行，用的是 Railway 的环境变量）：

   ```bash
   railway run pnpm -C apps/api migrate
   ```

6. 回到前端仓库，加一个 Actions 变量（**Settings → Secrets and variables → Actions → Variables**）：

   | 变量 | 值 |
   |---|---|
   | `API_BASE_URL` | `https://xxx.up.railway.app`（**必须 https**） |

   然后手动重跑一次 `Deploy web to GitHub Pages`。

#### ⚠️ 三个部署时才会暴露的坑

**① `DATABASE_URL` 要用 Session pooler，不能用直连**

`db.<ref>.supabase.co` 是 **IPv6-only**。你本机有 IPv6 所以本地能连，但 Railway 的出口不一定有。
pooler 是 IPv4。地址在 Supabase 控制台 → **Connect** → **Session pooler**。

连接池曾有个会**直接导致服务起不来**的问题，已经解决，但机制值得记下来：

`extra_float_digits = 1` 原本是通过 libpq 的 `options` 启动参数下发的。
**Supabase 的 Supavisor 连接池会把 `options` 整个吃掉**——实测：

| 连接方式 | 端口 | 靠 `options` 时 | float8 精度 |
|---|---|---|---|
| 直连 | 5432 | `1` ✅ | 完整 |
| Session pooler | 5432 | **`0` ❌** | **丢失** |
| Transaction pooler | 6543 | **`0` ❌** | **丢失** |

而 API 启动时会 `SHOW extra_float_digits`，不等于 1 就**拒绝启动**——
所以早期版本在连接池后面是起不来的。

**修法**：不再只依赖启动参数，改成连接建立后主动 `SET extra_float_digits = 1`
（见 `apps/api/src/db/index.ts` 的 `sessionSetupSql`）。实测三种方式全部生效且稳定。

安全性依据不是"应该能行"：`pg-pool` 的 `_acquireClient()` 里 `emit('connect', client)`
是**同步**触发的，发生在连接交给调用方**之前**；`pg` 的 Client 按队列顺序发送查询。
所以那条 `SET` 一定排在任何业务查询之前。这一点有专门的测试锁着。

> 直连仍然更好（少一层代理、少一次往返），所以能开 Railway 的 outbound IPv6 就优先用直连。
> 但连接池现在**不再是禁区**了。

**② `HUEDLE_TRUST_PROXY=1` 必须设，否则限流会误伤所有人**

限流按客户端 IP 分桶（10 次/60 秒）。不信任 `X-Forwarded-For` 时，代码用的是
**TCP 连接的来源地址**——而在 Railway 后面，那是**代理的地址**，对所有用户都一样。
结果就是所有人挤在同一个桶里：第 11 个人登录就把全站挡住了。

（反过来，只有确实跑在反向代理后面才该打开它。直连部署下任何客户端都能自己伪造
`X-Forwarded-For`，无条件采信等于给限流留一个一行即破的后门——所以默认是关的。）

**③ 部署后最多 10 分钟，已有访客可能拿到旧包**

GitHub Pages 给**所有**文件（含 `index.html`）都设了 `cache-control: max-age=600`，
而且不允许自定义响应头。所以部署完成后，之前访问过的浏览器会继续用旧的
`index.html`，它引用的还是旧 bundle。

表现很有迷惑性：**网站看起来完全正常，只有某个功能悄悄坏掉**。
实测踩过一次——改了 `API_BASE_URL`，但浏览器加载的是旧包，里面内联的还是
`http://localhost:3001`，于是 https 页面请求 http 被按混合内容拦掉，
前端只报「无法连接服务器」。

排查手法：在控制台看实际加载的是哪个 bundle

```js
document.querySelector('script[src]').src
```

文件名是内容哈希的，**没变就说明拿到的是旧包**。强制刷新（Ctrl/Cmd + Shift + R）
或用无痕窗口即可。

**④ 前端是 https，后端也必须是 https**

否则浏览器会以混合内容为由直接拦掉请求。Railway 生成的域名自带 TLS。

> **后端没部署也能用**：本地模式完全不需要后端，站点依然是一个能完整游玩的游戏，只是登录模式会连不上。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | 主设计文档：双模式、计分、接口、数据库、本地存储 |
| [docs/BADGE-SPEC.md](docs/BADGE-SPEC.md) | 徽章作者契约：类型、可用 API、反冗余、`group` 取代组 |
| [docs/PRICING-SPEC.md](docs/PRICING-SPEC.md) | 概率定价：`ep = 100/p`、两套稀有度阶梯 |
| [docs/BADGES.md](docs/BADGES.md) | 76 条徽章总表（**自动生成，勿手改**） |
| [docs/research/](docs/research/) | RNGdle 机制研究、取代审计、定价迁移报告 |

## 开发约束

- **徽章定义里没有 `cp` / `rarity`**。作者只写判定规则，分值由枚举导出——想让它更稀有就写更窄的规则，而不是「标个 mythic」。
- **不许手改生成文件**：`src/pricing.gen.ts`、`docs/BADGES.md`。
- `family` 只用于图鉴分类；计分时的去重靠 `group`（取代组，同组只取最高分）。
- **登录模式不得写 `huedle:daily` / `huedle:history` / `huedle:streak`**——那三个键属于本地模式，登出后要能原样恢复。
- **账户种子只能是服务端分配的 UUID**。用户名或任何客户端字符串都不得参与种子，否则玩家能 grind 出一个「未来天天出稀有颜色」的身份。
