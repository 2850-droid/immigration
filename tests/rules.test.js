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
  deleteDoc,
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
    await setDoc(doc(db, 'admins', 'admin1'), { role: 'owner', displayName: 'オーナー', createdAt: Timestamp.now() });
    await setDoc(doc(db, 'admins', 'mgr1'), { role: 'manager', displayName: '管理者A', createdAt: Timestamp.now() });
    await setDoc(doc(db, 'admin_requests', 'newbie'), { displayName: '申請者', createdAt: Timestamp.now() });
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

  it('11. 管理者の名簿の追加は、承認の形（manager・決まった項目）に限られる', async () => {
    const ref = (id) => doc(admin(), 'admins', id);
    await assertSucceeds(getDoc(ref('admin1')));
    await assertSucceeds(getDocs(collection(admin(), 'admins')));
    await assertFails(setDoc(ref('x1'), { role: 'owner', displayName: 'x', createdAt: serverTimestamp() }));
    await assertFails(setDoc(ref('x1'), { role: 'manager', displayName: 'x', createdAt: serverTimestamp(), extra: 1 }));
    await assertFails(setDoc(ref('x1'), { role: 'manager', displayName: '', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref('x1'), { role: 'manager', displayName: '新管理者', createdAt: serverTimestamp() }));
  });

  it('11b. オーナーは、移民管理者を解任できるが、自分は消せない。名簿の書き換えはできない', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'admins', 'mgr1')));
    await assertFails(deleteDoc(doc(admin(), 'admins', 'admin1')));
    await assertFails(updateDoc(doc(admin(), 'admins', 'mgr1'), { role: 'owner' }));
  });

  it('11c. オーナーは、申請の一覧を見て、却下できる。設定も変更できる', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'admin_requests')));
    await assertSucceeds(deleteDoc(doc(admin(), 'admin_requests', 'newbie')));
    await assertSucceeds(setDoc(doc(admin(), 'settings', 'slots'), { normalPerMonth: 36 }));
  });
});

describe('移民管理者', () => {
  const mgr = () => env.authenticatedContext('mgr1').firestore();

  it('12. 招待の一覧・作成・確定・メモ・設定の閲覧ができる', async () => {
    await assertSucceeds(getDocs(collection(mgr(), 'invites')));
    await assertSucceeds(
      setDoc(doc(mgr(), 'invites', 'MMMMMMMMMMMMMMMM'), {
        scheduledMonth: '2026-12', status: '招待済み', inviteType: '未定',
        expiresAt: Timestamp.fromMillis(Date.now() + 3 * DAY),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(updateDoc(doc(mgr(), 'invites', T.registered), { status: '確定', inviteType: '普通', updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(mgr(), 'invite_notes', T.open), { recipientMemo: '更新', adminNote: '' }));
    await assertSucceeds(getDoc(doc(mgr(), 'settings', 'slots')));
  });

  it('13. 枠の設定は変更できない。名簿・申請の一覧も見られず、管理者を増やせない', async () => {
    await assertFails(setDoc(doc(mgr(), 'settings', 'slots'), { normalPerMonth: 99 }));
    await assertFails(getDocs(collection(mgr(), 'admins')));
    await assertFails(getDocs(collection(mgr(), 'admin_requests')));
    await assertFails(setDoc(doc(mgr(), 'admins', 'x1'), { role: 'manager', displayName: 'x', createdAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(mgr(), 'admins', 'admin1')));
    await assertSucceeds(getDoc(doc(mgr(), 'admins', 'mgr1')));
  });
});

describe('管理者の申請（ログイン済みだが、まだ権限のない人）', () => {
  const user = () => env.authenticatedContext('user2').firestore();

  it('14. 自分の申請だけ出せる。他人の名前では出せず、一覧も見られない', async () => {
    await assertSucceeds(setDoc(doc(user(), 'admin_requests', 'user2'), { displayName: '希望者', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(user(), 'admin_requests', 'someoneElse'), { displayName: '希望者', createdAt: serverTimestamp() }));
    await assertFails(getDocs(collection(user(), 'admin_requests')));
    await assertFails(getDocs(collection(user(), 'invites')));
  });

  it('15. 自分で自分を管理者にはできない', async () => {
    await assertFails(setDoc(doc(user(), 'admins', 'user2'), { role: 'manager', displayName: '希望者', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(user(), 'admins', 'user2'), { role: 'owner', displayName: '希望者', createdAt: serverTimestamp() }));
  });
});
