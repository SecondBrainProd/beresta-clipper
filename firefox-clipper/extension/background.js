// Кнопка на панели: собрать открытую страницу и отдать её Beresta.
//
// Задача 3 плана `docs/plans/20260829-расширение-браузера.md`. Любой исход
// назван уведомлением. Страница не теряется: если Beresta не отвечает, она
// ложится в очередь (`outbox.js`, общий с Chrome и Safari) и уходит сама —
// постановка `docs/plans/20260930-клипперы-публикация-постановка.md`, К1.
//
// `outbox.js` подгружается манифестом раньше этого файла.

const DEFAULT_PORT = 21120;
const ALARM = "beresta-outbox";
// Будильник — раз в минуту: чаще Chrome не заводит, реже человек ждёт дольше,
// чем открывает Бересту.

// До какого мгновения на кнопке держится исход клика (см. `showQueue`).
let outcomeUntil = 0;

// Слова человеку — из каталога `_locales`, а не литералом в коде: расширение
// было целиком на русском, а обещано оно и англоязычному покупателю (находка
// аудита 20260915, решение владельца в тот же день). Язык выбирает браузер.
const say = (key, ...args) => browser.i18n.getMessage(key, args.length ? args : undefined);

const { makeOutbox, sendPage } = globalThis.BerestaOutbox;
const outbox = makeOutbox(browser.storage.local);

async function settings() {
  const kept = await browser.storage.local.get(["port", "token"]);
  return {
    port: Number(kept.port) || DEFAULT_PORT,
    token: (kept.token || "").trim(),
    browser: "firefox",
  };
}

// Причина отказа — на языке браузера по ПОСТОЯННОМУ коду приложения (К2).
// Русская строка приложения человеку не показывается никогда.
function reasonText(detail) {
  if (detail === "notArticle") return say("reasonNotArticle");
  if (detail.startsWith("status:")) return say("refusedBody", detail.slice("status:".length));
  return say("failedBody");
}

browser.browserAction.onClicked.addListener(async (tab) => {
  const where = await settings();
  if (!where.token) {
    await tell(say("tokenNeededTitle"), say("tokenNeededBody"));
    return;
  }

  let page;
  try {
    [page] = await browser.tabs.executeScript(tab.id, { file: "collect.js" });
  } catch (trouble) {
    // Служебные страницы (about:, магазин дополнений) Firefox читать не даёт —
    // это его правило, а не поломка.
    await tell(say("pageUnreadableTitle"), say("pageUnreadableBody"));
    return;
  }

  const { outcome, detail } = await sendPage(fetch, where, page);
  if (outcome === "sent") {
    await tell(
      say(detail === "duplicate" ? "duplicateTitle" : "doneTitle"),
      say(detail === "duplicate" ? "duplicateBody" : "doneBody"),
    );
    // Береста отвечает — самое время отдать то, что ждало.
    await flush();
  } else if (detail === "noApp") {
    let kept;
    try {
      kept = await outbox.add(page);
    } catch (trouble) {
      // Хранилище браузера отказало — страница НЕ сохранена, и это сказано.
      kept = "broken";
    }
    if (kept === "kept") {
      await tell(say("queuedTitle"), say("queuedBody"));
    } else if (kept === "full") {
      await tell(say("queueFullTitle"), say("queueFullBody", String(await outbox.count())));
    } else {
      await tell(say("queueFullTitle"), say(kept === "tooBig" ? "pageTooBigBody" : "storageFailedBody"));
    }
  } else if (detail === "wrongToken") {
    // Не очередь: повтор тем же токеном не поможет.
    await tell(say("wrongTokenTitle"), say("wrongTokenBody"));
  } else {
    await tell(say("failedTitle"), reasonText(detail));
  }
  await showQueue();
});

// Отдаёт очередь, если есть кому. Молчит, пока Береста закрыта: напоминать о
// каждом неудачном заходе будильника — шум, число на значке и так видно.
async function flush() {
  const where = await settings();
  if (!where.token || (await outbox.count()) === 0) return;
  const result = await outbox.drain((page) => sendPage(fetch, where, page));
  // Очередь встала на неверном токене — сказать ОДИН раз и держать в
  // подсказке кнопки, пока токен не поправят. Признак — в хранилище, а не в
  // переменной: служебный поток Chrome засыпает между будильниками, и
  // переменная напоминала бы каждую минуту (приёмка вслепую 20260930).
  const troubled = result.stopped === "wrongToken";
  const before = (await browser.storage.local.get("queueTrouble")).queueTrouble === "wrongToken";
  if (troubled !== before) await browser.storage.local.set({ queueTrouble: troubled ? "wrongToken" : "" });
  if (troubled && !before) await tell(say("wrongTokenTitle"), say("wrongTokenBody"));
  if (result.sent > 0) {
    await tell(say("queueDeliveredTitle"), say("queueDeliveredBody", String(result.sent)));
  }
  for (const { page, detail } of result.refused) {
    await tell(say("failedTitle"), `${page.title || page.url}: ${reasonText(detail)}`);
  }
  await showQueue();
}

// Число ждущих — на значке кнопки; будильник заведён, пока есть что отдавать.
async function showQueue() {
  const waiting = await outbox.count();
  if (waiting > 0) {
    await browser.alarms.create(ALARM, { periodInMinutes: 1 });
  } else {
    await browser.alarms.clear(ALARM);
  }
  // Пока на кнопке показан исход клика (Safari: ✓/✕ вместо уведомления),
  // число ждущих его НЕ перетирает — иначе исход стирался за миллисекунды,
  // и «очередь полна» читалась как «сохранено» (приёмка вслепую 20260930).
  if (Date.now() < outcomeUntil) return;
  const trouble = (await browser.storage.local.get("queueTrouble")).queueTrouble === "wrongToken";
  await browser.browserAction.setBadgeBackgroundColor({ color: trouble ? "#b3261e" : "#8a5a00" });
  await browser.browserAction.setBadgeText({ text: waiting > 0 ? String(waiting) : "" });
  let title = waiting > 0 ? say("queueWaitingTitle", String(waiting)) : say("actionTitle");
  if (waiting > 0 && trouble) title = `${title}. ${say("wrongTokenTitle")}: ${say("wrongTokenBody")}`;
  await browser.browserAction.setTitle({ title });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) flush();
});
browser.runtime.onStartup.addListener(() => flush());
browser.runtime.onInstalled.addListener(() => showQueue());
// Токен поправили в настройках — ждавшее из-за «не того токена» уходит сразу.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.port)) flush();
});

async function tell(title, message) {
  await browser.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-96.png",
    title,
    message,
  });
}
