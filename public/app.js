import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { parseToken, validateRegistration, judgeState, formatMonth, MESSAGES } from './logic.js';

const db = getFirestore(initializeApp(firebaseConfig));
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const root = document.getElementById('app');
const token = parseToken(location.hash);

// 文字は textContent 相当（append）で入れるので、入力内容がHTMLとして動くことはない
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function show(...nodes) {
  root.replaceChildren(...nodes);
}

function card(title, ...paragraphs) {
  return h(
    'section',
    { class: 'card' },
    h('h1', {}, title),
    ...paragraphs.map((text) => h('p', {}, text)),
  );
}

async function fetchInvite() {
  const snap = await getDoc(doc(db, 'invites', token));
  return snap.exists() ? snap.data() : null;
}

async function load() {
  if (!token) return show(card(MESSAGES.statusTitle, MESSAGES.invalid));

  let data;
  try {
    data = await fetchInvite();
  } catch {
    return show(card(MESSAGES.statusTitle, MESSAGES.network));
  }
  if (!data) return show(card(MESSAGES.statusTitle, MESSAGES.invalid));

  switch (judgeState(data, Date.now())) {
    case '招待済み':
      return showForm();
    case '登録済み':
      return show(card(MESSAGES.registeredTitle, MESSAGES.registered, MESSAGES.bookmark));
    case '確定': {
      const month = formatMonth(data.scheduledMonth);
      return show(
        card(MESSAGES.statusTitle, month ? `${month}に移民予定です。` : MESSAGES.confirmedNoMonth),
      );
    }
    case '取消':
      return show(card(MESSAGES.statusTitle, MESSAGES.cancelled));
    case '失効':
      return show(card(MESSAGES.statusTitle, MESSAGES.expired));
    default:
      return show(card(MESSAGES.statusTitle, MESSAGES.invalid));
  }
}

function showForm() {
  const fields = [
    {
      name: 'gameId',
      label: 'ID',
      hint: '半角数字9桁',
      attrs: { inputmode: 'numeric', maxlength: '9', autocomplete: 'off' },
    },
    {
      name: 'countryNo',
      label: '現在国番号',
      hint: '半角数字4桁',
      attrs: { inputmode: 'numeric', maxlength: '4', autocomplete: 'off' },
    },
    {
      name: 'alliance',
      label: '現在同盟（任意）',
      hint: '半角アルファベット3文字。無所属の場合は空欄',
      attrs: { maxlength: '3', autocapitalize: 'characters', autocomplete: 'off' },
    },
  ];

  const inputs = {};
  const errorEls = {};
  const fieldNodes = fields.map((f) => {
    inputs[f.name] = h('input', { id: f.name, name: f.name, type: 'text', ...f.attrs });
    errorEls[f.name] = h('p', { class: 'error' });
    return h(
      'div',
      { class: 'field' },
      h('label', { for: f.name }, f.label, ' ', h('span', { class: 'hint' }, f.hint)),
      inputs[f.name],
      errorEls[f.name],
    );
  });

  const formError = h('p', { class: 'error' });
  const button = h('button', { type: 'submit' }, MESSAGES.submit);
  const form = h('form', { novalidate: '' }, ...fieldNodes, formError, button);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = validateRegistration(
      Object.fromEntries(fields.map((f) => [f.name, inputs[f.name].value])),
    );
    for (const f of fields) errorEls[f.name].textContent = result.errors[f.name] ?? '';
    if (!result.ok) return;

    button.disabled = true;
    formError.textContent = '';
    try {
      await updateDoc(doc(db, 'invites', token), {
        gameId: result.values.gameId,
        countryNo: result.values.countryNo,
        alliance: result.values.alliance,
        status: '登録済み',
        registeredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await load();
    } catch (err) {
      if (err && err.code === 'permission-denied') {
        // 入力中に期限が切れた、別の端末で登録済み、などの場合は、最新の状態を表示し直す
        try {
          const latest = await fetchInvite();
          if (!latest || judgeState(latest, Date.now()) !== '招待済み') return load();
        } catch {
          // 通信できなければ、下のエラー表示にする
        }
        formError.textContent = MESSAGES.denied;
      } else {
        formError.textContent = MESSAGES.network;
      }
      button.disabled = false;
    }
  });

  show(
    h(
      'section',
      { class: 'card' },
      h('h1', {}, MESSAGES.formTitle),
      h('p', {}, MESSAGES.formDesc),
      h('p', { class: 'muted' }, MESSAGES.formNote),
      form,
    ),
  );
}

window.addEventListener('hashchange', () => location.reload());
load();
