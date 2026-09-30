// Проверка расширения Chrome/Safari — то, что для Firefox делает web-ext lint.
//
// web-ext заточен под Firefox: MV3 с service worker он судит по правилам
// чужого браузера (проверено фактически 20260829 — план
// 20260829-расширение-очереди-2-3, задача 2). Здесь проверяется то, что
// ломало бы установку молча: манифест разбирается, версия — 3, каждый файл,
// на который манифест ссылается, существует.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("./extension/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const troubles = [];
const need = (condition, words) => {
  if (!condition) troubles.push(words);
};

need(manifest.manifest_version === 3, "manifest_version должен быть 3: Chrome MV2 демонтирован");
need(Boolean(manifest.name && manifest.version), "нет name или version");
need(
  (manifest.host_permissions || []).includes("http://127.0.0.1/*"),
  "нет host-разрешения на 127.0.0.1 — fetch к приёмнику не пройдёт"
);
for (const permission of ["activeTab", "scripting", "storage", "alarms"]) {
  need((manifest.permissions || []).includes(permission), `нет разрешения ${permission}`);
}

const referenced = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
];
for (const file of referenced) {
  need(Boolean(file), "манифест ссылается на пустое имя файла");
  if (file) need(existsSync(join(root, file)), `файла нет: ${file}`);
}

// options.html тянет свой скрипт — если его нет, настройки молча не сохраняются.
const options = readFileSync(join(root, manifest.options_ui.page), "utf8");
for (const src of [...options.matchAll(/src="([^"]+)"/g)].map((m) => m[1])) {
  need(existsSync(join(root, src)), `options.html ссылается на несуществующий ${src}`);
}

// ⚠️ **Перевод расширений: сторож заведён 20260915 вместе с самим переводом.**
//
// Расширение было целиком на русском, а английская карточка Мака обещала
// вырезку страниц покупателю, который по-русски не читает: он видел русскую
// строку в списке расширений, жал кнопку и получал русское уведомление об
// отказе, по которому не мог действовать. Перевод без сторожа протух бы на
// первой же правке — литерал в коде проще, чем ключ в двух каталогах.
//
// Проверяются ОБА расширения: Chrome/Safari (MV3) и Firefox (MV2). Они живут
// раздельно нарочно (разные манифесты), и разъехаться словами им ничего не
// мешало.
const LOCALES = ["en", "ru"];
const extensions = [
  { name: "Chrome/Safari", dir: root },
  {
    name: "Firefox",
    dir: new URL("../firefox-clipper/extension/", import.meta.url).pathname,
  },
];

