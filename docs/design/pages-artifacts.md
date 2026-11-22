# Pages 环境文件结构与分支结构

> 面向本仓库的维护者与接手者。本文回答两件事: 部署出去的 Pages 站点根里到底有什么、每个文件由谁生成;本仓库的分支布局是什么、与组织级分支规范的关系。构建与校验的实现见 [构建脚本](../../scripts/build-collection.mjs) 与 [包层清单](../../scripts/lib/manifest.mjs),信任边界与签名语义见 [收录模式与信任锚](collection-and-trust.md),操作步骤见根目录 [README](../../README.md)。

## 一、判定口径

站点根就是构建产物 dist/ 整体: 本仓库没有独立的索引服务,也没有站点模板,发布内容全部来自一次构建。按 [README](../../README.md) 的定位与 [收录模式与信任锚](collection-and-trust.md) 第五节,文件的来源只有三类:

| 来源 | 执行者 | 产物 |
|:---:|:---:|:---:|
| 构建产物 | scripts/build-collection.mjs 校验合集后复制与写出 | 根索引三件、assets/ 与 certs/ 整树、build-info.json |
| 包层清单 | 同一脚本在复制后的 dist/ 上按实际字节生成 | 每个包目录一份 manifest.json(未签名) |
| 签名产物 | 发布流程用合集 EEC 私钥对 dist/ 做整站签名 | 逐文件 <文件>.sig、web_files.json 与其签名、eec.pem、manifest.json.sig |

整站签名不在本仓库实现,发布流程也不在本仓库的工作流里;签名产物的形状依据是 [收录模式与信任锚](collection-and-trust.md) 第五节与 [构建脚本](../../scripts/build-collection.mjs) 顶部注释的组织口径,不是本仓库任何脚本的行为,见第五节的现状说明。

被签名与被校验的文件按两条互不重叠的规则确定:

| 判定 | 依据 | 结论 |
|:---:|:---:|:---:|
| 扩展名属于 .json、.html、.js、.css | [收录模式与信任锚](collection-and-trust.md) 4.4 与第五节 | 进入整站签名覆盖面 |
| 扩展名为 .md、.crt、.pub、.sig、.pem | 同上 | 不在覆盖面内: 说明文本、证书与公钥是校验的输入,签名文件本身不签自己 |

包层清单 manifest.json 是 .json,因此同样被整站签名覆盖;它的签名 manifest.json.sig 是清单的字节签名,不进清单自身([包层清单](../../scripts/lib/manifest.mjs) 第 27-28 行)。证书与公钥是 .crt 与 .pub,刻意留在覆盖面之外,避免「清单由证书签、证书又由清单担保」的循环。

## 二、Pages 环境文件结构

部署后的站点树如下。节点注释标注来源: 构建指 scripts/build-collection.mjs,清单指构建生成的包层清单,签名指发布流程的整站签名(未在本仓库实现)。

```text
dsc-humanize-inner-asset/                     Pages 站点根,即构建产物 dist/ 整体
├── meta.json                                 构建产物: 合集元数据,根索引原样复制
├── assets.json                               构建产物: 包目录索引,根索引原样复制
├── tags.json                                 构建产物: 标签词表,根索引原样复制
├── build-info.json                           构建产物: 构建统计,构建阶段写出,签名后随站发布
├── <文件>.sig                                签名产物: 每个 .json 的逐文件 CMS 分离签名
├── web_files.json                            签名产物: 整站签名清单,登记全部被签名文件
├── web_files.json.sig                        签名产物: 清单自身的签名
├── eec.pem                                   签名产物: 合集 EEC 证书副本,验签链入口
├── assets/                                   构建产物: 源码树 assets/ 整树复制
│   ├── README.md                             构建产物: 目录规范说明,随整树进入站点
│   ├── author_manifest.json                  构建产物: 已登记作者,进整站签名覆盖面
│   └── omds-chat/
│       ├── asset_manifest.json               构建产物: 该作者的包标识清单,进覆盖面
│       └── dsc-humanize-assistant/           包目录
│           ├── versions.json                 构建产物: 版本列表,进覆盖面
│           ├── manifest.json                 清单: 包层清单,构建按 dist 实际字节生成
│           ├── manifest.json.sig             签名产物: 清单签名,与整站签名同一轮产出
│           ├── 0.1.0/                        构建产物: 一个完整资产包,进覆盖面
│           │   ├── asset.json
│           │   ├── README.md                 构建产物: 包说明,不在签名覆盖面
│           │   └── persona/ labels/ strategies/ injection/  各类型内容目录
│           └── 0.1.1/                        构建产物: 同上
└── certs/                                    构建产物: 源码树 certs/ 整树复制,公开证书材料
    ├── dsc-humanize/                         根证书与其公钥,信任锚
    └── dsc-humanize-inner-asset/             合集 EEC 证书与其公钥
```

