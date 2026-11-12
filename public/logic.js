// 画面に依存しない部分（トークンの読み取り、入力チェック、状態の判定、文言）。
// Node.js だけで動かして確認できるよう、app.js から分けてある。

// 招待URLのトークン：英大文字と数字のうち、紛らわしい文字（I、O、0、1）を除いた32種類から16文字
export const TOKEN_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/;

export const NAME_MAX = 20;

export const MESSAGES = {
  formTitle: '移民登録フォーム',
  formDesc: '管理者から案内を受けた方は、下の項目を入力してください。入力した内容は管理者だけが見られます。',
  formNote: 'このURLは他の人に教えないでください。',
  submit: '登録する',
  registeredTitle: '登録を受け付けました',
  registered: '管理者の確認をお待ちください。',
  bookmark: 'このページのURLをブックマークしておくと、あとから状況を確認できます。',
  statusTitle: '登録状況',
  confirmedNoMonth: '確定しました。移民予定月は、管理者にご確認ください。',
  cancelled: 'この招待は取り消されました。詳細は、ゲーム内個人チャットで管理者にお問い合わせください。',
  expired: '有効期限が切れました。管理者にご連絡ください。',
  invalid: 'このURLは無効です。管理者にご連絡ください。',
  network: '通信に失敗しました。時間をおいて、もう一度お試しください。',
  denied: '登録できませんでした。有効期限が切れているか、すでに登録済みの可能性があります。管理者にご連絡ください。',
};

// URLの「#」以降からトークンを取り出す。小文字・空白・ハイフンは許す。形式が違えば null
export function parseToken(hash) {
  let raw = String(hash ?? '').replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const token = raw.replace(/[\s-]/g, '').toUpperCase();
  return TOKEN_RE.test(token) ? token : null;
}

// 登録フォームの入力チェック（設計書 9.1）。全角で入力されても半角に直して受け付ける
export function validateRegistration({ gameId, countryNo, alliance, name }) {
  const norm = (v) => String(v ?? '').normalize('NFKC').trim();
  // 名前は記号・漢字も自由に使えるので、変換（NFKC）はせず、前後の空白を除くだけにする
  const values = {
    name: String(name ?? '').trim(),
    gameId: norm(gameId),
    countryNo: norm(countryNo),
    alliance: norm(alliance).toUpperCase(),
  };
  const errors = {};
  const nameLength = [...values.name].length; // 絵文字なども1文字と数える
  if (nameLength < 1) {
    errors.name = '名前を入力してください';
  } else if (nameLength > NAME_MAX) {
    errors.name = `名前は${NAME_MAX}文字までで入力してください`;
  } else if (/[\u0000-\u001f\u007f]/.test(values.name)) {
    errors.name = '名前に使えない文字が含まれています';
  }
  if (!/^[0-9]{9}$/.test(values.gameId)) {
    errors.gameId = 'IDは9桁の数字で入力してください';
  }
  if (!/^[0-9]{4}$/.test(values.countryNo)) {
    errors.countryNo = '国番号は4桁の数字で入力してください';
  }
  if (!/^([A-Z]{3})?$/.test(values.alliance)) {
    errors.alliance = '同盟名は半角アルファベット3文字で入力してください（無所属の場合は空欄）';
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

// 招待の状態。「失効」は保存せず、招待済みのまま期限を過ぎたものをこう呼ぶ（設計書 9.2）
export function judgeState(data, nowMs) {
  if (data.status !== '招待済み') return data.status;
  const exp = data.expiresAt && typeof data.expiresAt.toMillis === 'function'
    ? data.expiresAt.toMillis()
    : null;
  return exp === null || exp < nowMs ? '失効' : '招待済み';
}

// '2026-12' → '2026年12月'。形式が違えば null
export function formatMonth(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value ?? ''));
  return m ? `${m[1]}年${Number(m[2])}月` : null;
}

// ---- 管理画面 ----

export const ADMIN_NAME_MAX = 20;

// 管理者IDは、画面の裏で「ID@admin.invalid」というメール形式に変換して Firebase Auth に渡す（実際のメールは使わない）
export function adminIdToEmail(id) {
  return `${String(id ?? '').normalize('NFKC').trim().toLowerCase()}@admin.invalid`;
}

// 管理者ログイン／申請の入力チェック。IDは半角英小文字・数字・_ で3〜20文字、パスワードは8〜64文字
export function validateAdminLogin({ adminId, password }) {
  const id = String(adminId ?? '').normalize('NFKC').trim().toLowerCase();
  const pw = String(password ?? '');
  const errors = {};
  if (!/^[a-z0-9_]{3,20}$/.test(id)) {
    errors.adminId = '管理者IDは、半角の英小文字・数字・_ で3〜20文字にしてください';
  }
  if (pw.length < 8 || pw.length > 64) {
    errors.password = 'パスワードは8〜64文字にしてください';
  }
  return { ok: Object.keys(errors).length === 0, errors, values: { adminId: id, password: pw } };
}

// 申請時の追加項目：表示名
export function validateAdminSignup({ adminId, password, passwordConfirm, displayName }) {
  const result = validateAdminLogin({ adminId, password });
  const displayNameValue = String(displayName ?? '').trim();
  const len = [...displayNameValue].length;
  if (len < 1) result.errors.displayName = '表示名を入力してください';
  else if (len > ADMIN_NAME_MAX) result.errors.displayName = `表示名は${ADMIN_NAME_MAX}文字までにしてください`;
  else if (/[\u0000-\u001f\u007f]/.test(displayNameValue)) result.errors.displayName = '表示名に使えない文字が含まれています';
  if (!result.errors.password && password !== passwordConfirm) {
    result.errors.passwordConfirm = 'パスワードが一致しません';
  }
  result.ok = Object.keys(result.errors).length === 0;
  result.values.displayName = displayNameValue;
  return result;
}

// ---- 招待の作成 ----

const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32種類（I、O、0、1を除く）

// 招待URLのトークンを16文字で作る。randomBytes は crypto.getRandomValues を渡す。
// 32種類なので、256 を32で割った余りは偏りなし
export function generateToken(getRandomValues = (a) => globalThis.crypto.getRandomValues(a)) {
  const bytes = getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % 32]).join('');
}

// 移民予定月の選択肢：指定の月から count か月分（'2026-11', '2026-12', …）
export function monthOptions(now, count = 12) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export const NOTE_MAX = 100;

export function validateNote(note) {
  const value = String(note ?? '').trim();
  if ([...value].length > NOTE_MAX) return { ok: false, error: `メモは${NOTE_MAX}文字までにしてください`, value };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'メモに使えない文字が含まれています', value };
  return { ok: true, error: '', value };
}
