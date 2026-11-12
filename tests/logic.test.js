import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToken, validateRegistration, judgeState, formatMonth,
  adminIdToEmail, validateAdminLogin, validateAdminSignup,
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
