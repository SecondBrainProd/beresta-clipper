// Проверки очереди вырезок (`extension/outbox.js`) — без браузера, в Node.
//
// Постановка `docs/plans/20260930-клипперы-публикация-постановка.md`, К1 и К2.
// Хранилище и сеть — поддельные: очередь знает о них только то, что ей дали.
// Каждая проверка называет свой рез — подмену в outbox.js, от которой краснеет.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Файл исполняется так же, как в браузере: классическим скриптом, который
// кладёт `BerestaOutbox` в глобальную область. В ЭТОЙ области, а не в
// отдельной: объекты из чужой области не равны своим при сравнении.
function load() {
  vm.runInThisContext(readFileSync(new URL("./extension/outbox.js", import.meta.url), "utf8"));
  return globalThis.BerestaOutbox;
}

function memoryStorage() {
  const kept = {};
  return {
    kept,
    get: async (key) => (key in kept ? { [key]: structuredClone(kept[key]) } : {}),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) kept[key] = structuredClone(value);
    },
  };
}

const page = (n, size = 10) => ({
  url: `https://example.org/${n}`,
  title: `Страница ${n}`,
  html: "x".repeat(size),
});

// Рез: `add` возвращает "kept", не записывая, — краснеет на count.
test("Страница, отложенная при молчащей Бересте, остаётся и уходит потом", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  assert.equal(await outbox.add(page(1)), "kept");
  assert.equal(await outbox.add(page(2)), "kept");
  assert.equal(await outbox.count(), 2);

  const got = [];
  const result = await outbox.drain(async (p) => {
    got.push(p.url);
    return { outcome: "sent", detail: "created" };
  });
  assert.deepEqual(got, ["https://example.org/1", "https://example.org/2"], "порядок не сохранён");
  assert.equal(result.sent, 2);
  assert.equal(await outbox.count(), 0, "ушедшее осталось в очереди");
});

// Рез: в `drain` убрать `break` на "later" — краснеет.
test("Береста снова замолчала посреди очереди — остаток ждёт, ушедшее не повторяется", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  for (const n of [1, 2, 3]) await outbox.add(page(n));

  let calls = 0;
  const result = await outbox.drain(async () => {
    calls += 1;
    return calls === 1 ? { outcome: "sent", detail: "created" } : { outcome: "later", detail: "noApp" };
  });
  assert.equal(result.sent, 1);
  assert.equal(result.left, 2);
  assert.equal(calls, 2, "после «позже» очередь продолжила стучаться");
  assert.equal(await outbox.count(), 2);
});

// Рез: отказанное оставлять в очереди — краснеет.
test("Отказ по существу уходит из очереди и называется, повтор не нужен", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  await outbox.add(page(1));
  const result = await outbox.drain(async () => ({ outcome: "refused", detail: "notArticle" }));
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0].detail, "notArticle");
  assert.equal(await outbox.count(), 0);
});

// Рез: снять проверку предела в `add` — краснеет.
test("Очередь не растёт без края, и лишняя страница НЕ сохранена, о чём сказано", async () => {
  const { makeOutbox, MAX_PAGES } = load();
  const outbox = makeOutbox(memoryStorage());
  for (let n = 0; n < MAX_PAGES; n += 1) assert.equal(await outbox.add(page(n)), "kept");
  assert.equal(await outbox.add(page("лишняя")), "full");
  assert.equal(await outbox.count(), MAX_PAGES);
});

// Рез: убрать ветку "tooBig" — краснеет: одинокая огромная страница
// называлась «очередь полна: 0 страниц» (приёмка вслепую 20260930).
test("Страница больше всего места — «слишком велика», а не «очередь полна»", async () => {
  const { makeOutbox, MAX_BYTES } = load();
  const outbox = makeOutbox(memoryStorage());
  assert.equal(await outbox.add(page("огромная", MAX_BYTES)), "tooBig");
  assert.equal(await outbox.count(), 0);
});

