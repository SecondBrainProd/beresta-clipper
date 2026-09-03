// Настройки: токен и порт. Сохраняются сами при каждой правке — кнопка
// «Сохранить», которую забыли нажать, оставила бы человека со старым токеном
// и уведомлением «не тот токен» без видимой причины.

const fields = {
  token: document.getElementById("token"),
  port: document.getElementById("port"),
};

browser.storage.local.get(["token", "port"]).then((kept) => {
  fields.token.value = kept.token || "";
  fields.port.value = kept.port || "";
});

for (const [name, field] of Object.entries(fields)) {
  field.addEventListener("input", () => {
    browser.storage.local.set({ [name]: field.value.trim() });
  });
}
