// Очередь вырезок: страница, которую не удалось отдать Beresta, потому что
// приложение НЕ ОТВЕЧАЕТ, остаётся здесь и уходит сама, когда оно ответит.
//
// Постановка `docs/plans/20260930-клипперы-публикация-постановка.md`, К1.
// Слово владельца 20260930: «Да, очередь». До очереди закрытая Береста значила
// потерянную страницу: уведомление просило нажать ещё раз, а вкладку к тому
// времени часто уже закрывали.
//
// ⚠️ Файл ОДИН на все три браузера: копия в `packages/firefox-clipper/extension`
// обязана совпадать байт в байт — это сторожит `check.mjs`.
//
// Очередь не знает ни браузера, ни сети: ей дают хранилище (`storage.local`)
// и функцию отправки (`sendPage` с `fetch`). Поэтому она проверяется в Node
// без браузера (`packages/chrome-clipper/outbox.test.mjs`).

(function () {
  const KEY = "outbox";

  // Пределы — чтобы очередь не росла без края. Хранилище Chrome без особого
  // права держит 10 МБ на всё расширение; восемь — с запасом под настройки.
  // Двадцать страниц — больше, чем набирается за день с закрытой Берестой.
  const MAX_PAGES = 20;
  const MAX_BYTES = 8 * 1024 * 1024;

  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

  function makeOutbox(storage) {
    // Все правки очереди идут друг за другом: клик и будильник могут прийти
    // разом, а «прочитал — дописал — записал» вперемешку теряет страницу.
    let chain = Promise.resolve();
    const serial = (work) => {
      const next = chain.then(work, work);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    async function read() {
      const got = await storage.get(KEY);
      return Array.isArray(got[KEY]) ? got[KEY] : [];
    }
    const write = (list) => storage.set({ [KEY]: list });

    return {
      MAX_PAGES,
      MAX_BYTES,

      count: () => serial(async () => (await read()).length),

      // Кладёт страницу. Ответ — "kept" (лежит и уйдёт), "full" (очередь
      // полна) или "tooBig" (страница одна больше всего места). В двух
      // последних страница НЕ сохранена, и человеку это говорится разными
      // словами: «очередь полна: 0 страниц» у одинокой огромной страницы врёт.
      //
      // Та же страница второй раз заменяет прежний снимок, а не встаёт рядом:
      // уйти должна последняя версия, и Beresta всё равно заведёт одну статью.
      add: (page) =>
        serial(async () => {
          const list = (await read()).filter((kept) => kept.url !== page.url);
          const entry = { ...page, queuedAt: Date.now() };
          if (bytes([entry]) > MAX_BYTES) return "tooBig";
          const next = [...list, entry];
          if (next.length > MAX_PAGES || bytes(next) > MAX_BYTES) return "full";
          await write(next);
          return "kept";
        }),

      // Отдаёт очередь по порядку. `send(page)` отвечает "sent", "refused"
      // (приложение отказало по существу — повтор не поможет, страница
      // уходит из очереди) или "later" (не ответило, не тот токен — стоп,
      // остаток ждёт следующего раза).
      //
      // Итог: { sent, refused: [{ page, detail }], left, stopped }; `stopped` —
      // detail того «позже», на котором очередь встала ("noApp", "wrongToken"),
      // или null, если ушла вся. Без него неверный токен молчал бы вечно:
      // будильник стучится раз в минуту, а человек видит только «ждут».
      drain: (send) =>
        serial(async () => {
          const list = await read();
          let sent = 0;
          const refused = [];
          let stopped = null;
          let index = 0;
          for (; index < list.length; index += 1) {
            const { outcome, detail } = await send(list[index]);
            if (outcome === "later") {
              stopped = detail;
              break;
            }
            if (outcome === "sent") sent += 1;
            else refused.push({ page: list[index], detail });
          }
          const left = list.slice(index);
          if (index > 0) await write(left);
          return { sent, refused, left: left.length, stopped };
        }),
    };
  }

  // Отдаёт одну страницу приёмнику Beresta и называет исход словами очереди:
  // { outcome: "sent" | "refused" | "later", detail }. Не бросает никогда —
  // брошенное посреди очереди оставило бы её недописанной.
  //
  // detail: "created", "duplicate" — ушла; "noApp", "wrongToken" — позже;
  // код отказа приложения ("notArticle", "failed") или "status:<код>" — отказ.
  async function sendPage(fetchPage, { port, token, browser }, page) {
    let reply;
    try {
      reply = await fetchPage(`http://127.0.0.1:${port}/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Beresta-Token": token },
        // Имя браузера — для повода в журнале Beresta: правка, приехавшая
        // вырезкой, называет, кто её прислал.
        body: JSON.stringify({ html: page.html, url: page.url, title: page.title, browser }),
      });
    } catch (trouble) {
      // Приёмник не отвечает: Beresta закрыта или приём выключен.
      return { outcome: "later", detail: "noApp" };
    }
    // Не тот токен — не отказ по существу: поправят в настройках, и очередь
    // уйдёт тем же порядком.
    if (reply.status === 401) return { outcome: "later", detail: "wrongToken" };
    if (!reply.ok) return { outcome: "refused", detail: `status:${reply.status}` };

    let answer;
    try {
      answer = await reply.json();
    } catch (trouble) {
      return { outcome: "refused", detail: "failed" };
    }
    if (answer.outcome === "created" || answer.outcome === "duplicate") {
      return { outcome: "sent", detail: answer.outcome };
    }
    return { outcome: "refused", detail: answer.code || "failed" };
  }

  globalThis.BerestaOutbox = { makeOutbox, sendPage, MAX_PAGES, MAX_BYTES };
})();
