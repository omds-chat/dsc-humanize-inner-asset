# 规范区

本目录与 [../schemas/](../schemas/) 一起,是本仓库对资产包格式的只读引用。格式的权威文本与权威 Schema 都在 [dsc-humanize-asset-template](https://github.com/omds-chat/dsc-humanize-asset-template),本仓库不定义格式,也不在这里改规则。

## 内容

| 文件 | 内容 |
|:---:|:---:|
| [spec-version.json](spec-version.json) | 规范版本、格式版本与 Schema 路径,字节与模板仓库一致 |
| [../schemas/asset-package.schema.json](../schemas/asset-package.schema.json) | 元数据 `asset.json` 的 Schema |
| [../schemas/content/persona.schema.json](../schemas/content/persona.schema.json) | 人物设定内容项的 Schema |
| [../schemas/content/labels.schema.json](../schemas/content/labels.schema.json) | 分类标签集内容项的 Schema |
| [../schemas/content/strategies.schema.json](../schemas/content/strategies.schema.json) | 策略规则内容项的 Schema |
| [../schemas/content/injection.schema.json](../schemas/content/injection.schema.json) | 注入文本内容项的 Schema |

规范正文不在本仓库复制,直接引用模板仓库的 [specs/asset-package-spec.md](https://github.com/omds-chat/dsc-humanize-asset-template/blob/main/specs/asset-package-spec.md)。

## 为什么保留副本

校验脚本要在离线环境与 CI 中判定包的合规性,不能联网取 Schema,也不能假设模板仓库与合集仓库同时检出。因此本目录保存当前规范版本的机器可读部分,作为校验的唯一判据来源:

- 校验脚本按 `spec-version.json` 的 `schemas` 字段定位 Schema,路径与模板仓库一致,复制过来不需要改写。
- `meta.json` 的 `assetFormat` 必须与这里的 `spec_version`、`format_version` 相等;两边不一致时校验直接失败,不静默按旧规则放行。
- 版本号只用于锁定契约,不用于比较包的优劣。

## 更新约定

- 副本只整份替换,不逐文件改:模板仓库发布新的规范版本后,在同一提交内复制新的 `specs/spec-version.json` 与 `schemas/`,再更新 `meta.json` 的 `assetFormat`。
- 不在这里补规则,也不改 Schema 的措辞:差异会让本仓库与模板仓库对同一个包给出不同结论。
- 规范主版本变化时,已收录的包需要按新版本重新校验;校验失败按错误处理,不做静默迁移。
- 副本的字节与模板仓库同版本一致是硬要求,可用文件哈希核对。
