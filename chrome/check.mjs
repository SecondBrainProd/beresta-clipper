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
for (const permission of ["activeTab", "scripting", "storage"]) {
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

if (troubles.length > 0) {
  console.error("расширение Chrome/Safari не в порядке:");
  for (const words of troubles) console.error(`  - ${words}`);
  process.exit(1);
}
console.log("расширение Chrome/Safari в порядке: манифест MV3, все файлы на месте");
