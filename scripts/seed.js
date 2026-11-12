// 動作確認用の初期データを、起動中のエミュレーターに入れる。
// 使い方：npm run emulators で起動したまま、別のターミナルで npm run seed
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ts = (ms) => Timestamp.fromMillis(ms);

const base = {
  scheduledMonth: '2026-12',
  inviteType: '未定',
  createdAt: ts(now),
  updatedAt: ts(now),
};

const samples = [
  ['入力待ち（フォームが出る）', 'ABCDEFGHJKLMNPQR', { status: '招待済み', expiresAt: ts(now + 3 * DAY) }],
  ['失効', 'KKKKKKKKKKKKKKKK', { status: '招待済み', expiresAt: ts(now - DAY) }],
  [
    '登録済み',
    'RRRRRRRRRRRRRRRR',
    {
      status: '登録済み',
      expiresAt: ts(now + 3 * DAY),
      gameId: '111111111',
      countryNo: '1111',
      alliance: 'ABC',
      registeredAt: ts(now),
    },
  ],
  [
    '確定',
    'CCCCCCCCCCCCCCCC',
    {
      status: '確定',
      inviteType: '普通',
      expiresAt: ts(now + 3 * DAY),
      gameId: '222222222',
      countryNo: '2222',
      alliance: '',
      registeredAt: ts(now),
    },
  ],
  ['取消', 'XXXXXXXXXXXXXXXX', { status: '取消', expiresAt: ts(now + 3 * DAY) }],
];

const env = await initializeTestEnvironment({
  projectId: 'demo-immigration',
  firestore: { host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [, token, data] of samples) {
    await setDoc(doc(db, 'invites', token), { ...base, ...data });
  }
});

console.log('初期データを入れました。ブラウザで開いて確認できます：');
for (const [label, token] of samples) {
  console.log(`  ${label.padEnd(16, '　')} http://localhost:5000/#${token}`);
}
await env.cleanup();
