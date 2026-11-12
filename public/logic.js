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
