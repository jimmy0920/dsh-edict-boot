# dsh-edict-boot

A boot animation for **DeepSeek Harness** — an imperial memorial (奏折) unfolds and
opens onto the app, as if you are the emperor starting the day's work.

A real filmed prop: crimson silk cover with gold dragons, accordion-folded paper
opening across six seconds. Paired with a recorded "上朝" (court convenes) voice
line and a 16-second court music bed. In the last stretch the memorial dissolves
into mist while the DSH interface fades in.

[中文文档](README.md)

---

## Install

```sh
dsh plugin --profile <your-profile> add <path-or-git-url>
```

From a local clone:

```sh
dsh plugin --profile desktop add /path/to/dsh-edict-boot
```

**Restart DSH after installing**, then press **Ctrl+Shift+R** in the window
(the client bundle is served with `immutable` and will otherwise stay cached).

### Uninstall

```sh
dsh plugin --profile desktop remove dsh-edict-boot
```

---

## What you get

| | |
|---|---|
| Video | 6s, 1248×704, H.264 — the memorial unfolding |
| Voice | 1.93s recorded "上朝" (low male voice, f0 64–72 Hz) |
| Music | 16s, three-variation pentatonic court theme, seamless loop |
| Transition | Cross-fade: memorial dissolves out, DSH fades in |

No external assets, no network calls. Everything ships in `lib/media/`.

### About the sound

Browsers block audio autoplay without a user gesture — this is a hard rule that
no site can bypass. The animation always plays silently on its own; click
**🔈 点击开启声音** in the lower-left corner to bring the sound in. Once clicked,
the slot stays unlocked for the rest of the session.

---

## Platform support

| | web profile | desktop |
|---|---|---|
| Injected via | `webServer.tapIndex` | browser-side self-boot |
| Why the difference | — | desktop loads through the `dsh-app://` protocol, which never passes through `tapIndex` |

The desktop path is the reason this plugin has a browser-half bootstrap: without
it the animation simply never appears there. The two paths are mutually exclusive
via a `__DSH_EDICT_BOOT__` handshake, so it never plays twice.

---

## Configuration

Settings → **奏折开机动画**

| Option | Notes |
|---|---|
| Enable | Master switch. When off, nothing is injected at all |
| Allow skip | Esc, or the button in the lower right |
| Speed | 0.5×–2.5× |
| Video | Use the filmed clip, or fall back to the pure-CSS rendition |

Config lives at `$DSH_HOME/edict-boot.json`.

---

## Development

```sh
node test/smoke.mjs    # host: routes, Range/ETag, injection
```

No build step — `lib/` contains runnable output (native ESM and a hand-written
client bundle). Edit and restart DSH.

Preview page: `lib/preview.html` (open directly, or via `/dsh-edict/preview`).

---

## License

BSD-3-Clause. The bundled media are original works by the author, licensed under
the same terms. See [LICENSE](LICENSE).
