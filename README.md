# dsc-humanize-inner-asset

dsc-humanize 的内置资产合集: 收录组织自研、可导入的人性化资产包,合集页面由合集 EEC 签名发布。

[English](README.en-US.md) | [文档索引](docs/index.md)

## 定位

本仓库是 dsc-humanize 资产生态里的一个来源,不是内核的一部分: 只提供可导入的预设资产包,不参与分类、合并与装配,也不带任何特权字段。

- 收录对象是组织自研并维护的资产包,不面向第三方投稿;社区投稿由 [awesome-dsc-humanize-asset](https://github.com/omds-chat/awesome-dsc-humanize-asset) 收录。
- 资产包是纯数据: 不含代码,不由宿主加载,也不做代码签名。
- 分发内容就是合集本身: 没有独立的索引服务,构建产物 `dist/` 直接部署为 Pages 站点。
- 收录不等于认证。本仓库只保证分发内容与签名一致,不审查包的内容质量。

## 在资产生态里的位置

| 仓库 | 身份 | 由谁签发 | 作用 |
|:---:|:---:|:---:|:---:|
| [dsc-humanize](https://github.com/omds-chat/dsc-humanize) | 资产侧根 CA;同时是 ds-chat 生态的插件 | 自签根证书 | 定义内核与资产格式的边界,签发资产合集证书 |
| 本仓库 | 根 CA 签发的两张 EEC 之一 | `dsc-humanize` 根 CA | 收录组织自研的默认资产包 |
| [awesome-dsc-humanize-asset](https://github.com/omds-chat/awesome-dsc-humanize-asset) | 根 CA 签发的另一张 EEC | `dsc-humanize` 根 CA | 收录社区投稿的资产包 |
| [dsc-humanize-asset-template](https://github.com/omds-chat/dsc-humanize-asset-template) | 格式定义方,不含资产 | 不涉及证书 | 定义资产包格式、Schema 与校验口径 |

本仓库与社区合集地位相同,都是资产的来源之一;两者的区别在收录对象,不在格式或特权。

## 证书与信任锚

### 公开材料

公开材料按来源分目录,一个来源一个目录,字节从组织的证书库原样复制:

| 路径 | 内容 | 用途 |
|:---:|:---:|:---:|
| `certs/dsc-humanize/dsc-humanize-root-ca.crt` | 自签根证书 | 资产侧唯一信任锚 |
| `certs/dsc-humanize/dsc-humanize-root-ca-secret.pub` | 根密钥对的公钥 | 核对证书与密钥对是否配套 |
| `certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec.crt` | 本合集的 EEC 证书 | 签发整站签名,证明页面来源 |
| `certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec-secret.pub` | 合集 EEC 密钥对的公钥 | 同上,只核对配套关系 |

`-secret.pub` 是私钥推导出的公钥,可以直接公开;私钥不进本仓库,也不进 CI 的普通变量。

### 两级链

资产侧只有两级,没有中间 CA:

```text
根 CA(O=omds-chat, CN=dsc-humanize ROOT CA;自签,CA:TRUE,pathlen:0)
  certs/dsc-humanize/dsc-humanize-root-ca.crt
      │  签发
      ▼
合集 EEC(O=omds-chat, CN=dsc-humanize-inner-asset;CA:FALSE,仅数字签名)
  certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec.crt
      │  CI 用私钥对 dist/ 做整站签名
      ▼
dist/<文件>.sig、dist/web_files.json、dist/eec.pem
```

### 锚点与校验

| 约定 | 内容 |
|:---:|:---:|
| 锚在仓库里 | 信任锚是 `certs/dsc-humanize/dsc-humanize-root-ca.crt`,不从页面或索引临时取根 |
| 只认链与签名 | 证书主体名只用于展示,判断依据是链与签名 |
| 仓库不产证书 | 不生成、不签发、不续签、不替换任何证书;换证属于离线签发环节 |
| 仓库不签名 | 不实现任何签名,不使用私钥;整站签名由 CI 用合集 EEC 私钥完成 |
| 校验不用外部工具 | 只用 Node 内置 `crypto.X509Certificate` 解析证书、验链并核对公钥配对,不联网 |

链的形状、锚点位置与失败语义见 [收录模式与信任锚](docs/design/collection-and-trust.md)。

## 索引文件

索引文件只描述合集里有什么,条目内容全部来自 `assets/` 目录,脚本不推断、不编造条目:

| 文件 | 内容 |
|:---:|:---:|
| `meta.json` | 合集元数据:合集名、索引版本、所遵循的资产包格式版本 |
| `assets.json` | 包目录索引,每个条目的 `id` 唯一 |
| `tags.json` | 包标签词表,条目里的 `tag` 必须出自这里 |
| `assets/author_manifest.json` | 已登记的作者 |
| `assets/<author>/asset_manifest.json` | 该作者的包标识清单 |
| `assets/<author>/<id>/versions.json` | 该包的版本列表与当前版本 |
| `certs/` | 公开证书材料,不进入任何清单 |

`meta.json` 只声明三件事:

| 字段 | 取值 | 说明 |
|:---:|:---:|:---:|
| `name` | 非空文本 | 合集名称,构建产物的 `collection` 字段默认取它 |
| `indexVersion` | 三段数字 | 索引格式版本,索引字段变化时递增 |
| `assetFormat` | 对象 | `specVersion` 与 `formatVersion`,必须与 `specs/spec-version.json` 相等 |

`assets.json` 的条目只记录描述性字段,不复制包内内容:

```json
[
  {
    "id": "dsc-example-asset",
    "author": "omds-chat",
    "tag": ["daily"],
    "types": ["persona", "labels"]
  }
]
```

`types` 必须与该包 `latest` 版本的 `types` 一致;名称、说明、许可证等展示字段以包内 `asset.json` 为准,索引不重复。

索引为空时校验与构建直接通过,不需要任何签名材料。本仓库不编造包条目。

## 收录条件

只有同时满足以下条件的包才会被收录:

- 由 omds-chat 组织自研并维护,不接受第三方投稿。
- 符合 [资产包规范](https://github.com/omds-chat/dsc-humanize-asset-template/blob/main/specs/asset-package-spec.md):元数据字段封闭、类型声明与内容双向一致、内容项字段合法。
- 包标识全局唯一,包目录名、版本目录名与元数据一致。
- 内容变化递增版本号,不改写已发布版本。
- 不含可执行内容、模板表达式、签名材料与用户当前使用状态。
- 维护者愿意回应使用者的问题。

不收录需要脚本、需要外部服务、或无法用规范校验的包。

## 目录结构

```text
dsc-humanize-inner-asset/
├── .github/workflows/verify-and-build.yml  校验与构建
├── .env.example                            本地联调地址
├── .gitattributes                          统一 LF 换行
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── meta.json                               合集元数据
├── assets.json                             包目录索引
├── tags.json                               标签词表
├── certs/
│   ├── dsc-humanize/                       根证书与其公钥
│   └── dsc-humanize-inner-asset/           合集 EEC 与其公钥
├── assets/
│   ├── README.md                           目录规范
│   ├── author_manifest.json                已登记作者
│   └── <author>/
│       ├── asset_manifest.json             该作者的包清单
│       └── <id>/
│           ├── versions.json               版本列表
│           └── <x.y.z>/                    一个完整的资产包
│               ├── asset.json
│               ├── persona/
│               ├── labels/
│               ├── strategies/
│               └── injection/
├── docs/
│   ├── index.md
│   └── design/collection-and-trust.md
├── schemas/                                格式 Schema 的只读副本
├── specs/                                  规范版本与更新约定
└── scripts/
    ├── lib/asset-package.mjs               资产包判定
    ├── lib/collection-verify.mjs           合集判定
    ├── verify-collection.mjs               只读校验
    └── build-collection.mjs                生成 dist/
```

构建产物 `dist/` 复制根目录的 `meta.json`、`assets.json`、`tags.json` 与 `assets/`、`certs/` 整树,并写出 `build-info.json`;发布流程的整站签名再在 `dist/` 上追加 `eec.pem`、逐文件 `.sig`、`web_files.json` 与其签名。

包的目录与字段规范见 [assets/README.md](assets/README.md)。

## 标签词表

`tags.json` 是本合集的标签表,取内容主题视角:

| 标签 | 含义 |
|:---:|:---:|
| `daily` | 日常对话与陪伴 |
| `work` | 工作与事务处理 |
| `creative` | 写作、创意与发散 |
| `technical` | 技术问答与工程场景 |

标签必须从 `tags.json` 中取,未声明的标签会被校验拒绝。

| 错误码 | 级别 | 触发条件 | 处理 |
|:---:|:---:|:---:|:---:|
| `TAGS_MISSING` | 错误 | 根目录没有 `tags.json` | 补回词表;校验与构建均中止 |
| `TAGS_INVALID` | 错误 | 顶层不是字符串数组,或含空字符串项 | 按词表格式修 `tags.json` |
| `TAGS_DUPLICATE` | 警告 | 词表内出现重复标签 | 去重;不阻断发布 |
| `TAG_NOT_DECLARED` | 错误 | 条目标签不在词表内 | 改标签,或先扩词表再提交 |
| `ASSETS_INDEX_INVALID` | 错误 | 条目字段缺失、取值非法或含多余字段 | 按索引字段修 `assets.json` |
| `ASSET_TYPES_INVALID` | 错误 | 条目 `types` 为空、重复或含四类之外的标识 | 只写 persona、labels、strategies、injection |
| `ASSET_TYPES_MISMATCH` | 错误 | 条目 `types` 与 latest 版本的 `asset.json` 不一致 | 同步索引或改包 |
| `VERSIONS_INVALID` | 错误 | `versions.json` 结构或版本号非法 | 按降序、无重复、含 `latest` 修正 |
| `VERSION_DIR_MISSING` | 错误 | 版本列表里有目录不存在 | 补目录,或从列表移除 |
| `PACKAGE_*` | 错误 | 包不符合规范,具体码见校验输出 | 按输出的字段路径修包 |

错误码与级别以校验脚本的输出为准;上表列出主要错误码,完整清单见 `node scripts/verify-collection.mjs --json` 的 `problems[].code`。

## 收录流程

1. 在 `assets/<author>/<id>/<x.y.z>/` 放一个完整的资产包,元数据的 `id`、`version`、`author` 与目录名一致。
2. 在该包目录的 `versions.json` 里登记版本,按降序排列,`latest` 指向当前版本。
3. 在 `assets.json` 增加条目,写 `id`、`author`、`tag` 与 `types`;在 `assets/<author>/asset_manifest.json` 登记包标识。
4. 本地跑 `node scripts/verify-collection.mjs --dir .`;通过后跑 `node scripts/build-collection.mjs --dir . --out dist`。
5. CI 用合集 EEC 私钥对 `dist/` 做整站签名并发布。签名脚本不在本仓库,本仓库只准备未签名的 `dist/`。

任何一步失败都中止发布,不产出部分发布内容。

## 本地校验与构建

```bash
node scripts/verify-collection.mjs --dir .            # 只读校验,不写文件
node scripts/verify-collection.mjs --dir . --json     # 以 JSON 输出结果
node scripts/verify-collection.mjs --dir . --self-test # 资产包规则自检
node scripts/build-collection.mjs --dir . --out dist  # 校验通过后生成 dist/
```

- 脚本零依赖,只用 Node 内置模块;不需要安装依赖,也不需要 openssl。
- 校验与构建不涉及任何私钥;证书只被解析与验链,不会被生成或替换。
- 空合集也能直接通过:索引为空时没有包需要校验,构建仍会产出索引与公开材料。
- `dist/` 是构建产物,不进版本库。

## 联调地址

与 dsce 的联调网络对齐:`.env.example` 列出同一组本地地址,复制为 `.env` 后生效,`.env` 不进 git,也不参与构建。

| 变量 | 默认值 | 说明 |
|:---:|:---:|:---:|
| `DS_CHAT_PAGES_LINK` | `http://127.0.0.1:61117` | dsce 本体的页面地址;它同时决定 dev 服务器的主机与端口 |
| `DSC_INNER_PLUGIN_PAGES_LINK` | `http://127.0.0.1:61118` | 内部插件合集地址,用于在同一网络里核对插件侧行为 |
| `AWESOME_DSC_PLUGIN_PAGES_LINK` | `http://127.0.0.1:61119` | 社区插件合集地址,同上 |
| `DSC_HUMANIZE_INNER_ASSET_PAGES_LINK` | `http://127.0.0.1:61120` | 本合集的本地静态服务地址 |

本合集的联调必须跑在 dsce 的联调网络里,至少要有 dsce 本体:`DS_CHAT_PAGES_LINK` 不是可选项。资产侧目前没有对应的消费方变量,地址只登记在本仓库,供本地起静态服务与后续接入使用。

## 安全提示

- 校验不通过时不发布;缺公开材料同样不发布。
- 收录不等于认证。整站签名只证明分发内容与签名者一致,不代表包的内容经过审查。
- 只公开材料入库:根证书、EEC 证书与两份 `-secret.pub`。根私钥与 EEC 私钥永远不进本仓库。
- 资产包不做代码签名。用户导入后可以改、可以再导出,没有锁定项。
- 签名覆盖文件字节:换行、缩进或空白的任何改动都会让校验失败,仓库统一使用 LF。

## 许可

Apache License 2.0,见 [LICENSE](LICENSE)。
