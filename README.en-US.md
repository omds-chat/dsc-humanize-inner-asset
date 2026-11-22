# dsc-humanize-inner-asset

The built-in asset collection for dsc-humanize: it collects in-house, importable humanization asset packages, and its pages are published under the collection EEC.

[中文](README.md) | [Docs index](docs/README.md)

## Scope

This repository is one source in the dsc-humanize asset ecosystem, not part of the kernel: it only provides importable preset asset packages. It takes no part in classification, merging or assembly, and carries no privileged fields.

- It collects asset packages maintained in-house by the organization; third-party submissions belong to [awesome-dsc-humanize-asset](https://github.com/omds-chat/awesome-dsc-humanize-asset).
- An asset package is pure data: no code, never loaded by the host, and never code-signed.
- The distributed content is the collection itself: there is no separate index service, and the build output `dist/` is deployed to GitHub Pages directly.
- Inclusion is not endorsement. This repository only guarantees that the distributed content matches its signature; it does not review package content.

## Position in the asset ecosystem

| Repository | Identity | Issued by | Role |
|:---:|:---:|:---:|:---:|
| [dsc-humanize](https://github.com/omds-chat/dsc-humanize) | Root CA for assets; also a ds-chat plugin | Self-signed root | Defines the kernel and asset boundaries, issues collection certificates |
| This repository | One of the two EECs issued by the root | `dsc-humanize` root CA | Collects the in-house default asset packages |
| [awesome-dsc-humanize-asset](https://github.com/omds-chat/awesome-dsc-humanize-asset) | The other EEC issued by the root | `dsc-humanize` root CA | Collects community asset packages |
| [dsc-humanize-asset-template](https://github.com/omds-chat/dsc-humanize-asset-template) | Format owner, holds no assets | No certificates involved | Defines the package format, schemas and validation rules |

This repository and the community collection have the same standing: both are asset sources, and the difference is what they collect, not the format or privilege.

## Certificates and trust anchor

### Public material

Public material is stored by source, one directory per source, copied byte for byte from the organization certificate store:

| Path | Content | Purpose |
|:---:|:---:|:---:|
| `certs/dsc-humanize/dsc-humanize-root-ca.crt` | Self-signed root certificate | The only trust anchor on the asset side |
| `certs/dsc-humanize/dsc-humanize-root-ca-secret.pub` | Public key of the root key pair | Confirms certificate and key pair match |
| `certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec.crt` | The collection EEC | Signs the pages, proves the source |
| `certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec-secret.pub` | Public key of the collection EEC key pair | Same check as above |

`-secret.pub` is the public key derived from a private key and can be published; private keys never enter this repository or ordinary CI variables.

### Two-level chain

The asset side has two levels and no intermediate CA:

```text
Root CA (O=omds-chat, CN=dsc-humanize ROOT CA; self-signed, CA:TRUE, pathlen:0)
  certs/dsc-humanize/dsc-humanize-root-ca.crt
      │  issues
      ▼
Collection EEC (O=omds-chat, CN=dsc-humanize-inner-asset; CA:FALSE, digital signature only)
  certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec.crt
      │  CI signs dist/ with its private key
      ▼
dist/<file>.sig, dist/web_files.json, dist/eec.pem
```

### Anchor and verification

| Rule | Content |
|:---:|:---:|
| Anchor in the repository | The anchor is `certs/dsc-humanize/dsc-humanize-root-ca.crt`; roots are never fetched from pages or indexes |
| Trust the chain, not the name | Subject names are for display; the decision comes from the chain and signatures |
| No certificates produced here | Nothing is generated, issued, renewed or replaced; issuance happens offline |
| No signing here | No signature code and no private key use; the site signature is produced by CI with the collection EEC key |
| No external tooling | Certificates are parsed, chained and paired with Node's built-in `crypto.X509Certificate`, with no network access |

The chain shape, anchor location and failure semantics are described in [collection and trust anchor](docs/design/collection-and-trust.md).

## Index files

Index files only describe what the collection contains; entries come from the `assets/` tree, and scripts neither infer nor invent them:

| File | Content |
|:---:|:---:|
| `meta.json` | Collection metadata: name, index version, asset package format version |
| `assets.json` | Package index, each `id` unique |
| `tags.json` | Tag vocabulary; every `tag` in the index must come from it |
| `assets/author_manifest.json` | Registered authors |
| `assets/<author>/asset_manifest.json` | Package ids of that author |
| `assets/<author>/<id>/versions.json` | Version list and current version of that package |
| `certs/` | Public certificate material, never part of any manifest |

`meta.json` declares three things:

| Field | Value | Meaning |
|:---:|:---:|:---:|
| `name` | Non-empty text | Collection name; the build output uses it as `collection` by default |
| `indexVersion` | Three-part number | Index format version, bumped when index fields change |
| `assetFormat` | Object | `specVersion` and `formatVersion`, which must equal `specs/spec-version.json` |

An `assets.json` entry records descriptive fields only and never copies package content:

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

`types` must match the `types` of the package's `latest` version; names, descriptions and licenses live in the package `asset.json` and are not duplicated in the index.

An empty index passes validation and build without any signing material. This repository never invents package entries.

## Inclusion requirements

A package is included only if all of the following hold:

- It is maintained in-house by omds-chat; third-party submissions are out of scope.
- It follows the [asset package specification](https://github.com/omds-chat/dsc-humanize-asset-template/blob/main/specs/asset-package-spec.md): closed metadata fields, declarations matching content in both directions, valid content fields.
- Its id is globally unique, and the package directory, version directory and metadata agree.
- Content changes bump the version; published versions are never rewritten.
- It contains no executable content, template expressions, signing material or current user state.
- A maintainer is willing to answer user questions.

Packages that need scripts, external services or cannot pass the specification are not included.

## Repository layout

```text
dsc-humanize-inner-asset/
├── .github/workflows/verify-and-build.yml  verification and build
├── .env.example                            local development links
├── .gitattributes                          LF line endings
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── meta.json                               collection metadata
├── assets.json                             package index
├── tags.json                               tag vocabulary
├── certs/
│   ├── dsc-humanize/                       root certificate and its public key
│   └── dsc-humanize-inner-asset/           collection EEC and its public key
├── assets/
│   ├── README.md                           directory specification
│   ├── author_manifest.json                registered authors
│   └── <author>/
│       ├── asset_manifest.json             package ids of that author
│       └── <id>/
│           ├── versions.json               version list
│           └── <x.y.z>/                    one complete asset package
│               ├── asset.json
│               ├── persona/
│               ├── labels/
│               ├── strategies/
│               └── injection/
├── docs/
│   ├── index.md
│   └── design/collection-and-trust.md
├── schemas/                                read-only copies of the format schemas
├── specs/                                  specification version and update rules
└── scripts/
    ├── lib/asset-package.mjs               package rules
    ├── lib/collection-verify.mjs           collection rules
    ├── verify-collection.mjs               read-only verification
    └── build-collection.mjs                produces dist/
```

The build output `dist/` copies `meta.json`, `assets.json`, `tags.json` and the whole `assets/` and `certs/` trees, writes one package-level manifest `manifest.json` per package directory, then writes `build-info.json`; the site-signing step adds `eec.pem`, per-file `.sig`, `web_files.json` and its signature.

### Package manifest

To install a package, the consumer (the dsc-humanize asset market) first fetches `manifest.json` from the package directory, then fetches every listed file and compares its SHA-512. A missing manifest rejects the whole package with `manifest-missing`, so the manifest is part of the release artifact, not an option.

| Item | Content |
|:---:|:---:|
| Location | `dist/assets/<author>/<id>/manifest.json`; its signature is `manifest.json.sig` next to it |
| Coverage | Every file in that package directory except `manifest.json` and `manifest.json.sig`, that is `versions.json` plus all files of every version directory |
| Entries | `path` relative to the package directory, such as `0.1.0/asset.json`; `sha512` as 128 lowercase hex digits; `bytes` as the file size |
| Schema version | Top-level `schemaVersion` is `1`; the consumer uses it to decide the manifest shape |
| Generation | `scripts/build-collection.mjs` hashes the actual bytes in `dist/`; the source tree carries no manifest and version directories stay closed |
| Signature | The site-signing step signs every `.json` under `dist/` with the collection EEC private key, so the signature of `manifest.json` is `manifest.json.sig` (CMS DER, `-binary -md sha512 -nocerts -noattr`) |

The manifest stops at the package layer. The organization's three-layer manifest model also has a release-root layer (L1) and an author layer (L2); this collection publishes neither, because the integrity of pages and indexes is covered by the site signature, and the manifest only answers "is every file of this package the one that was released".

| Control | What it protects | When it fails |
|:---:|:---:|:---:|
| Site signature (per-file `.sig` plus `web_files.json`) | Pages and indexes replaced after release | When the consumer verifies the signature |
| Package manifest (`manifest.json` plus `manifest.json.sig`) | Package files replaced with different bytes | When the consumer installs and compares SHA-512, or before release when verification runs |

Both are issued by the same collection EEC and do not form a cycle: the manifest is itself a `.json` and is therefore covered by the site signature, while the manifest does not list itself or `manifest.json.sig`. Replacing the manifest breaks its own signature; replacing a package file breaks the manifest comparison. Either change surfaces on one side.

Directory and field rules are in [assets/README.md](assets/README.md).

## Tag vocabulary

`tags.json` is the tag table of this collection, organized by content theme:

| Tag | Meaning |
|:---:|:---:|
| `daily` | Everyday conversation and companionship |
| `work` | Work and task handling |
| `creative` | Writing, ideation and divergence |
| `technical` | Technical Q&A and engineering |

Tags must come from `tags.json`; undeclared tags are rejected by validation.

| Code | Level | Trigger | Action |
|:---:|:---:|:---:|:---:|
| `TAGS_MISSING` | Error | `tags.json` is missing | Restore the vocabulary; verify and build abort |
| `TAGS_INVALID` | Error | Not a string array, or contains empty entries | Fix `tags.json` |
| `TAGS_DUPLICATE` | Warning | Duplicate tags in the vocabulary | Deduplicate; does not block |
| `TAG_NOT_DECLARED` | Error | An entry uses an undeclared tag | Change the tag or extend the vocabulary first |
| `ASSETS_INDEX_INVALID` | Error | Missing, invalid or extra fields in an entry | Fix `assets.json` |
| `ASSET_TYPES_INVALID` | Error | `types` empty, duplicated or outside the four types | Use persona, labels, strategies, injection only |
| `ASSET_TYPES_MISMATCH` | Error | Entry `types` differ from the latest package | Align index or package |
| `VERSIONS_INVALID` | Error | Malformed `versions.json` or version numbers | Descending, unique, containing `latest` |
| `VERSION_DIR_MISSING` | Error | A listed version has no directory | Add the directory or drop the version |
| `PACKAGE_*` | Error | The package breaks the specification; see the reported code | Fix the package at the reported field path |
| `MANIFEST_MISSING` | Warning | The package directory has no `manifest.json`; an error under `--require-manifests` | Run a build; a release directory must carry the manifest |
| `MANIFEST_PATH_MISSING`, `MANIFEST_PATH_EXTRA` | Error | The manifest misses a file or lists a missing one | Rebuild; do not edit the manifest by hand |
| `MANIFEST_HASH_MISMATCH`, `MANIFEST_BYTES_MISMATCH` | Error | The recorded SHA-512 or byte count differs from the actual file | Rebuild; released version directories never change bytes, content changes go into a new version |
| `MANIFEST_SIG_MISSING` | Warning | The manifest has no `manifest.json.sig`; an error under `--require-manifest-signatures` | Appears after the release signing step; local builds stay unsigned |
| `MANIFEST_SIG_NOT_DER`, `MANIFEST_SIG_INVALID` | Error | The signature is not CMS DER, or verification fails | Re-sign with the same collection EEC; do not edit the manifest |
| `MANIFEST_SIG_UNVERIFIABLE` | Warning | No openssl or no certificate material, so only the signature shape was checked | Recheck in CI with `openssl cms -verify` |

Codes and levels come from the validation scripts; the table lists the main ones, and the complete list is in `problems[].code` from `node scripts/verify-collection.mjs --json`.

## Inclusion workflow

1. Place a complete asset package under `assets/<author>/<id>/<x.y.z>/`; its `id`, `version` and `author` must match the paths.
2. Register the version in that package's `versions.json`, highest first, with `latest` pointing at the current version.
3. Add an entry to `assets.json` with `id`, `author`, `tag` and `types`, and register the package id in `assets/<author>/asset_manifest.json`.
4. Run `node scripts/verify-collection.mjs --dir .`; then `node scripts/build-collection.mjs --dir . --out dist`, which writes the package manifest `manifest.json` for every package directory.
5. CI signs `dist/` with the collection EEC private key and publishes it. The signing step lives outside this repository; this repository only prepares an unsigned `dist/`, and `manifest.json` is signed there like every other `.json`, producing `manifest.json.sig`.

Any failed step aborts publication; no partial output is published.

## Local verification and build

```bash
node scripts/verify-collection.mjs --dir .             # read-only verification
node scripts/verify-collection.mjs --dir . --json      # JSON output
node scripts/verify-collection.mjs --dir . --self-test # package rule self-test
node scripts/build-collection.mjs --dir . --out dist   # build after verification, including manifests
node scripts/verify-collection.mjs --dir dist --spec-dir . --require-manifests --require-manifest-signatures
                                                       # pre-release check of dist/: manifests and signatures must be in place
```

- The scripts have no dependencies and use Node built-ins only; no install step. Manifest signatures are verified with the system `openssl`; without openssl the check only warns and inspects the signature shape.
- Verification and build use no private keys; certificates are only parsed and chained, never generated or replaced.
- A missing package manifest is only a warning by default (backward compatible), while an incomplete manifest or a hash mismatch is always an error; use `--require-manifests` and `--require-manifest-signatures` to turn the two absences into errors when checking a release directory.
- `--spec-dir` lets verification read the specification area from the source tree, because `dist/` does not contain `specs/`.
- An empty collection passes: with no packages there is nothing to validate, and the build still emits the index and public material.
- `dist/` is a build artifact and is not committed.

## Development links

The addresses follow the dsce development network. `.env.example` lists the same local addresses; copy it to `.env`, which is ignored by git and unused by the build.

| Variable | Default | Meaning |
|:---:|:---:|:---:|
| `DS_CHAT_PAGES_LINK` | `http://127.0.0.1:61117` | dsce page address; it also sets the dev server host and port |
| `DSC_INNER_PLUGIN_PAGES_LINK` | `http://127.0.0.1:61118` | Inner plugin collection address |
| `AWESOME_DSC_PLUGIN_PAGES_LINK` | `http://127.0.0.1:61119` | Community plugin collection address |
| `DSC_HUMANIZE_INNER_ASSET_PAGES_LINK` | `http://127.0.0.1:61120` | Local static server address of this collection |

Development of this collection depends on the dsce network, at minimum dsce itself: `DS_CHAT_PAGES_LINK` is not optional. The asset side currently has no consumer variable, so the address is registered here for a local static server and later wiring.

## Security notes

- Nothing is published when verification fails, including missing public material.
- Inclusion is not endorsement. The site signature only proves that the distributed content matches its signer; it does not mean the content was reviewed.
- Only public material is committed: the root certificate, the EEC certificate and two `-secret.pub` files. Root and EEC private keys never enter this repository.
- Asset packages are not code-signed. Once imported, users may edit and export them; nothing is locked.
- The package manifest binds the released bytes: any content change goes into a new version directory and the build rewrites the manifest; when manifest content changes, the build deletes the no-longer-matching `manifest.json.sig` so a stale signature never ships.
- Signatures cover file bytes: any change in line endings, indentation or whitespace breaks verification, so the repository uses LF.

## License

Apache License 2.0, see [LICENSE](LICENSE).
