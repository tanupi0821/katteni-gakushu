# リダイレクトスタブ(旧 GitHub Pages 用)

tanupi.com への移行にともない、旧URL(`tanupi0821.github.io/katteni-gakushu/`)を
死なせないためのリダイレクトページ。App Store Connect のプライバシーポリシーURLや
公開済みアプリ(iOS 1.0.x)の `app_links.dart` が旧URLを直接参照しているため、
GitHub Pages 側は削除せず、新ドメインへ転送するだけのページに差し替えて残す。

## 中身

各ファイルは meta refresh + canonical + JS (`location.replace`) の三重でリダイレクトする。

| このフォルダ内 | 差し替え先(リポジトリ直下) | 転送先 |
|---|---|---|
| `index.html` | `index.html` | `https://tanupi.com/katteni-gakushu/` |
| `privacy-policy.html` | `privacy-policy.html` | `https://tanupi.com/katteni-gakushu/privacy-policy.html` |
| `privacy-policy-en.html` | `privacy-policy-en.html` | `https://tanupi.com/katteni-gakushu/privacy-policy-en.html` |
| `typing/index.html` | `typing/index.html` | `https://tanupi.com/typing/` |

## 手順(tanupi.com 稼働確認後)

1. tanupi.com が本番で正しく表示されることを確認する
   (特に上表の転送先4URLが実際に開けること)
2. このリポジトリ(`katteni-gakushu-site`)のルートで、このフォルダの中身を
   リポジトリ直下に上書きコピーする
   - `index.html` → 直下の `index.html` を上書き
   - `privacy-policy.html` → 直下の `privacy-policy.html` を上書き
   - `privacy-policy-en.html` → 直下の `privacy-policy-en.html` を上書き
   - `typing/index.html` → 直下の `typing/index.html` を上書き
   - `icon.png`、`shots/`、`sitemap.xml`、`google*.html` などその他のファイルは
     そのまま残してよい(削除不要)
3. 差分を確認して commit・push する(GitHub Pages なら push で自動反映)
4. push 後、実際に `https://tanupi0821.github.io/katteni-gakushu/` などへアクセスし、
   `https://tanupi.com/...` へ自動で飛ぶことを確認する
5. 確認できたら、App Store Connect のプライバシーポリシーURL/サポートURLを
   `https://tanupi.com/...` に更新する(既存アプリのURLは動き続けるので急ぐ必要はない)
6. 次回アプリアップデートで `app_links.dart` の参照先も `tanupi.com` に差し替える

## 注意

- このフォルダ自体は `katteni-gakushu-site` リポジトリの一部としてコミットしてよいが、
  **リポジトリ直下のファイルとは自動で同期しない**。上記の手順3で手動コピーすること。
- `typing/` 配下は `src/` 以下のゲーム本体を旧サイトから削除するかどうかは任意。
  リダイレクトページ(`index.html`)だけ差し替えれば `src/` が残っていても実害はない
  (直接 `typing/src/game.js` 等を叩かれない限り表には出ない)。容量が気になる場合は
  `typing/src/` ごと削除して構わない。
