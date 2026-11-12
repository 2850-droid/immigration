import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToken, validateRegistration, judgeState, formatMonth,
  adminIdToEmail, validateAdminLogin, validateAdminSignup,
  generateToken, monthOptions, validateNote, nextMonth, validateSettings, computeSlots, filterInvites,
} from '../public/logic.js';

test('トークン：正しい形式、小文字・ハイフン・空白は許す', () => {
  assert.equal(parseToken('#ABCDEFGHJKLMNPQR'), 'ABCDEFGHJKLMNPQR');
  assert.equal(parseToken('#abcd-efgh-jklm-npqr'), 'ABCDEFGHJKLMNPQR');
  assert.equal(parseToken('#ABCD%20EFGH%20JKLM%20NPQR'), 'ABCDEFGHJKLMNPQR');
});

test('トークン：紛らわしい文字、長さ違い、空は無効', () => {
  assert.equal(parseToken('#ABCDEFGHJKLMNPQI'), null); // I
  assert.equal(parseToken('#ABCDEFGHJKLMNPQO'), null); // O
  assert.equal(parseToken('#ABCDEFGHJKLMNPQ0'), null); // 0
  assert.equal(parseToken('#ABCDEFGHJKLMNPQ1'), null); // 1
  assert.equal(parseToken('#ABCDEFGHJKLMNPQ'), null); // 15文字
  assert.equal(parseToken('#ABCDEFGHJKLMNPQRS'), null); // 17文字
  assert.equal(parseToken(''), null);
  assert.equal(parseToken(undefined), null);
  assert.equal(parseToken('#%E0%A4%A'), null); // 壊れたエンコード
});

