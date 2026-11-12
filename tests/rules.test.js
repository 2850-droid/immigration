// セキュリティルールのテスト（設計書 9.6）。
// 実行：npm test（エミュレーターを自動で起動して、終わったら止める）
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

const DAY = 24 * 60 * 60 * 1000;
const T = {
  open: 'ABCDEFGHJKLMNPQR', // 招待済み・期限内
  expired: 'KKKKKKKKKKKKKKKK', // 招待済み・期限切れ
  registered: 'RRRRRRRRRRRRRRRR', // 登録済み
};

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-immigration',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = {
      scheduledMonth: '2026-12',
      inviteType: '未定',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    const future = Timestamp.fromMillis(Date.now() + 3 * DAY);
    const past = Timestamp.fromMillis(Date.now() - DAY);
    await setDoc(doc(db, 'invites', T.open), { ...base, status: '招待済み', expiresAt: future });
    await setDoc(doc(db, 'invites', T.expired), { ...base, status: '招待済み', expiresAt: past });
    await setDoc(doc(db, 'invites', T.registered), {
      ...base,
      status: '登録済み',
      expiresAt: future,
      name: '登録済みの人',
      gameId: '111111111',
      countryNo: '1111',
      alliance: '',
      registeredAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'invite_notes', T.open), { recipientMemo: 'テスト', adminNote: '' });
    await setDoc(doc(db, 'settings', 'slots'), { normalPerMonth: 35 });
    await setDoc(doc(db, 'admins', 'admin1'), { createdAt: Timestamp.now() });
  });
});

// 登録者が送る内容（書き換えてよい項目だけ）
const registration = (extra = {}) => ({
  name: 'テスト太郎★',
  gameId: '123456789',
  countryNo: '1234',
  alliance: 'ABC',
  status: '登録済み',
  registeredAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

describe('登録者（未ログイン）', () => {
  const guest = () => env.unauthenticatedContext().firestore();

  it('1. invites を一覧取得できない', async () => {
    await assertFails(getDocs(collection(guest(), 'invites')));
  });

  it('2. 存在しないトークンは「無い」と返る', async () => {
    const snap = await assertSucceeds(getDoc(doc(guest(), 'invites', 'ZZZZZZZZZZZZZZZZ')));
    assert.equal(snap.exists(), false);
  });

  it('3. 正しいトークンの招待を1件読める', async () => {
    const snap = await assertSucceeds(getDoc(doc(guest(), 'invites', T.open)));
    assert.equal(snap.exists(), true);
  });

  it('4. invite_notes・settings・admins は読めない', async () => {
    await assertFails(getDoc(doc(guest(), 'invite_notes', T.open)));
    await assertFails(getDoc(doc(guest(), 'settings', 'slots')));
    await assertFails(getDoc(doc(guest(), 'admins', 'admin1')));
  });

  it('5. 招待済み・期限内の招待に、正しい形式で登録できる', async () => {
    await assertSucceeds(updateDoc(doc(guest(), 'invites', T.open), registration()));
  });

  it('5b. 同盟は空欄でも登録できる（無所属）', async () => {
    await assertSucceeds(updateDoc(doc(guest(), 'invites', T.open), registration({ alliance: '' })));
  });

  it('6. 期限切れの招待には登録できない', async () => {
    await assertFails(updateDoc(doc(guest(), 'invites', T.expired), registration()));
  });

  it('7. すでに登録済みの招待には、もう一度登録できない', async () => {
    await assertFails(updateDoc(doc(guest(), 'invites', T.registered), registration()));
  });

  it('8. 登録時に、移民予定月・種別・期限・状態の指定を書き換えられない', async () => {
    const ref = doc(guest(), 'invites', T.open);
    await assertFails(updateDoc(ref, registration({ scheduledMonth: '2027-01' })));
    await assertFails(updateDoc(ref, registration({ inviteType: '特別' })));
    await assertFails(updateDoc(ref, registration({ expiresAt: Timestamp.fromMillis(Date.now() + 99 * DAY) })));
    await assertFails(updateDoc(ref, registration({ status: '確定' })));
  });

  it('8b. 登録時に、余計な項目を付けられない', async () => {
    await assertFails(updateDoc(doc(guest(), 'invites', T.open), registration({ note: 'x' })));
  });

  it('8c. 形式の違う入力は登録できない', async () => {
    const ref = doc(guest(), 'invites', T.open);
    await assertFails(updateDoc(ref, registration({ gameId: '12345678' })));
    await assertFails(updateDoc(ref, registration({ gameId: '12345678a' })));
    await assertFails(updateDoc(ref, registration({ countryNo: '123' })));
    await assertFails(updateDoc(ref, registration({ alliance: 'abc' })));
    await assertFails(updateDoc(ref, registration({ alliance: 'AB' })));
    await assertFails(updateDoc(ref, registration({ name: '' })));
    await assertFails(updateDoc(ref, registration({ name: 'あ'.repeat(41) })));
    await assertFails(updateDoc(ref, registration({ name: 123 })));
  });

  it('8d. 招待の作成・削除はできない', async () => {
    await assertFails(
      setDoc(doc(guest(), 'invites', 'NNNNNNNNNNNNNNNN'), {
        scheduledMonth: '2026-12',
        status: '招待済み',
        inviteType: '未定',
        expiresAt: Timestamp.fromMillis(Date.now() + DAY),
      }),
    );
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(guest(), 'invites', T.open)));
  });
});

describe('管理者ではないログイン済みアカウント', () => {
  it('9. invites を一覧取得できない', async () => {
    const db = env.authenticatedContext('user1').firestore();
    await assertFails(getDocs(collection(db, 'invites')));
    await assertFails(getDoc(doc(db, 'invite_notes', T.open)));
  });
});

describe('管理者', () => {
  const admin = () => env.authenticatedContext('admin1').firestore();

  it('10. 一覧の取得、招待の作成、種別の設定、メモの読み書きができる', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'invites')));
    await assertSucceeds(
      setDoc(doc(admin(), 'invites', 'NNNNNNNNNNNNNNNN'), {
        scheduledMonth: '2026-12',
        status: '招待済み',
        inviteType: '未定',
        expiresAt: Timestamp.fromMillis(Date.now() + 3 * DAY),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(admin(), 'invites', T.registered), {
        inviteType: '特別',
        status: '確定',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDoc(doc(admin(), 'invite_notes', T.open)));
    await assertSucceeds(setDoc(doc(admin(), 'invite_notes', T.open), { recipientMemo: '更新', adminNote: '' }));
    await assertSucceeds(getDoc(doc(admin(), 'settings', 'slots')));
  });

  it('11. admins は自分の文書しか読めず、書き換えもできない', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'admins', 'admin1')));
    await assertFails(getDoc(doc(admin(), 'admins', 'other')));
    await assertFails(getDocs(collection(admin(), 'admins')));
    await assertFails(setDoc(doc(admin(), 'admins', 'someone'), { createdAt: serverTimestamp() }));
  });
});
