# 资产包目录

本目录存放合集收录的全部资产包,按「作者 / 包标识 / 版本」三层组织。目录名与清单字段一一对应,校验脚本对不上就报错。

本合集只收录组织自研的资产包。未收录包时 `assets.json` 为空,本目录下只有本文件、`author_manifest.json` 与已登记的作者目录。

## 作者目录

`assets/<author>/`

- 目录名即作者英文名称,必须与 `assets.json` 的 `author`、`assets/author_manifest.json` 的 `username` 完全一致。
- 仅允许小写字母、数字与连字符,不得以连字符开头或结尾,最长 39 字符。
- 作者目录内允许三类条目:
  - `asset_manifest.json`:该作者的包标识数组,例如 `["dsc-example-asset"]`,必需。
  - `README.md`:可选说明,面向人阅读,不参与校验。
  - 包目录:每个目录名就是一个包标识。
- 目录内出现其他文件按结构错误处理,因为作者目录只承载清单与包本体。

本合集的作者是 omds-chat 组织自身,作者目录为 `omds-chat`。该目录已建好,`asset_manifest.json` 暂为空数组:第一个包落地时,同一次提交内补上包目录、清单与索引。

## 包目录

`assets/<author>/<id>/`

- 目录名取包元数据 `asset.json` 的 `id`。规范允许包目录名任意,本合集把目录名固定为 `id`,这样索引、清单与目录三者可以互相对照。
- 包标识仅允许小写字母开头,只含小写字母、数字与连字符,长度 3 到 64。
- 包目录内必需 `versions.json`:

```json
{
  "latest": "1.0.0",
  "versions": ["1.0.0", "0.9.0"]
}
```

- `latest` 必须出现在 `versions` 内;`versions` 按版本号降序排列,不得重复。
- 同一 `id` 可以有多个版本,版本目录并存;内容变化递增版本号,不改写已发布版本的目录。

## 版本目录

`assets/<author>/<id>/<x.y.z>/`

版本目录就是一个完整的资产包,内容与格式由 [dsc-humanize-asset-template](https://github.com/omds-chat/dsc-humanize-asset-template) 的规范定义。本仓库的 `schemas/` 与 `specs/` 是该规范 1.0.0 的只读副本,校验脚本按它判定。

| 文件或目录 | 必需 | 说明 |
|:---:|:---:|:---:|
| `asset.json` | 是 | 包元数据与类型声明,字段见下表 |
| `persona/` | 按声明 | 人物设定,一个文件一项内容 |
| `labels/` | 按声明 | 分类标签集,一个文件一项内容 |
| `strategies/` | 按声明 | 策略规则,一个文件一项内容 |
| `injection/` | 按声明 | 注入文本,一个文件一项内容 |
| `README.md` | 否 | 面向人的说明,不属于内容 |

包的条目是封闭的:版本目录里只允许 `asset.json`、已声明的类型目录与可选的 `README.md`。不放签名材料,不放暂存与缓存,也不放用户当前使用状态。

## 包元数据

`asset.json` 的必填字段:

| 字段 | 取值 | 说明 |
|:---:|:---:|:---:|
| `formatVersion` | 三段数字 | 格式版本,当前 1.0.0;主版本必须与 `specs/spec-version.json` 一致 |
| `id` | 包标识 | 必须与包目录名、`assets.json` 的 `id` 一致 |
| `name` | 非空文本 | 展示名 |
| `version` | 三段数字 | 必须与版本目录名一致 |
| `description` | 非空文本 | 一句话说明 |
| `author` | 非空文本 | 必须与作者目录名一致 |
| `license` | 非空文本,可选 | 建议写 SPDX 标识 |
| `types` | 至少一类 | 取值为 persona、labels、strategies、injection,且与目录内容双向一致 |

字段是封闭的:出现本节之外的字段按格式错误整包拒绝。包内不声明默认人设、默认标签集或默认策略,默认属于用户侧选择。

## 内容项

每个类型目录下平铺 `.json` 文件,一个文件一项内容,文件名不承载语义。四类内容的字段、取值与判定口径见 [规范第七节](https://github.com/omds-chat/dsc-humanize-asset-template/blob/main/specs/asset-package-spec.md),本仓库只重复固定目录与索引相关的部分。

## 同一 id 的多个版本

- 版本目录并列存在,校验逐个进行,任一版本不合规即整包阻断。
- `assets.json` 的 `types` 必须与 `latest` 版本的 `types` 一致;老版本的类型集合可以与新版本不同,但索引只反映当前版本。
- 用户导入某一版本的包之后,包内内容与该版本逐字节一致;合集升级不改变用户已导入的内容。

## 目录示例

```text
assets/
  author_manifest.json
  omds-chat/
    asset_manifest.json
    dsc-example-asset/
      versions.json
      1.0.0/
        asset.json
        persona/
          steady.json
        labels/
          daily-chat.json
        strategies/
          daily.json
        injection/
          brief.json
```

上面的目录只说明形状,不是已收录的包;当前 `assets.json` 为空。
