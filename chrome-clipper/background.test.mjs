// Проверки обработчика кнопки Chrome/Safari (`extension/background.js`) —
// на поддельном API браузера, в Node.
//
// Заведены по приёмке вслепую 20260930: код обработчика не был покрыт ничем,
// и в Safari исход клика стирался числом ждущих за миллисекунды — «очередь
// полна» читалась как «сохранено». Слова здесь — ИМЕНА ключей каталога:
// поддельный `getMessage` отдаёт ключ, чтобы проверка не зависела от перевода.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = (file) => readFileSync(new URL(`./extension/${file}`, import.meta.url), "utf8");

// Браузер целиком: хранилище, кнопка, будильник, уведомления (у Safari их нет).
function browserStand({ safari, fetch }) {
  const kept = { token: "т" };
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const button = { badge: "", title: "", color: "" };
  const notes = [];
  const storage = {
    get: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) if (key in kept) out[key] = structuredClone(kept[key]);
      return out;
    },
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) kept[key] = structuredClone(value);
    },
  };
  const chrome = {
    i18n: { getMessage: (key) => key },
    storage: { local: storage, onChanged: on("storage") },
    action: {
      onClicked: on("click"),
      setBadgeText: async ({ text }) => (button.badge = text),
      setBadgeBackgroundColor: async ({ color }) => (button.color = color),
      setTitle: async ({ title }) => (button.title = title),
    },
    scripting: {
      executeScript: async () => [{ result: { html: "<p>x</p>", url: "https://example.org/a", title: "A" } }],
    },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: on("alarm") },
    runtime: { onStartup: on("startup"), onInstalled: on("installed") },
  };
  if (!safari) chrome.notifications = { create: async (note) => notes.push(note.title + " | " + note.message) };

  const context = vm.createContext({
    chrome,
    fetch,
    navigator: { userAgent: safari ? "Safari" : "Chrome" },
    TextEncoder,
    structuredClone,
    setTimeout: () => 0,
    console,
  });
  context.globalThis = context;
  context.importScripts = (file) => vm.runInContext(source(file), context);
  vm.runInContext(source("background.js"), context);
  return { kept, listeners, button, notes, context };
}

const noApp = async () => {
  throw new TypeError("Failed to fetch");
};
const answer = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Рез: убрать в `showQueue` строку `if (Date.now() < outcomeUntil) return;` —
// краснеет: значок «20», подсказка «ждут», исход стёрт.
test("Safari: «очередь полна» остаётся на кнопке, а не стирается числом ждущих", async () => {
  const stand = browserStand({ safari: true, fetch: noApp });
  stand.kept.outbox = Array.from({ length: 20 }, (_, n) => ({ url: `https://example.org/${n}`, html: "x" }));
  await stand.listeners.click({ id: 1 });
  assert.equal(stand.button.badge, "✕", `на кнопке «${stand.button.badge}» вместо исхода`);
  assert.match(stand.button.title, /queueFullTitle/, `подсказка: «${stand.button.title}»`);
});

test("Safari: удачная вырезка видна галочкой", async () => {
  const stand = browserStand({ safari: true, fetch: answer(200, { outcome: "created" }) });
  await stand.listeners.click({ id: 1 });
  assert.equal(stand.button.badge, "✓");
  assert.match(stand.button.title, /doneTitle/);
});

test("Береста закрыта: страница легла в очередь, и это сказано", async () => {
  const stand = browserStand({ safari: false, fetch: noApp });
  await stand.listeners.click({ id: 1 });
  assert.equal(stand.kept.outbox.length, 1);
  assert.match(stand.notes[0], /queuedTitle/);
  assert.equal(stand.button.badge, "1", "число ждущих не показано");
});

// Рез: убрать сравнение с сохранённым признаком (`before`) — краснеет: второй
// будильник напоминает снова.
test("Неверный токен в очереди — сказано ОДИН раз и держится в подсказке", async () => {
  const stand = browserStand({ safari: false, fetch: answer(401, {}) });
  stand.kept.outbox = [{ url: "https://example.org/1", html: "x" }];
  stand.listeners.alarm({ name: "beresta-outbox" });
  for (let i = 0; i < 20; i += 1) await settle();
  stand.listeners.alarm({ name: "beresta-outbox" });
  for (let i = 0; i < 20; i += 1) await settle();
  const told = stand.notes.filter((note) => note.startsWith("wrongTokenTitle"));
  assert.equal(told.length, 1, `напоминаний: ${told.length}`);
  assert.match(stand.button.title, /wrongTokenTitle/, `подсказка: «${stand.button.title}»`);
  assert.equal(stand.kept.outbox.length, 1, "страница пропала из очереди");
});

test("Хранилище отказало — страница НЕ сохранена, и это сказано", async () => {
  const stand = browserStand({ safari: false, fetch: noApp });
  stand.context.chrome.storage.local.set = async () => {
    throw new Error("QUOTA_BYTES quota exceeded");
  };
  await stand.listeners.click({ id: 1 });
  assert.match(stand.notes[0] || "", /storageFailedBody/, `сказано: ${stand.notes}`);
});
