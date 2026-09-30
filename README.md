# Beresta Clipper — browser extensions

Save the page you are reading into your [Beresta](https://beresta.page) library with one click.
The page becomes an article in the Inbox and is read and highlighted like your books.

**Requires Beresta for Mac.** The extension talks only to Beresta on the same computer
(`127.0.0.1`), and only after you turn on “Accept clippings from the browser” in Beresta
(Settings → Clippings) and paste its token into the extension settings. It collects nothing
and sends nothing to the internet.

If Beresta is closed, the page waits in the browser and goes to Beresta by itself once it is
open (at most 20 pages); the button shows how many are waiting.

| Folder | Browsers | Manifest |
|---|---|---|
| `chrome-clipper/` | Chrome, Edge and other Chromium browsers; the same files ship inside Beresta for Safari | MV3 |
| `firefox-clipper/` | Firefox | MV2 |

The queue (`outbox.js`) is one file shared by all three browsers; `chrome-clipper/check.mjs`
makes sure the Firefox copy stays identical.

## Develop

```sh
cd firefox-clipper && npm install && npm run lint     # web-ext lint
node chrome-clipper/check.mjs                         # manifests, icons, catalogues
node --test chrome-clipper/*.test.mjs                 # queue and button handler
```

There is no build step: the store packages contain these files as they are.
The notes inside each folder are in Russian and mention paths of the main (private)
Beresta repository, where these folders live as `packages/chrome-clipper` and
`packages/firefox-clipper`.

## Privacy

<https://beresta.page/privacy/#browser-extension>

## License

MIT — see [LICENSE](LICENSE). Beresta itself is a paid app with closed source; the browser
extensions, the Obsidian plugin and the [data format](https://github.com/SecondBrainProd/beresta-obsidian)
are open.

---

# Beresta Clipper — расширения браузера

Одна кнопка — и страница, которую вы читаете, в библиотеке [Бересты](https://beresta.page):
статьёй во «Входящих», читается и выделяется, как книги.

**Нужна Береста для Mac.** Расширение говорит только с Берестой на этом же компьютере
(`127.0.0.1`) и только после того, как вы включили «Принимать вырезки из браузера»
(Параметры → «Вырезки») и вписали её токен в настройки расширения. Ничего не собирает и
ничего не отправляет в интернет. Если Береста закрыта, страница ждёт в браузере и уходит
сама, как только Береста откроется (не больше 20 страниц); на кнопке видно, сколько ждёт.

Лицензия — MIT. Сама Береста — платная программа с закрытым кодом; открыты расширения,
плагин Obsidian и формат данных.
