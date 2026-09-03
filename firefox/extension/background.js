// Кнопка на панели: собрать открытую страницу и отдать её Beresta.
//
// Задача 3 плана `docs/plans/20260829-расширение-браузера.md`. Любой исход
// назван уведомлением — страница не теряется молча (П02): если Beresta не
// отвечает, человек читает, что включить, и жмёт ту же кнопку ещё раз.

const DEFAULT_PORT = 21120;

browser.browserAction.onClicked.addListener(async (tab) => {
  const kept = await browser.storage.local.get(["port", "token"]);
  const port = Number(kept.port) || DEFAULT_PORT;
  const token = (kept.token || "").trim();
  if (!token) {
    await tell(
      "Нужен токен",
      "Откройте настройки расширения и вставьте токен из Beresta: " +
        "Параметры → «Вырезки»."
    );
    return;
  }

  let page;
  try {
    [page] = await browser.tabs.executeScript(tab.id, { file: "collect.js" });
  } catch (trouble) {
    // Служебные страницы (about:, магазин дополнений) Firefox читать не даёт —
    // это его правило, а не поломка.
    await tell("Страница не читается", "Эту страницу Firefox не даёт прочитать расширениям.");
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
      body: JSON.stringify({ ...page, browser: "firefox" }),
    });
  } catch (trouble) {
    // Приёмник не отвечает: Beresta закрыта или выключен приём. Страница НЕ
    // потеряна — тот же клик повторит отправку.
    await tell(
      "Beresta не отвечает",
      "Включите приёмник вырезок: Beresta → Параметры → «Вырезки». " +
        "Потом нажмите кнопку ещё раз — страница никуда не делась."
    );
    return;
  }

  if (reply.status === 401) {
    await tell(
      "Не тот токен",
      "Скопируйте токен заново из Beresta (Параметры → «Вырезки») " +
        "в настройки расширения."
    );
    return;
  }
  if (!reply.ok) {
    await tell("Вырезка не принята", `Beresta ответила: ${reply.status}.`);
    return;
  }

  const answer = await reply.json();
  if (answer.outcome === "created") {
    await tell("Готово", "Страница ждёт во «Входящих» Beresta.");
  } else if (answer.outcome === "duplicate") {
    await tell("Уже в библиотеке", "Эта страница вырезалась раньше — дубль не заведён.");
  } else {
    await tell("Вырезка не завелась", answer.reason || "Beresta отказалась без объяснения.");
  }
});

async function tell(title, message) {
  await browser.notifications.create({
    type: "basic",
    title,
    message,
  });
}
