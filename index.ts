/**
 * pi-gpt-transcribe — Pi extension. Registers `/transcribe`, a dictation
 * overlay whose speech-to-text runs through OpenAI's gpt-transcribe model.
 *
 * Config is read once here, at load, so the hotkey binding is fixed for the
 * session (rebinding takes a `/reload`). The command handler re-reads the file
 * on every run, so every other setting applies to the next `/transcribe`
 * without a restart.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTranscribe } from "./src/command.js";
import { loadConfig } from "./src/config.js";

export default function (pi: ExtensionAPI): void {
	registerTranscribe(pi, loadConfig());
}
