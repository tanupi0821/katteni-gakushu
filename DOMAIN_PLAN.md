# 統合ドメイン計画

作成: 2026-08-19 / 司令塔: Fable
目的: 分散しているWeb資産(勝手に学習計画・ことのは・打鍵防衛・勉強タイプ診断)を
新規取得する独自ドメイン1つに統合する。

## 現状の資産

- `https://tanupi0821.github.io/katteni-gakushu/`
  - 勝手に学習計画の紹介ページ(index.html)
  - プライバシーポリシー 日/英(privacy-policy.html / privacy-policy-en.html)
    ※App Store Connect / アプリ内(app_links.dart)から参照されている
  - /typing/ 打鍵防衛
  - Search Console 検証ファイル、sitemap.xml
- `https://goi-grading.tanupiyota.workers.dev/privacy` — ことのはのポリシー(Workers上、採点APIと同居)
- 語彙力診断のWebページ(ローカル: Japanese word app/index.html。公開先は要確認)
- 勉強タイプ診断(未公開。sns_assets/study_mbti/ の index.html + zukan.html、単一ファイル完結)

## 提案するサイト構成(パスベース1ドメイン)

```
<新ドメイン>/
├─ /                      作品ポータル(アプリ・診断の一覧。シンプルでよい)
├─ /shindan/              勉強タイプ診断 ← バズ導線なので短いパス
│   └─ /shindan/zukan     キャラ図鑑
├─ /katteni-gakushu/      勝手に学習計画 紹介(既存を移植)
│   ├─ privacy-policy.html
│   └─ privacy-policy-en.html
├─ /kotonoha/             ことのは 紹介(新規または既存流用)
│   └─ privacy            ポリシー(Workersから静的ページに移植)
├─ /goi/                  語彙力診断(Web版)
└─ /typing/               打鍵防衛
```

- サブドメイン分割(quiz.example.com等)より運用が単純で、ドメインの評価も1つに集まる
- ホスティングは Cloudflare Pages を推奨(無料・独自ドメイン・アナリティクス付き・
  GitHub連携で自動デプロイ)。ことのは採点APIが既にWorkersなのでCloudflareに揃うと管理が楽

## ドメイン名の候補の方向性

1. 個人ブランド型: tanupi.app / tanupi.jp など — 全作品を包める。今後も増やせる
2. 主力アプリ型: katteni-gakushu.com など — アプリのブランドは立つが、診断や他アプリが間借りに見える
3. 中立レーベル型: 新しい屋号 — 自由だが認知ゼロから

推奨は 1(個人ブランド型)。取得は Cloudflare Registrar(原価売り・更新値上げなし)。

## 移行時の注意(重要)

- **旧URLを死なせない**: 公開済みアプリ(iOS 1.0.x)の app_links.dart は github.io の
  URLを直接参照している。GitHub Pages側は削除せず、新ドメインへの
  meta refresh + canonical リダイレクトページに差し替えて残す
- **ストア側のURL更新**: App Store Connect のプライバシーポリシーURL/サポートURL、
  (Play公開時も同様)を新ドメインに更新する
- **アプリ側の追従**: 次回アップデートで app_links.dart の supportSiteUrl /
  privacyPolicyUrl を新ドメインに差し替え
- **ことのはのポリシー**: Workers の /privacy は静的ページに移植し、Workers側は
  301リダイレクトに変更(採点APIはそのままWorkersで動かす)
- **Search Console**: 新ドメインで再検証し、sitemap.xml を作り直す
- 勉強タイプ診断の og:image / シェアURLは新ドメイン確定後に設定(公開前なのでリンク切れの心配なし)

## 進め方

1. ドメイン名の決定・取得(ユーザー)
2. サイトリポジトリの統合(katteni-gakushu-site を改組 or 新リポジトリ) + ポータルページ制作
3. 各資産の移植とリダイレクト設置
4. ストアURL更新 → アプリ側URL差し替え(次回リリースに同乗)
5. 勉強タイプ診断の公開(og:image生成込み) → SNS展開開始