test('入力チェック：正しい入力', () => {
  const r = validateRegistration({ name: ' テスト★太郎 ', gameId: '123456789', countryNo: '1234', alliance: 'abc' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, { name: 'テスト★太郎', gameId: '123456789', countryNo: '1234', alliance: 'ABC' });
});

test('入力チェック：同盟は空欄でもよい（無所属）', () => {
  const r = validateRegistration({ name: 'A', gameId: '123456789', countryNo: '0123', alliance: '' });
  assert.equal(r.ok, true);
  assert.equal(r.values.countryNo, '0123'); // 先頭の0が残る
  assert.equal(r.values.alliance, '');
});

test('入力チェック：全角の数字・英字は半角に直して受け付ける', () => {
  const r = validateRegistration({ name: 'ＡＢ', gameId: '１２３４５６７８９', countryNo: '１２３４', alliance: 'ＡＢＣ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, { name: 'ＡＢ', gameId: '123456789', countryNo: '1234', alliance: 'ABC' }); // 名前は全角のまま
});

test('入力チェック：形式違いはエラー', () => {
  const r = validateRegistration({ name: '', gameId: '12345', countryNo: '12345', alliance: 'AB' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name && r.errors.gameId && r.errors.countryNo && r.errors.alliance);
  assert.equal(validateRegistration({ name: 'A', gameId: '12345678a', countryNo: '1234', alliance: '' }).ok, false);
  assert.equal(validateRegistration({ name: 'A', gameId: '123456789', countryNo: '1234', alliance: 'A1C' }).ok, false);
});

test('状態：期限内は招待済み、期限切れは失効、それ以外はそのまま', () => {
  const now = 1_000_000;
  const at = (ms) => ({ toMillis: () => ms });
  assert.equal(judgeState({ status: '招待済み', expiresAt: at(now + 1) }, now), '招待済み');
  assert.equal(judgeState({ status: '招待済み', expiresAt: at(now - 1) }, now), '失効');
  assert.equal(judgeState({ status: '招待済み' }, now), '失効'); // 期限がない文書は失効扱い
  assert.equal(judgeState({ status: '登録済み', expiresAt: at(now - 1) }, now), '登録済み');
  assert.equal(judgeState({ status: '確定' }, now), '確定');
  assert.equal(judgeState({ status: '取消' }, now), '取消');
});

test('月の表示', () => {
  assert.equal(formatMonth('2026-12'), '2026年12月');
  assert.equal(formatMonth('2026-01'), '2026年1月');
  assert.equal(formatMonth('2026-13'), null);
  assert.equal(formatMonth(undefined), null);
});

test('名前：20文字まで（絵文字も1文字）、空・長すぎ・制御文字はエラー', () => {
  const base = { gameId: '123456789', countryNo: '1234', alliance: '' };
  assert.equal(validateRegistration({ ...base, name: 'あ'.repeat(20) }).ok, true);
  assert.equal(validateRegistration({ ...base, name: '😀'.repeat(20) }).ok, true);
  assert.equal(validateRegistration({ ...base, name: 'あ'.repeat(21) }).ok, false);
  assert.equal(validateRegistration({ ...base, name: '   ' }).ok, false);
  assert.equal(validateRegistration({ ...base, name: 'a\nb' }).ok, false);
});

test('管理者ID：メール形式への変換', () => {
  assert.equal(adminIdToEmail(' Alice_01 '), 'alice_01@admin.invalid');
});

test('管理者ログイン：ID・パスワードの形式', () => {
  assert.equal(validateAdminLogin({ adminId: 'abc', password: '12345678' }).ok, true);
  assert.equal(validateAdminLogin({ adminId: 'ab', password: '12345678' }).ok, false);
  assert.equal(validateAdminLogin({ adminId: 'a@b', password: '12345678' }).ok, false);
  assert.equal(validateAdminLogin({ adminId: 'abc', password: '1234567' }).ok, false);
});

test('管理者申請：表示名と確認用パスワード', () => {
  const base = { adminId: 'abc', password: '12345678', passwordConfirm: '12345678', displayName: '山田' };
  assert.equal(validateAdminSignup(base).ok, true);
  assert.equal(validateAdminSignup({ ...base, displayName: ' ' }).ok, false);
  assert.equal(validateAdminSignup({ ...base, displayName: 'あ'.repeat(21) }).ok, false);
  assert.equal(validateAdminSignup({ ...base, passwordConfirm: 'x' }).ok, false);
});

test('トークン生成：16文字、使える文字だけ、毎回違う', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = generateToken();
    assert.match(t, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    assert.equal(parseToken('#' + t), t);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
});

test('月の選択肢：年またぎ', () => {
  const m = monthOptions(new Date(2026, 10, 12), 3);
  assert.deepEqual(m, ['2026-11', '2026-12', '2027-01']);
});

test('メモ：100文字まで・制御文字なし', () => {
  assert.equal(validateNote('').ok, true);
  assert.equal(validateNote('あ'.repeat(100)).ok, true);
  assert.equal(validateNote('あ'.repeat(101)).ok, false);
  assert.equal(validateNote('a\nb').ok, false);
});

test('月の繰り上げ', () => {
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(nextMonth('2026-03'), '2026-04');
});

test('枠の設定：範囲チェック', () => {
  const ok = { normalPerMonth: '35', specialCap: '3', specialMonthlyGain: '1', specialBaseAvailable: '3', inviteExpiryDays: '3', specialBaseMonth: '2026-11' };
  assert.equal(validateSettings(ok).ok, true);
  assert.equal(validateSettings({ ...ok, inviteExpiryDays: '0' }).ok, false);
  assert.equal(validateSettings({ ...ok, specialCap: '-1' }).ok, false);
  assert.equal(validateSettings({ ...ok, specialBaseMonth: '' }).ok, false);
});

test('枠の計算：普通・特別の繰り越し・取消で戻る・未定', () => {
  const NOW = Date.UTC(2026, 10, 12);
  const future = { toMillis: () => NOW + 86400000 };
  const inv = (scheduledMonth, inviteType, status) => ({ scheduledMonth, inviteType, status, expiresAt: future });
  const settings = { normalPerMonth: 35, specialCap: 3, specialMonthlyGain: 1, specialBaseMonth: '2026-11', specialBaseAvailable: 2 };
  const invites = [
    inv('2026-11', '特別', '確定'), // 11月の特別 1使用 → 残り1
    inv('2026-11', '普通', '登録済み'),
    inv('2026-11', '特別', '取消'), // 戻る
    inv('2026-12', '未定', '登録済み'),
    inv('2026-12', '未定', '招待済み'),
  ];
  const [nov, dec, jan] = computeSlots(invites, settings, ['2026-11', '2026-12', '2027-01'], NOW);
  assert.deepEqual(nov.special, { total: 2, used: 1, left: 1 });
  assert.deepEqual(nov.normal, { total: 35, used: 1, left: 34 });
  assert.equal(dec.special.total, 2); // min(3, 1+1)
  assert.equal(dec.undecided, 2);
  assert.equal(jan.special.total, 3); // min(3, 2+1)
  assert.equal(computeSlots([], settings, ['2026-10'], NOW)[0].special, null); // 基準月より前
});

test('招待の絞り込み：状態・月・種別・キーワード', () => {
  const NOW = Date.UTC(2026, 10, 12);
  const future = { toMillis: () => NOW + 86400000 };
  const past = { toMillis: () => NOW - 86400000 };
  const mk = (data, note) => ({ data: { expiresAt: future, inviteType: '未定', scheduledMonth: '2026-12', ...data }, note });
  const items = [
    mk({ status: '登録済み', name: 'ヤマダ', gameId: '111111111', countryNo: '1001', alliance: 'ABC' }),
    mk({ status: '確定', inviteType: '特別', name: 'Suzuki', gameId: '222222222', countryNo: '1002', alliance: '', scheduledMonth: '2027-01' }, { sendNote: 'Aさん経由' }),
    mk({ status: '招待済み', expiresAt: past }), // 失効
    mk({ status: '取消', name: 'キャンセル', gameId: '333333333', countryNo: '1003' }),
  ];
  const f = (cond) => filterInvites(items, { state: '', month: '', type: '', keyword: '', ...cond }, NOW).length;
  assert.equal(f({}), 4);
  assert.equal(f({ state: '登録済み' }), 1);
  assert.equal(f({ state: '失効' }), 1);
  assert.equal(f({ month: '2027-01' }), 1);
  assert.equal(f({ type: '特別' }), 1);
  assert.equal(f({ type: '未定' }), 3);
  assert.equal(f({ keyword: 'suzuki' }), 1);
  assert.equal(f({ keyword: '１１１１' }), 1); // 全角でも検索できる
  assert.equal(f({ keyword: 'a さん' }), 1); // 送付先メモ、空白区切りはすべてを含むもの
  assert.equal(f({ keyword: 'abc 1001' }), 1);
  assert.equal(f({ keyword: 'abc 1002' }), 0);
});
