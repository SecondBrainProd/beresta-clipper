// Кнопка на панели: собрать открытую страницу и отдать её Beresta.
//
// Один файл на Chrome И Safari (задачи 2–3 плана
// `docs/plans/20260829-расширение-очереди-2-3.md`): Safari исполняет `chrome.*`
// и MV3, поэтому расширения не расходятся, а браузер определяет себя в
// рантайме — повод в журнале Beresta называет настоящего отправителя.
// Firefox живёт отдельно (MV2) — packages/firefox-clipper.
//
// Любой исход назван человеку (П01/П02): уведомлением, а в Safari — значком
// на кнопке (notifications-API там нет). Страница не теряется молча: тот же
// клик повторяет отправку.

const DEFAULT_PORT = 21120;

// В Safari userAgent содержит "Safari", но не "Chrome"; в Chrome — оба слова.
const BROWSER = navigator.userAgent.includes("Chrome") ? "chrome" : "safari";
const canNotify = typeof chrome.notifications !== "undefined";

chrome.action.onClicked.addListener(async (tab) => {
  const kept = await chrome.storage.local.get(["port", "token"]);
  const port = Number(kept.port) || DEFAULT_PORT;
  const token = (kept.token || "").trim();
  if (!token) {
    await tell(
      false,
      "Нужен токен",
      "Откройте настройки расширения и вставьте токен из Beresta: " +
        "Параметры → «Вырезки»."
    );
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
    await tell(false, "Страница не читается", "Эту страницу браузер не даёт прочитать расширениям.");
    return;
  }

  let reply;
  try {
    reply = await fetch(`http://127.0.0.1:${port}/clip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Beresta-Token": token,
      },
      // Имя браузера — для повода в журнале Beresta: правка, приехавшая
      // вырезкой, называет, кто её прислал.
      body: JSON.stringify({ ...page, browser: BROWSER }),
    });
  } catch (trouble) {
    await tell(
      false,
      "Beresta не отвечает",
      "Включите приёмник вырезок: Beresta → Параметры → «Вырезки». " +
        "Потом нажмите кнопку ещё раз — страница никуда не делась."
    );
    return;
  }

  if (reply.status === 401) {
    await tell(
      false,
      "Не тот токен",
      "Скопируйте токен заново из Beresta (Параметры → «Вырезки») " +
        "в настройки расширения."
    );
    return;
  }
  if (!reply.ok) {
    await tell(false, "Вырезка не принята", `Beresta ответила: ${reply.status}.`);
    return;
  }

  const answer = await reply.json();
  if (answer.outcome === "created") {
    await tell(true, "Готово", "Страница ждёт во «Входящих» Beresta.");
  } else if (answer.outcome === "duplicate") {
    await tell(true, "Уже в библиотеке", "Эта страница вырезалась раньше — дубль не заведён.");
  } else {
    await tell(false, "Вырезка не завелась", answer.reason || "Beresta отказалась без объяснения.");
  }
});

async function tell(ok, title, message) {
  if (canNotify) {
    // Иконка обязательна: Chrome без iconUrl уведомление не показывает.
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message,
    });
    return;
  }
  // Safari: значок на кнопке. Подробность уходит в подсказку кнопки.
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e7d32" : "#b3261e" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "✕" });
  await chrome.action.setTitle({ title: `${title}. ${message}` });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "В Beresta" });
  }, 5000);
}
