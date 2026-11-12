# 移民管理アプリ（第1段階：ルールと登録フォーム）

設計書の「9. 詳細仕様」を形にした、最初の部分です。

- `firestore.rules`：セキュリティルール（設計書 9.5）
- `public/`：招待URLから開く登録フォームと状況確認のページ
- `tests/rules.test.js`：権限テスト（設計書 9.6）
- `tests/logic.test.js`：入力チェックなどの単体テスト
- `scripts/seed.js`：動作確認用の初期データ

## 重要：まだ確認できていないこと

- `public/logic.js` の部分は、Node.js で単体テストを実行して通っています（`node --test tests/logic.test.js`）。
- **セキュリティルールと権限テストは、作成した環境でエミュレーターを動かせなかったため、まだ一度も実行していません。** 手元で `npm test` を実行して、すべて通ることを確認してから使ってください。通らないテストがあれば、そのメッセージをそのまま共有してください。
- 画面（`public/app.js`）も、ブラウザではまだ動かしていません。

## 必要なもの

- Node.js 18以上
- Java（Firestoreエミュレーターが使います。足りない場合は、起動時のメッセージに従ってください）
- Firebase CLI：`npm install -g firebase-tools`

Firebaseにログインしなくても、プロジェクトIDが `demo-` で始まる設定（`.firebaserc` のとおり）なら、エミュレーターは動きます。

## 手順

1. このフォルダで `npm install`
2. 権限テスト：`npm test`（エミュレーターを自動で起動して、終わると止まります）
3. 画面の確認：
   - 1つ目のターミナルで `npm run emulators`
   - 2つ目のターミナルで `npm run seed`（動作確認用の招待が入り、開くURLが表示されます）
   - 表示されたURLをブラウザで開く（例：`http://localhost:5000/#ABCDEFGHJKLMNPQR`）

初期データには、入力待ち・失効・登録済み・確定・取消の5種類の招待が入ります。

## 本番に出すとき（Firebaseにログインできるようになってから）

1. Firebaseコンソールでプロジェクトを作り、Firestoreを有効にする
2. `public/firebase-config.js` の値を、コンソールの設定値に置き換える
3. `.firebaserc` のプロジェクトIDを、作ったプロジェクトのIDに変える
4. `firebase deploy --only firestore:rules,hosting`

公開前に、Firestoreの「テストモード」のルール（誰でも読み書きできる状態）になっていないか、必ず確認してください。

## 注意

- 状態の画面に種別（普通／特別）は出していませんが、`invites` の文書自体は、トークンを知っている本人が技術的には読めます。完全に隠したい場合は、種別を `invite_notes`（管理者だけが読める）に移します。
- 次の段階は、管理者のログインと、招待の作成です。
