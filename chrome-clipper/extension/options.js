// Настройки: токен и порт. Сохраняются сами при каждой правке — кнопка
// «Сохранить», которую забыли нажать, оставила бы человека со старым токеном
// и уведомлением «не тот токен» без видимой причины.

// Подписи — из каталога браузера (`_locales`), а не в разметке: до правки
// 20260915 окно настроек было целиком по-русски, как и всё расширение, и
// англоязычный покупатель видел два русских слова над двумя полями. Язык
// выбирает браузер по языку системы.
for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = chrome.i18n.getMessage(node.dataset.i18n);
}

const fields = {
  token: document.getElementById("token"),
  port: document.getElementById("port"),
};

chrome.storage.local.get(["token", "port"]).then((kept) => {
  fields.token.value = kept.token || "";
  fields.port.value = kept.port || "";
});

for (const [name, field] of Object.entries(fields)) {
  field.addEventListener("input", () => {
    chrome.storage.local.set({ [name]: field.value.trim() });
  });
}