for (const { name, dir } of extensions) {
  const catalogues = {};
  for (const locale of LOCALES) {
    const path = join(dir, "_locales", locale, "messages.json");
    if (!existsSync(path)) {
      troubles.push(`${name}: нет каталога строк ${locale}`);
      continue;
    }
    catalogues[locale] = JSON.parse(readFileSync(path, "utf8"));
  }
  if (Object.keys(catalogues).length < LOCALES.length) continue;

  // Половины каталога не расходятся: ключ, переведённый только на один язык, —
  // это пустая строка на экране у второй половины покупателей.
  const [first, second] = LOCALES;
  for (const key of Object.keys(catalogues[first])) {
    need(key in catalogues[second], `${name}: ключ «${key}» есть в ${first}, нет в ${second}`);
  }
  for (const key of Object.keys(catalogues[second])) {
    need(key in catalogues[first], `${name}: ключ «${key}» есть в ${second}, нет в ${first}`);
  }

  // Каждый ключ, который спрашивает код и разметка, в каталоге ЕСТЬ.
  // `getMessage` на пропавший ключ возвращает пустую строку — молча.
  const sources = ["background.js", "outbox.js", "options.js", "options.html"]
    .filter((file) => existsSync(join(dir, file)))
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
  const asked = new Set([
    ...[...sources.matchAll(/say\("([^"]+)"/g)].map((m) => m[1]),
    ...[...sources.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
  ]);
  for (const key of asked) {
    need(key in catalogues[first], `${name}: код просит «${key}», а в каталоге его нет`);
  }

  // Имя и описание — тоже из каталога: их читает магазин расширений и список
  // в браузере, и русское имя у английского покупателя было первым, что он
  // видел.
  const own = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const value of [own.name, own.description]) {
    const key = /^__MSG_(.+)__$/.exec(value || "")?.[1];
    need(Boolean(key), `${name}: в манифесте слово написано литералом: «${value}»`);
    if (key) need(key in catalogues[first], `${name}: манифест просит «${key}», его нет в каталоге`);
  }
  need(own.default_locale === "en", `${name}: default_locale не «en»`);

  // Русских литералов в исполняющем не остаётся: комментарии по-русски — уклад
  // проекта, строки на экране — нет.
  for (const file of ["background.js", "outbox.js", "options.js", "options.html"]) {
    if (!existsSync(join(dir, file))) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const withoutComments = text
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    const cyrillic = withoutComments.match(/[а-яА-ЯёЁ]+/g) || [];
    need(
      cyrillic.length === 0,
      `${name}: в ${file} остались русские слова вне комментариев: ${cyrillic.slice(0, 3).join(", ")}`
    );
  }
}

// ⚠️ **Публикация в магазинах, 20260930.** Три правила, нарушение которых
// магазин или браузер заметит раньше нас.
//
// 1. Версия ОДНА во всех манифестах: обновление, поднятое в одном, у второго
//    браузера не выйдет, и два магазина покажут разное.
// 2. Иконка — каждого названного размера и ИМЕННО этого размера: магазин
//    отвергает пакет, где «128» — это 48, а панель рисует мыло.
// 3. Очередь вырезок (`outbox.js`) — один файл на три браузера: копия у
//    Firefox обязана совпадать байт в байт, иначе очереди разойдутся молча.
const firefoxDir = new URL("../firefox-clipper/extension/", import.meta.url).pathname;
const firefox = JSON.parse(readFileSync(join(firefoxDir, "manifest.json"), "utf8"));
need(
  manifest.version === firefox.version,
  `версии разошлись: Chrome/Safari ${manifest.version}, Firefox ${firefox.version}`
);
need((firefox.permissions || []).includes("alarms"), "Firefox: нет разрешения alarms — очередь не проснётся");
need(
  (firefox.background?.scripts || [])[0] === "outbox.js",
  "Firefox: outbox.js обязан грузиться ПЕРВЫМ — background.js берёт очередь из него"
);
need(
  /importScripts\("outbox\.js"\)/.test(readFileSync(join(root, "background.js"), "utf8")),
  "Chrome/Safari: служебный поток не подключает outbox.js"
);

// Ширина и высота PNG — в заголовке IHDR, байты 16–23.
function pngSize(path) {
  const bytes = readFileSync(path);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
for (const [name, dir, own] of [
  ["Chrome/Safari", root, manifest],
  ["Firefox", firefoxDir, firefox],
]) {
  const declared = [
    ...Object.entries(own.icons || {}),
    ...Object.entries((own.action || own.browser_action)?.default_icon || {}),
  ];
  // Набор размеров — ТОЧНЫЙ: выкинутый из манифеста размер вместе с файлом
  // проходил бы проверку «файлы на месте» (приёмка вслепую 20260930).
  const expected = name === "Firefox" ? ["48", "96", "128"] : ["16", "32", "48", "96", "128"];
  const iconSizes = Object.keys(own.icons || {}).sort((a, b) => a - b);
  need(
    JSON.stringify(iconSizes) === JSON.stringify(expected),
    `${name}: размеры иконок ${iconSizes.join(",")} вместо ${expected.join(",")}`
  );
  const buttonSizes = Object.keys((own.action || own.browser_action)?.default_icon || {});
  need(
    JSON.stringify(buttonSizes.sort((a, b) => a - b)) === JSON.stringify(["16", "32", "48"]),
    `${name}: у кнопки иконки ${buttonSizes.join(",")} вместо 16,32,48`
  );
  for (const [size, file] of declared) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      troubles.push(`${name}: иконки нет: ${file}`);
      continue;
    }
    const [width, height] = pngSize(path);
    need(
      width === Number(size) && height === Number(size),
      `${name}: ${file} заявлена ${size}, а она ${width}×${height}`
    );
  }
  for (const script of own.background?.scripts || []) {
    need(existsSync(join(dir, script)), `${name}: фоновый скрипт не найден: ${script}`);
  }
}
const outboxHere = readFileSync(join(root, "outbox.js"));
const outboxThere = existsSync(join(firefoxDir, "outbox.js"))
  ? readFileSync(join(firefoxDir, "outbox.js"))
  : Buffer.alloc(0);
need(outboxHere.equals(outboxThere), "outbox.js у Firefox не совпадает с общим — скопируйте из chrome-clipper");

if (troubles.length > 0) {
  console.error("расширение Chrome/Safari не в порядке:");
  for (const words of troubles) console.error(`  - ${words}`);
  process.exit(1);
}
console.log(
  "расширения в порядке: манифест MV3, файлы на месте, обе половины каталогов сошлись"
);