// Рез: не запоминать `stopped` — краснеет: неверный токен молчал бы вечно.
test("Очередь называет, на чём встала", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  await outbox.add(page(1));
  const stuck = await outbox.drain(async () => ({ outcome: "later", detail: "wrongToken" }));
  assert.equal(stuck.stopped, "wrongToken");
  const done = await outbox.drain(async () => ({ outcome: "sent", detail: "created" }));
  assert.equal(done.stopped, null);
});

// Рез: в `add` не убирать прежний снимок той же страницы — краснеет.
test("Та же страница дважды — один снимок, последний", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  await outbox.add({ ...page(1), html: "старое" });
  await outbox.add({ ...page(1), html: "новое" });
  const sent = [];
  await outbox.drain(async (p) => {
    sent.push(p.html);
    return { outcome: "sent", detail: "created" };
  });
  assert.deepEqual(sent, ["новое"]);
});

// Рез: `serial` отдаёт работу сразу, без цепочки, — краснеет: страница,
// положенная посреди отправки, стирается записью остатка.
test("Клик посреди отправки очереди не теряет новую страницу", async () => {
  const { makeOutbox } = load();
  const outbox = makeOutbox(memoryStorage());
  await outbox.add(page(1));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const draining = outbox.drain(async () => {
    await gate;
    return { outcome: "sent", detail: "created" };
  });
  const adding = outbox.add(page(2));
  release();
  await Promise.all([draining, adding]);
  assert.equal(await outbox.count(), 1, "страница, положенная во время отправки, пропала");
});

// --- sendPage: ответ приложения → исход очереди (К1, К2) ---

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (typeof body === "string") throw new SyntaxError("не JSON");
    return body;
  },
});
const where = { port: 21120, token: "т", browser: "chrome" };

test("Молчащая Береста — «позже», а не отказ", async () => {
  const { sendPage } = load();
  const failing = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.deepEqual(await sendPage(failing, where, page(1)), { outcome: "later", detail: "noApp" });
});

test("Не тот токен — «позже»: поправят настройки, и очередь уйдёт", async () => {
  const { sendPage } = load();
  const got = await sendPage(async () => reply(401, {}), where, page(1));
  assert.deepEqual(got, { outcome: "later", detail: "wrongToken" });
});

test("Заведена и дубль — ушла", async () => {
  const { sendPage } = load();
  for (const outcome of ["created", "duplicate"]) {
    const got = await sendPage(async () => reply(200, { outcome, code: "" }), where, page(1));
    assert.deepEqual(got, { outcome: "sent", detail: outcome });
  }
});

// Рез: вернуть `answer.reason` вместо кода — краснеет (К2: русская строка
// приложения человеку не показывается).
test("Отказ несёт ПОСТОЯННЫЙ код приложения, а не его русскую строку", async () => {
  const { sendPage } = load();
  const got = await sendPage(
    async () => reply(200, { outcome: "refused", code: "notArticle", reason: "в снимке не нашлось" }),
    where,
    page(1),
  );
  assert.deepEqual(got, { outcome: "refused", detail: "notArticle" });
});

test("Ответ не JSON и ошибка сервера — отказ словами, а не падение", async () => {
  const { sendPage } = load();
  assert.deepEqual(await sendPage(async () => reply(200, "мусор"), where, page(1)), {
    outcome: "refused",
    detail: "failed",
  });
  assert.deepEqual(await sendPage(async () => reply(500, {}), where, page(1)), {
    outcome: "refused",
    detail: "status:500",
  });
});

test("Запрос несёт токен заголовком и имя браузера в теле", async () => {
  const { sendPage } = load();
  let seen;
  await sendPage(
    async (url, init) => {
      seen = { url, init };
      return reply(200, { outcome: "created" });
    },
    where,
    { ...page(1), queuedAt: 5 },
  );
  assert.equal(seen.url, "http://127.0.0.1:21120/clip");
  assert.equal(seen.init.headers["X-Beresta-Token"], "т");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.browser, "chrome");
  assert.equal(body.url, "https://example.org/1");
  assert.equal("queuedAt" in body, false, "служебное поле очереди уехало в приложение");
});
