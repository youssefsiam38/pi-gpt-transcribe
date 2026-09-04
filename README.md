# pi-gpt-transcribe

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Dictate prompts to [Pi Agent](https://github.com/badlogic/pi-mono) instead of typing them.
`pi-gpt-transcribe` adds a `/transcribe` command and a `Ctrl-Q` hotkey: an overlay opens,
you speak, you press `Enter`, and the transcript drops into Pi's editor. Speech-to-text
runs through OpenAI's [`gpt-transcribe`](https://developers.openai.com/api/docs/models/gpt-transcribe)
model, so you need an OpenAI API key and audio does leave your machine.

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

Then press `Ctrl-Q`, or type `/transcribe`, and talk. Text appears a beat after each phrase
— every pause closes a segment and sends it.

| Key | Action |
| --- | --- |
| `Enter` | Close the overlay and paste the transcript into Pi's prompt |
| `Esc` | Close the overlay and paste nothing |
| `Space` | Pause / resume |
| `Ctrl-Q` | Open the overlay from the idle prompt |

Nothing is submitted for you. The transcript lands in the editor so you can fix a misheard
word before it reaches the model.

## What you get

- **Phrase-by-phrase transcription, in order** — a voice-activity detector cuts the
  recording at natural pauses and each segment becomes one request. Segments transcribe
  concurrently and each fills the slot it was cut into, so the transcript reads in spoken
  order without your phrases queueing behind one another.
- **Any microphone works** — capture is delivered at 16 kHz mono whatever the device's
  native rate, resampled inside the capture layer.
- **A hotkey that reaches the idle prompt** — `Ctrl-Q` is the one plain control key Pi's
  keymaps leave unclaimed. Rebind it, or turn it off, in the config file.
- **Domain vocabulary** — `prompt`, `keywords` and `languages` are passed through to
  `gpt-transcribe`, so project names and jargon come back spelled right.
- **`Enter` does not wait on a backlog** — nothing is ever transcribed twice, and the
  trailing buffer is checked for speech before it is sent, so ending on a pause costs no
  request and no wait at all. Press `Enter` mid-sentence and only that tail is
  outstanding.
- **Failures stay out of your transcript** — a request that errors is retried, then logged
  to a file rather than printed into the overlay. The rest of the dictation is unaffected.
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
| `hotkey` | `ctrl+q` | Key that opens the overlay. `"off"` disables it |
| `prompt` | *(unset)* | Free-form context about what you dictate |
| `keywords` | *(unset)* | Literal terms that may appear in the audio |
| `languages` | *(unset)* | Language hints, e.g. `["en", "fr"]`. Absent means auto-detect |
| `maxSegmentSeconds` | `20` | Cut and send a segment this long even without a pause |
| `minSegmentSeconds` | `0.35` | Drop segments shorter than this — they are clicks, not speech |
| `vadThreshold` | `0.5` | Speech probability above which audio counts as speech (`0`–`1`) |
| `silenceHoldoffMs` | `500` | Quiet time that ends a phrase |
| `speechFloor` | `0.005` | Peak level below which a segment is silence and is never sent |

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
- **`Ctrl-Q` freezes the terminal instead of opening the overlay** — `Ctrl-Q` is XOFF
  software flow control on some setups. Run `stty -ixon`, or set `"hotkey"` to something
  else in the config file.
- **`/transcribe` is not found** — restart your Pi session after installing.
- **Pi exits with `ERR_INVALID_STATE: ReadableStream is already closed`** — fixed in
  0.1.1. Update with `pi update git:github.com/youssefsiam38/pi-gpt-transcribe`.
- **A phrase silently failed to transcribe** — errors go to
  `~/.config/pi-gpt-transcribe/errors.log`, not to the terminal, because stderr would
  corrupt the live overlay. The underlying HTTP status and message are there.
- **`/transcribe needs an interactive session`** — the command draws a TUI overlay and does
  nothing in `--print` or JSON mode.

## License

MIT — see [LICENSE](LICENSE).