三点说明:

- 站点没有 HTML 入口页。当前发布物只有 JSON、Markdown 与证书材料,访问站点根不会得到渲染页面;页面形态属于 [收录模式与信任锚](collection-and-trust.md) 第八节未定稿的入口问题。
- dist/ 不包含源码树的 docs/、specs/、schemas/ 与 scripts/: 构建只复制根索引三件与 assets/、certs/ 两棵整树([构建脚本](../../scripts/build-collection.mjs) 第 24、26 行)。
- certs/ 同时出现在站点根与源码树,字节相同,都来自组织的证书库原样复制;站点内这份是分发副本,不是信任锚的第二来源,锚点口径见 [收录模式与信任锚](collection-and-trust.md) 4.2。

## 三、入口地址与版本化路径

| 项 | 形态 |
|:---:|:---:|
| 生产入口 | https://omds-chat.github.io/dsc-humanize-inner-asset/ ,与 [package.json](../../package.json) 的 homepage 登记一致 |
| 本地联调 | http://127.0.0.1:61120 ,登记在 .env.example 的 DSC_HUMANIZE_INNER_ASSET_PAGES_LINK;把 dist/ 起为静态服务 |
| 版本化路径 | 站点没有 version/ 目录,也没有版本化快照路径。版本化只体现在包目录内: assets/<author>/<id>/<x.y.z>/ 一目录一版本,多版本并存,versions.json 登记列表 |

组织主线仓库 DeepSeek-Chat-Enhanced(dsce)发布页面包时,会把它的三条归档并行分支的 version/ 释放合并进站点,/version/<tag>/ 是该版本的完整快照;该机制属于 dsce 自己的分支与发布流程,本仓库不参与,站点里不存在 version/ 目录。消费方取历史版本,取的是包目录内并存的历史版本目录,不是站点级的版本快照。

## 四、分支结构

本仓库只有 main 一条分支,没有并行分支。

- 全部源码、索引、证书公开材料与文档都在 main;没有与 main 无公共祖先的孤立并行分支,也没有跨构建延续的状态需要归档。
- 分支职责、命名与归档口径由组织仓库的 .github/docs/repo-spec/side-branches.md 规定。该规范第五节把无并行分支的仓库单独列为一类,本仓库属于这一类,与组织口径一致。
- 本仓库不使用 dist-history、certs、trusted-manifest、ci-memory 中的任何一个名字: 证书公开材料放在 main 的 certs/,构建产物不进版本库,包层清单随构建按实际字节重新生成,没有需要跨构建沿用的账本。
- dist/ 与 temp/ 在 .gitignore 中忽略,不进入任何分支。

## 五、现状与文档口径的差异

发布流程(整站签名与部署)没有在本仓库实现: 现有工作流 [.github/workflows/verify-and-build.yml](../../.github/workflows/verify-and-build.yml) 只做三件事——校验合集、生成未签名 dist/、复核包层清单齐全,最后把未签名产物作为 artifact 上传(第 98-102 行),没有签名步骤,也没有 deploy-pages 调用。因此:

- 本文第二节的站点树中,「签名产物」一层的形状是组织口径的约定形态,当前没有任何流水线把它变成现实;本仓库的 Pages 站点是否已按该形态发布,取决于仓库外的发布安排。
- [README](../../README.md) 与 [收录模式与信任锚](collection-and-trust.md) 描述的「CI 用合集 EEC 私钥对 dist/ 做整站签名并发布」与工作流实际能力不符,属于待补的发布流程,本文只记录差异,不改动脚本与工作流。

## 六、相关文件

| 文件 | 与本篇的关系 |
|:---:|:---:|
| [README](../../README.md) | 对外说明: 定位、收录条件、信任链概览、本地命令 |
| [收录模式与信任锚](collection-and-trust.md) | 签名覆盖面、信任边界与发布语义的定义处 |
| [文档索引](../README.md) | 全部文档的入口、冲突优先级与维护约定 |
| [构建脚本](../../scripts/build-collection.mjs) | 生成 dist/ 与包层清单的实现入口 |
| [包层清单](../../scripts/lib/manifest.mjs) | 清单位置、覆盖范围与签名的实现入口 |
| [校验工作流](../../.github/workflows/verify-and-build.yml) | 当前 CI 实际做的事: 校验、构建、上传未签名产物 |
