# pi-gpt-transcribe

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Dictate prompts to [Pi Agent](https://github.com/badlogic/pi-mono) instead of typing them —
or as well as typing them. `pi-gpt-transcribe` adds a `/transcribe` command and a `Ctrl-Q`
hotkey that toggle listening: each phrase you finish is transcribed and inserted into the
prompt at the cursor, while the prompt stays yours to edit with the keyboard the whole time.
Speech-to-text runs through OpenAI's
[`gpt-transcribe`](https://developers.openai.com/api/docs/models/gpt-transcribe) model, so you
need an OpenAI API key and audio does leave your machine.

## Install

Not published to npm — install it straight from git:

```sh
pi install git:github.com/youssefsiam38/pi-gpt-transcribe
```

Restart your Pi session. The first install takes a few minutes — it builds the native
audio capture library.

To update later, `pi update git:github.com/youssefsiam38/pi-gpt-transcribe`. To remove it,
`pi remove git:github.com/youssefsiam38/pi-gpt-transcribe`.

## Quick start

Export a **platform API key** (a ChatGPT/Codex OAuth login will not work — the audio
endpoint needs a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)):

```sh
export OPENAI_API_KEY=sk-...
```

Then press `Ctrl-Q`, or type `/transcribe`, and talk. A one-line indicator appears above the
prompt — `● 0:14 ▂▅▇▃` — and each phrase lands in the prompt a beat after you pause. Keep
typing while you talk: voice and keyboard share one cursor.

| Action | Effect |
| --- | --- |
| `Ctrl-Q` or `/transcribe` | Start listening; press again to stop |
| Type, arrow, backspace | Edit the prompt as usual — dictation keeps inserting at the cursor |
| `Enter` | Send the prompt. Listening stops, and a phrase still in flight is appended to what you sent |
| `Esc` | Pi's interrupt, unchanged. It does not stop listening; `Ctrl-Q` does |

## What you get

- **Phrase-by-phrase, in spoken order** — a voice-activity detector cuts at natural pauses
  and each segment is one request. Segments transcribe concurrently, but a phrase is only
  inserted once every earlier one has landed, so text in the prompt never reorders.
- **Any microphone works** — capture is delivered at 16 kHz mono whatever the device's
  native rate, resampled inside the capture layer.
- **A hotkey that reaches the idle prompt** — `Ctrl-Q` is the one plain control key Pi's
  keymaps leave unclaimed. Rebind it, or turn it off, in the config file.
- **Domain vocabulary** — `prompt`, `keywords` and `languages` are passed through to
  `gpt-transcribe`, so project names and jargon come back spelled right.
- **Read and write at once** — the prompt keeps keyboard focus while you dictate. Fix a
  misheard word mid-sentence, move the cursor, and the next phrase goes where you left it.
- **Submitting never loses a phrase** — `Enter` ends listening and waits, bounded, for
  anything still transcribing, then appends it to the text you sent. Nothing is ever
  transcribed twice, and ending on a pause costs no request and no wait.
- **Failures stay out of your prompt** — a request that errors is retried, then logged to a
  file and shown on the indicator line. The rest of the dictation is unaffected.
- **No SDK** — the only runtime dependency is the audio capture library. The API call is
  one `fetch`.

## Configuration

Everything is optional; with `OPENAI_API_KEY` set, there is nothing to configure. To change
a default, create `~/.config/pi-gpt-transcribe/config.json`:

```json
{
  "hotkey": "ctrl+q",
  "keywords": ["Kubernetes", "idempotent", "pi-gpt-transcribe"],
  "languages": ["en"]
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `model` | `gpt-transcribe` | Transcription model id |
| `baseUrl` | `https://api.openai.com/v1` | API root — point it at a gateway or proxy |
| `apiKey` | *(unset)* | Literal key. Prefer the environment variable |
| `apiKeyEnv` | `OPENAI_API_KEY` | Environment variable consulted for the key |
| `hotkey` | `ctrl+q` | Key that toggles listening. `"off"` disables it |
| `prompt` | *(unset)* | Free-form context about what you dictate |
| `keywords` | *(unset)* | Literal terms that may appear in the audio |
| `languages` | *(unset)* | Language hints, e.g. `["en", "fr"]`. Absent means auto-detect |
| `maxSegmentSeconds` | `20` | Cut and send a segment this long even without a pause |
| `minSegmentSeconds` | `0.35` | Drop segments shorter than this — they are clicks, not speech |
| `vadThreshold` | `0.5` | Speech probability above which audio counts as speech (`0`–`1`) |
| `silenceHoldoffMs` | `500` | Quiet time that ends a phrase |
| `speechFloor` | `0.005` | Absolute minimum for the speech gate. The gate itself is relative to the room's measured noise floor |
| `debug` | `false` | Write a decision trace to `~/.config/pi-gpt-transcribe/debug.log` |

The hotkey binds at load, so changing it needs a `/reload`. Every other key is re-read on
each `/transcribe`.

Key resolution order: `apiKey` in the config file, then `$OPENAI_API_KEY`, then whatever
Pi already holds for its own `openai` provider.

## Requirements

- **An OpenAI platform API key.** Billed at $0.0045 per minute of audio.
- **macOS, Linux or Windows on x64 / arm64.** The `decibri` capture library ships prebuilt
  binaries for those; musl/Alpine and 32-bit are out.
- **A microphone this terminal is allowed to use.** On macOS, grant your terminal access
  under System Settings → Privacy & Security → Microphone.
- **Node 22+**, which Pi already requires.

## Troubleshooting

- **`No API key`** — export `OPENAI_API_KEY` and restart the session. A ChatGPT/Codex OAuth
  login is not an API key and will not work here.
- **`Microphone unavailable`** — the OS refused the input device. Check an input device is
  connected and that the terminal has microphone permission, then re-run `/transcribe`.
- **`Ctrl-Q` freezes the terminal instead of toggling dictation** — `Ctrl-Q` is XOFF
  software flow control on some setups. Run `stty -ixon`, or set `"hotkey"` to something
  else in the config file.
- **`/transcribe` is not found** — restart your Pi session after installing.
- **Pi exits with `ERR_INVALID_STATE: ReadableStream is already closed`** — fixed in
  0.1.1. Update with `pi update git:github.com/youssefsiam38/pi-gpt-transcribe`.
- **Stopping still waits when you were silent at the end** — set `"debug": true` in the
  config file and dictate once. `~/.config/pi-gpt-transcribe/debug.log` records every
  voice-detector transition, each segment with the reason it was cut and whether it was
  sent or dropped, and how long the commit waited.
- **A phrase silently failed to transcribe** — errors go to
  `~/.config/pi-gpt-transcribe/errors.log`, not to the terminal, because stderr would
  corrupt the live TUI. The underlying HTTP status and message are there.
- **`/transcribe … needs an interactive session`** — dictation inserts into the TUI prompt
  and does nothing in `--print` or JSON mode.

## License

MIT — see [LICENSE](LICENSE).
