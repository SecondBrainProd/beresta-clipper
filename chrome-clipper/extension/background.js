// Кнопка на панели: собрать открытую страницу и отдать её Beresta.
//
// Один файл на Chrome И Safari (задачи 2–3 плана
// `docs/plans/20260829-расширение-очереди-2-3.md`): Safari исполняет `chrome.*`
// и MV3, поэтому расширения не расходятся, а браузер определяет себя в
// рантайме — повод в журнале Beresta называет настоящего отправителя.
// Firefox живёт отдельно (MV2) — packages/firefox-clipper.
//
// Любой исход назван человеку (П01/П02): уведомлением, а в Safari — значком
// на кнопке (notifications-API там нет). Страница не теряется: если Beresta не
// отвечает, она ложится в очередь (`outbox.js`) и уходит сама — постановка
// `docs/plans/20260930-клипперы-публикация-постановка.md`, К1.

importScripts("outbox.js");

const DEFAULT_PORT = 21120;
const ALARM = "beresta-outbox";
// Будильник — раз в минуту: чаще Chrome не заводит, реже человек ждёт дольше,
// чем открывает Бересту.

// До какого мгновения на кнопке держится исход клика (см. `showQueue`).
let outcomeUntil = 0;

// Слова человеку — из каталога, а не литералом в коде.
//
// ⚠️ **Находка аудита готовности 20260915: расширение было целиком на
// русском**, а английская карточка Мака обещала вырезку страниц покупателю,
// который по-русски не читает: он видел русскую строку в списке расширений,
// жал кнопку и получал русское уведомление об отказе, по которому не мог
// действовать. Владелец 20260915: «Safari — переводи расширение».
//
// Язык выбирает БРАУЗЕР по языку системы (`default_locale` — английский),
// поэтому проверять нам нечего и незачем: каталоги лежат в `_locales`.
const say = (key, ...args) => chrome.i18n.getMessage(key, args.length ? args : undefined);

// В Safari userAgent содержит "Safari", но не "Chrome"; в Chrome — оба слова.
const BROWSER = navigator.userAgent.includes("Chrome") ? "chrome" : "safari";
const canNotify = typeof chrome.notifications !== "undefined";

const { makeOutbox, sendPage } = globalThis.BerestaOutbox;
const outbox = makeOutbox(chrome.storage.local);

async function settings() {
  const kept = await chrome.storage.local.get(["port", "token"]);
  return {
    port: Number(kept.port) || DEFAULT_PORT,
    token: (kept.token || "").trim(),
    browser: BROWSER,
  };
}

// Причина отказа — на языке браузера по ПОСТОЯННОМУ коду приложения (К2).
// Русская строка приложения человеку не показывается никогда.
function reasonText(detail) {
  if (detail === "notArticle") return say("reasonNotArticle");
  if (detail.startsWith("status:")) return say("refusedBody", detail.slice("status:".length));
  return say("failedBody");
}

chrome.action.onClicked.addListener(async (tab) => {
  const where = await settings();
  if (!where.token) {
    await tell(false, say("tokenNeededTitle"), say("tokenNeededBody"));
    return;
  }

  let page;
  try {
    const [got] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        html: document.documentElement.outerHTML,
        url: location.href,
        title: document.title,
      }),
    });
    page = got.result;
  } catch (trouble) {
    // Служебные страницы браузер читать не даёт — это его правило, не поломка.
    await tell(false, say("pageUnreadableTitle"), say("pageUnreadableBody"));
    return;
  }

  const { outcome, detail } = await sendPage(fetch, where, page);
  if (outcome === "sent") {
    await tell(
      true,
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
      await tell(true, say("queuedTitle"), say("queuedBody"));
    } else if (kept === "full") {
      await tell(false, say("queueFullTitle"), say("queueFullBody", String(await outbox.count())));
    } else {
      await tell(false, say("queueFullTitle"), say(kept === "tooBig" ? "pageTooBigBody" : "storageFailedBody"));
    }
  } else if (detail === "wrongToken") {
    // Не очередь: повтор тем же токеном не поможет.
    await tell(false, say("wrongTokenTitle"), say("wrongTokenBody"));
  } else {
    await tell(false, say("failedTitle"), reasonText(detail));
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
  const before = (await chrome.storage.local.get("queueTrouble")).queueTrouble === "wrongToken";
  if (troubled !== before) await chrome.storage.local.set({ queueTrouble: troubled ? "wrongToken" : "" });
  if (troubled && !before) await tell(false, say("wrongTokenTitle"), say("wrongTokenBody"));
  if (result.sent > 0) {
    await tell(true, say("queueDeliveredTitle"), say("queueDeliveredBody", String(result.sent)));
  }
  for (const { page, detail } of result.refused) {
    await tell(false, say("failedTitle"), `${page.title || page.url}: ${reasonText(detail)}`);
  }
  await showQueue();
}

// Число ждущих — на значке кнопки; будильник заведён, пока есть что отдавать.
async function showQueue() {
  const waiting = await outbox.count();
  if (waiting > 0) {
    await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(ALARM);
  }
  // Пока на кнопке показан исход клика (Safari: ✓/✕ вместо уведомления),
  // число ждущих его НЕ перетирает — иначе исход стирался за миллисекунды,
  // и «очередь полна» читалась как «сохранено» (приёмка вслепую 20260930).
  if (Date.now() < outcomeUntil) return;
  const trouble = (await chrome.storage.local.get("queueTrouble")).queueTrouble === "wrongToken";
  await chrome.action.setBadgeBackgroundColor({ color: trouble ? "#b3261e" : "#8a5a00" });
  await chrome.action.setBadgeText({ text: waiting > 0 ? String(waiting) : "" });
  let title = waiting > 0 ? say("queueWaitingTitle", String(waiting)) : say("actionTitle");
  if (waiting > 0 && trouble) title = `${title}. ${say("wrongTokenTitle")}: ${say("wrongTokenBody")}`;
  await chrome.action.setTitle({ title });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) flush();
});
chrome.runtime.onStartup.addListener(() => flush());
// Токен поправили в настройках — ждавшее из-за «не того токена» уходит сразу.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.port)) flush();
});
chrome.runtime.onInstalled.addListener(() => showQueue());

async function tell(ok, title, message) {
  if (canNotify) {
    // Иконка обязательна: Chrome без iconUrl уведомление не показывает.
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title,
      message,
    });
    return;
  }
  // Safari: значок на кнопке. Подробность уходит в подсказку кнопки. Через
  // пять секунд значок возвращается к числу ждущих; если служебный поток к
  // тому времени уснёт, число вернёт следующий заход `showQueue`.
  outcomeUntil = Date.now() + 5000;
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e7d32" : "#b3261e" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "✕" });
  await chrome.action.setTitle({ title: `${title}. ${message}` });
  setTimeout(() => showQueue(), 5000);
}
