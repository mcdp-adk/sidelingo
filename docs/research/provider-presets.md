# Provider preset API facts

Research for [#4](https://github.com/mcdp-adk/sidelingo/issues/4) under the map [#1](https://github.com/mcdp-adk/sidelingo/issues/1). Gathered 2026-09-29 from official docs, first-party SDK source, and live requests to public, unauthenticated endpoints. Everything below is about the OpenAI Chat Completions protocol (`POST {base}/chat/completions`). This note does not design sidelingo's settings.

## Summary

| | OpenAI | OpenRouter | DeepSeek | Ollama Cloud |
| --- | --- | --- | --- | --- |
| Base URL | `https://api.openai.com/v1` | `https://openrouter.ai/api/v1` | `https://api.deepseek.com` | `https://ollama.com/v1` |
| Auth header | `Authorization: Bearer <key>` | `Authorization: Bearer <key>` | `Authorization: Bearer <key>` | `Authorization: Bearer <key>` |
| Key env var | `OPENAI_API_KEY` | `OPENROUTER_API_KEY` | `DEEPSEEK_API_KEY` | `OLLAMA_API_KEY` |
| Reasoning control | `reasoning_effort` | `reasoning: {effort}` (also `reasoning_effort`) | `reasoning_effort` and/or `thinking: {type}` | `reasoning_effort` or `reasoning: {effort}` |
| Effort values | `none` `minimal` `low` `medium` `high` `xhigh` `max`, subset per model | `max` `xhigh` `high` `medium` `low` `minimal` `none`, mapped per model | `none` `low` `high` `max` (aliases accepted) | model-defined; aliases mapped |
| Reasoning text in response | not returned (token count only) | `reasoning`, `reasoning_details` | `reasoning_content` | `reasoning` |
| Image input | `image_url`: URL or base64 data URL | `image_url`: URL or base64 data URL | `image_url`: URL or base64 data URL (`deepseek-flash` only) | `image_url`: base64 data URL only |
| Streaming | SSE, `data: [DONE]` | SSE, `: OPENROUTER PROCESSING` comments, in-stream errors | SSE, `: keep-alive` comments | SSE |
| Model list | `GET /models`, no capability data | `GET /models`, modalities + reasoning metadata | `GET /models`, no capability data | `GET /v1/models`, no capability data; `/api/show` has it |

## OpenAI

**Base URL and auth.** The official Python SDK defaults to `https://api.openai.com/v1` and overrides it from `OPENAI_BASE_URL`. It reads the key from `OPENAI_API_KEY`, and optionally `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` ([`_client.py`](https://github.com/openai/openai-python/blob/main/src/openai/_client.py)). The SDK posts to the path `/chat/completions` relative to the base URL ([`completions.py`](https://github.com/openai/openai-python/blob/main/src/openai/resources/chat/completions/completions.py)). Requests use `Authorization: Bearer $OPENAI_API_KEY` ([List models](https://developers.openai.com/api/reference/resources/models/methods/list)).

**Chat Completions status.** Chat Completions is still supported, but OpenAI steers new work to the Responses API. The model guides are written for Responses ([Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning), [GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra)). Every current model page lists `v1/chat/completions` as "Supported".

**Current models.** The catalog features GPT-6 Astra (flagship), GPT-5.6 Terra (balanced), and GPT-5.6 Luna (cost-sensitive) ([Models](https://developers.openai.com/api/docs/models)). The SDK's model enum also lists `gpt-6-sol`, `gpt-6-luna`, and `gpt-5.6-sol` ([`chat_model.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/chat_model.py)).

**Reasoning effort.** The top-level `reasoning_effort` field takes `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. "Not all reasoning models support every value" ([Chat reference](https://developers.openai.com/api/reference/resources/chat), [`reasoning_effort.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/shared/reasoning_effort.py)). Support by model, from each model page:

| Model | Supported efforts | Default |
| --- | --- | --- |
| [`gpt-6-astra`](https://developers.openai.com/api/docs/models/gpt-6-astra) | `low` `medium` `high` `xhigh` `max` (`none` returns HTTP 400) | not stated |
| [`gpt-6-sol`](https://developers.openai.com/api/docs/models/gpt-6-sol), [`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna) | `none` `low` `medium` `high` `xhigh` `max` | `medium` |
| [`gpt-5.6-sol`](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [`-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [`-luna`](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | `none` `low` `medium` `high` `xhigh` `max` | `medium` |
| [`gpt-5.4-mini`](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | `none` `low` `medium` `high` `xhigh` | `none` |
| [`gpt-4.1-mini`](https://developers.openai.com/api/docs/models/gpt-4.1-mini) and other non-reasoning models | no reasoning support | none |

- When effort is not `none`, remove `temperature`, `top_p`, `top_logprobs`, and (in Chat Completions) `logprobs` ([GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra)).
- The guide recommends replacing `minimal` with `low` for GPT-6 ([GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra)).
- Reasoning summaries are a Responses-only feature ([Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)).

**Vision.** "All latest OpenAI models support text and image input" ([Models](https://developers.openai.com/api/docs/models)). Every model page above lists "Input modalities: text, image". In Chat Completions, a user content part is `{"type": "image_url", "image_url": {"url", "detail"}}`. `url` is "Either a URL of the image or the base64 encoded image data", and `detail` is `auto` | `low` | `high` ([Chat reference](https://developers.openai.com/api/reference/resources/chat)). The vision guide also mentions an `original` detail level for some models, which is not in the Chat Completions enum. Limits ([Images and vision](https://developers.openai.com/api/docs/guides/images-vision)):
- Formats: PNG, JPEG, WEBP, and non-animated GIF.
- Up to 512 MB total payload and 1,500 images per request.
- Up to 30,000 patches per image; oversized images are rejected, not resized.

**Streaming.** SSE chunks carry `choices[].delta` with `content`, `refusal`, `role`, `tool_calls`, and the deprecated `function_call`. There is no reasoning-text field ([streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)). Other stream behaviour:
- With `stream_options: {"include_usage": true}`, the last chunk carries `usage` (including `completion_tokens_details.reasoning_tokens`), and its `choices` array may be empty.
- An interrupted stream may never deliver the usage chunk.
- Chunks include an `obfuscation` padding field by default. Setting `stream_options.include_obfuscation: false` omits it.

**Model list.** `GET /v1/models` returns only `id`, `created`, `object`, `owned_by`, and `shutdown_date` ([List models](https://developers.openai.com/api/reference/resources/models/methods/list)). It says nothing about vision or reasoning. The docs model pages are the only capability source.

## OpenRouter

**Base URL and auth.** Requests go to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <OPENROUTER_API_KEY>`. Two attribution headers are optional: `HTTP-Referer` (site URL) and `X-OpenRouter-Title` (older alias `X-Title`). `X-OpenRouter-Categories` is also accepted ([Quickstart](https://openrouter.ai/docs/quickstart), [API overview](https://openrouter.ai/docs/api/reference/overview)). The quickstart's SDK examples read `OPENROUTER_API_KEY` from the environment.

**Reasoning effort.** The unified parameter is `reasoning: {effort | max_tokens, exclude, enabled}`. `effort` and `max_tokens` cannot be sent together. `effort` takes `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`, where `none` disables reasoning ([Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)). The OpenAI-style top-level `reasoning_effort` is also accepted, with values `xhigh`, `high`, `medium`, `low`, `minimal`, `none` ([Parameters](https://openrouter.ai/docs/api_reference/parameters)). OpenRouter translates effort into each upstream's own vocabulary:
- For Anthropic models, effort becomes a token budget: `max(min(max_tokens × ratio, 128000), 1024)`.
- The ratios are 0.95 for max/xhigh, 0.8 for high, 0.5 for medium, 0.2 for low, and 0.1 for minimal.

Per-model limits are machine-readable: each model in `GET /api/v1/models` may carry `reasoning: {supported_efforts, default_effort, default_enabled, supports_max_tokens, mandatory}` ([Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)). How to read it:
- If `supported_efforts` is `null`, all efforts are accepted.
- If the `reasoning` field is omitted, the model has no effort control.
- If `mandatory: true`, the model rejects `effort: "none"`.

For example, on 2026-09-29 the live `openai/gpt-6-luna` entry returned `supported_efforts: ["max","xhigh","high","medium","low","none"]` and `default_effort: "medium"`.

Other reasoning details:
- `max_tokens` covers reasoning plus visible output. If it is too small, the response can end with `finish_reason: "length"` and empty `content`.
- Reasoning text is returned by default in `message.reasoning`, and structured in `message.reasoning_details`. In a stream these arrive as `delta.reasoning` and `delta.reasoning_details`.
- `exclude: true` hides reasoning. The legacy `include_reasoning` is a deprecated alias.
- OpenAI o-series models do not return reasoning text.

**Vision.** Chat Completions accepts `image_url` content parts with either a URL or a base64 data URL ([Image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)). Supported types are `image/png`, `image/jpeg`, `image/webp`, and `image/gif`. The number of images per request varies by provider and model. OpenRouter recommends putting text before images. Vision-capable models are identified by `architecture.input_modalities` containing `"image"`, and can be filtered server-side with `GET /api/v1/models?input_modalities=image` (292 models on 2026-09-29) ([Models](https://openrouter.ai/docs/guides/overview/models), [List models](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)).

**Streaming quirks** ([Streaming](https://openrouter.ai/docs/api/reference/streaming)):
- The stream includes SSE comment lines such as `: OPENROUTER PROCESSING`. Clients must skip them before parsing JSON.
- Just before `[DONE]` comes a usage chunk: one choice with a content-free delta that repeats `finish_reason`.
- Errors after streaming has started arrive as an in-stream event with a top-level `error` and `finish_reason: "error"`, while the HTTP status stays 200. The docs say "Treat a 200 carrying an error chunk with no content as a failure."
- Errors before the stream starts use normal HTTP codes (400, 401, 429, …).
- Aborting the connection cancels generation only for supported upstreams. Otherwise the request is billed in full.

**Model list.** `GET https://openrouter.ai/api/v1/models` is public. Its `architecture.input_modalities` / `output_modalities` fields show vision support, `supported_parameters` lists `reasoning`, `reasoning_effort`, `include_reasoning`, and so on, and the `reasoning` object gives effort limits. Query filters: `input_modalities`, `output_modalities`, `supported_parameters`, `q`, `sort`.

## DeepSeek

**Base URL and auth.** The OpenAI-format base URL is `https://api.deepseek.com`, with no `/v1`. The Anthropic-format URL `https://api.deepseek.com/anthropic` is also offered. Official examples call `https://api.deepseek.com/chat/completions` with `Authorization: Bearer ${DEEPSEEK_API_KEY}`, and the OpenAI SDK examples read `DEEPSEEK_API_KEY` ([Your first API call](https://api-docs.deepseek.com/)).

**Current models** ([Models & pricing](https://api-docs.deepseek.com/quick_start/pricing), [Changelog](https://api-docs.deepseek.com/updates)):
- **`deepseek-flash`** is DeepSeek-V4.1-Flash, released 2026-09-10. It has a 1M-token context, up to 384K output tokens, and vision.
- **`deepseek-v4-pro`** is DeepSeek-V4-Pro-0813. It has no vision and remains available after 2026-09-14.
- **Legacy names:** `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still accepted and routed to V4.1 Flash. The changelog announced that `deepseek-chat` and `deepseek-reasoner` would be discontinued on 2026-07-24.
- **Stale guide:** the [Thinking mode guide](https://api-docs.deepseek.com/guides/thinking_mode) still uses `deepseek-chat` and `deepseek-reasoner` and an older parameter list. The API reference below is the current contract.

**Reasoning effort** ([Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)):
- **`thinking: {"type": "enabled" | "disabled"}`** switches thinking on or off. The default is `enabled`, so thinking is on unless disabled. The OpenAI SDK has no typed field for it, so SDK users pass it via `extra_body`.
- **`reasoning_effort`** takes `none`, `low`, `high`, or `max`. `none` disables thinking; the other three enable it. The default effort is `high`.
- **Accepted aliases:** `minimal` maps to `low`; `medium` and `xhigh` map to `high`.
- **Effort levels** were introduced 2026-08-13 for V4-Pro and V4-Flash ([Changelog](https://api-docs.deepseek.com/updates)).
- **`max_tokens` default:** 8K in non-thinking mode, 64K in thinking mode, and 128K with `reasoning_effort: "max"`.
- **In thinking mode:**
  - `temperature` has no effect.
  - `top_p` values below 0.95 are raised to 0.95.
  - `tool_choice: "required"` or a named tool returns 400.

**Vision.** User messages accept `{"type": "image_url", "image_url": {"url", "detail"}}`. `url` is an http(s) URL of at most 8192 characters or a base64 data URL. `detail` is `low` (downsample to 512×512), `high`, `original`, or `auto`. There is also a `file` part (`file_id` / `file_data`) ([Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)). Per the [Vision guide](https://api-docs.deepseek.com/guides/vision):
- Vision is `deepseek-flash` only.
- Formats: JPEG, PNG, GIF, WebP.
- Up to 32 MiB per base64/URL image, 64 MiB per request, and 600 images per request.
- Maximum 8192 px per side (4096 px when a request has 15 or more images).
- Each image costs up to 1024 tokens.
- Images in `system` or `assistant` messages return 400.

The docs do not say whether thinking mode and image input can be combined.

**Streaming.** SSE, ending with `data: [DONE]`. Chunks carry `delta.reasoning_content` (chain of thought) separately from `delta.content`. With `stream_options.include_usage`, usage rides on the last content chunk; there is no separate usage-only chunk. Sending `stream_options` without `stream: true` returns 400 ([Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)). Across turns, previous `reasoning_content` should not be sent back, except during a tool-call loop inside one turn, where omitting it returns 400 ([Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)). While waiting, the server sends `: keep-alive` SSE comments on streams and empty lines on non-stream responses. It closes the connection if inference has not started after 10 minutes ([Rate limit](https://api-docs.deepseek.com/quick_start/rate_limit)).

**Model list.** `GET /models` returns `id`, `object`, and `owned_by` only ([List models](https://api-docs.deepseek.com/api/list-models)). It has no capability data. Vision is documented per model on the pricing page.

## Ollama Cloud (direct, `https://ollama.com/v1`)

**Base URL and auth.** "Set your API key in `OLLAMA_API_KEY` … No Ollama installation required". The example uses `base_url="https://ollama.com/v1"` ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)). Direct access to ollama.com requires an API key sent as `Authorization: Bearer $OLLAMA_API_KEY`. Keys don't expire but can be revoked ([Authentication](https://docs.ollama.com/api/authentication), [Cloud](https://docs.ollama.com/cloud)). The cloud does not support stateful Responses, built-in web search via `/v1/responses`, or custom/freeform tool-call replay. Model IDs come from `https://ollama.com/api/tags` and need no pull. The `:cloud` / `-cloud` suffixes apply only when going through a signed-in local server, which is out of scope.

**Reasoning effort.** `/v1/chat/completions` accepts both `reasoning_effort` and `reasoning.effort`, as "model-defined names and compatibility aliases" ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)):
- Models with thinking metadata apply supported names exactly. Unsupported names fall back to the model default.
- Boolean-only models map any recognized effort to `true`, and `"none"` to `false`.
- Models without metadata use aliases: `minimal` becomes `low`, and `xhigh`/`ultra` become `max`.
- GPT-OSS maps `minimal` to `low`, `xhigh`/`ultra` to `high`, and `none` to no thinking output.
- The server rejects values outside `minimal`, `low`, `medium`, `high`, `xhigh`, `ultra`, `max`, `none` ([`openai/openai.go`](https://github.com/ollama/ollama/blob/main/openai/openai.go)).

"Thinking is enabled by default in the CLI and API for supported models" ([Thinking](https://docs.ollama.com/capabilities/thinking)). The docs point to `/api/show` for each model's supported values and default.

**Live cloud catalog (2026-09-29).** `POST https://ollama.com/api/show` answered without a key and returned `capabilities` and a `thinking: {values, default}` object for each model. This observed behaviour matches the Cloud docs' statement that ollama.com "acts as a remote Ollama host", but the docs do not specifically document `/api/show` on ollama.com.

| Model | Vision | Thinking values (default) |
| --- | --- | --- |
| `deepseek-v4.1-flash` | yes | false, low, high, max (high) |
| `deepseek-v4-pro:0813` | no | false, low, high, max (low) |
| `gemma4:31b` | yes | false, true (false) |
| `kimi-k3` | yes | false, low, high, max (max) |
| `kimi-k2.6` | yes | false, true (true) |
| `kimi-k2.7-code` | yes | false, true (true) |
| `glm-5.3-flash` | yes | low, high, max (max) — cannot disable |
| `glm-5.3` | no | low, high, max (max) — cannot disable |
| `glm-5.2` | no | false, high, max (high) |
| `minimax-m3` | yes | thinking capability, no `thinking` metadata |
| `minimax-m2.7` | no | true only — cannot disable |
| `mistral-large-3:675b` | yes | no thinking |
| `gpt-oss:120b`, `gpt-oss:20b` | no | low, medium, high (medium) — cannot disable |
| `nemotron-3-ultra`, `nemotron-3-super`, `nemotron-3-nano:30b` | no | false, true (true) |

**Vision.** Chat Completions accepts image content parts, but only as base64: "Base64 encoded image [x] / Image URL [ ]" ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)). The docs example passes `image_url` as a bare data-URL string. The table above shows which cloud models report the `vision` capability.

**Streaming.** `stream` and `stream_options.include_usage` are supported. In Ollama's OpenAI layer, reasoning text is emitted as `message.reasoning` / `delta.reasoning`, sent in its own chunk before the content or tool-call chunk ([`openai/openai.go`](https://github.com/ollama/ollama/blob/main/openai/openai.go)). This comes from the open-source server; the docs page does not name the field. Also unsupported: `tool_choice`, `logprobs`, `logit_bias`, `user`, and `n`.

**Model list.**
- `GET https://ollama.com/v1/models` answered without a key and returned `id`, `object`, `created`, and `owned_by` for 17 models. It carries no capability data.
- `GET https://ollama.com/api/tags` is the documented cloud list ([Cloud](https://docs.ollama.com/cloud)). Its `details` fields were empty for cloud models.
- Capabilities come only from `POST /api/show`.

## Custom (generic OpenAI-compatible endpoint)

What an arbitrary Chat Completions endpoint needs, as the reference clients model it:
- **Base URL.** The client appends `/chat/completions`. Whether the base includes `/v1` differs by vendor: DeepSeek uses `https://api.deepseek.com`, while the others end in `/v1` (sources above). The OpenAI SDK takes it as `base_url` or `OPENAI_BASE_URL`.
- **API key.** Sent as a Bearer token. Some servers ignore it; for local Ollama the key is "required but ignored" ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)).
- **Model ID.** Free text. `GET {base}/models` may be absent or may carry no capability data, as with OpenAI, DeepSeek, and Ollama `/v1/models`.
- **Extra headers.** Examples are OpenRouter's attribution headers and Anthropic's browser-access header. Read Frog's generic `openai-compatible` provider stores exactly `baseURL`, `apiKey`, `headers`, and a custom model ([`model.ts` L119-L127](https://github.com/mengxi-ream/read-frog/blob/main/src/utils/providers/model.ts), local clone).
- **Capabilities.** Vision support and the reasoning-effort dialect cannot be discovered through the OpenAI protocol itself. Across the four providers the dialects differ: `reasoning_effort` value sets differ, DeepSeek adds `thinking`, OpenRouter adds `reasoning`, and response reasoning text arrives as `reasoning_content` (DeepSeek), `reasoning` (OpenRouter, Ollama), or not at all (OpenAI).

## How Read Frog configures these (local clone `repos/read-frog`, read-only)

Read Frog uses the Vercel AI SDK rather than raw HTTP.
- **OpenAI** uses `@ai-sdk/openai` with base `https://api.openai.com/v1`. Its default model is `gpt-6-luna` (`src/utils/constants/providers.ts`).
- **DeepSeek** uses `@ai-sdk/deepseek` with base `https://api.deepseek.com`. Its default model is the legacy `deepseek-v4-flash`.
- **OpenRouter** is an `openai-compatible` provider with base `https://openrouter.ai/api/v1`. It forces the headers `HTTP-Referer` and `X-OpenRouter-Title` (providers.ts L602-L608, L672-L675).
- **Ollama** uses `ai-sdk-ollama` against the local `http://127.0.0.1:11434/` with `think: false` (`src/utils/providers/model.ts` L157-L158). Read Frog has no Ollama Cloud preset.
- **Reasoning** is a top-level setting (`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`) for the providers in `TOP_LEVEL_REASONING_PROVIDER_TYPES`, which include openai and deepseek but not openrouter or ollama (`src/types/config/provider/constants.ts` L278-L304). Everything else falls back to a free-form "provider options" JSON field.
- **Recommended options** are chosen by model-name regex and mostly minimise or disable thinking for translation. Examples: DeepSeek `thinking: {type: "disabled"}`, GPT-OSS `reasoningEffort: "low"`, Kimi K3 `reasoningEffort: "low"` (`src/utils/constants/models.ts` L577-L695).

## Proxy forms desktop apps support

**Windows system proxy.** The per-user Internet Options / WinINET settings expose four things, all readable through `WinHttpGetIEProxyConfigForCurrentUser` ([`WINHTTP_CURRENT_USER_IE_PROXY_CONFIG`](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/ns-winhttp-winhttp_current_user_ie_proxy_config)):
- "automatically detect settings" (WPAD),
- an auto-config (PAC) URL,
- a manual proxy string,
- a bypass list.

Windows' manual fields are HTTP, Secure, FTP, and SOCKS. All except SOCKS mean a plain HTTP proxy. `<local>` in the bypass list means "don't proxy simple hostnames" ([Chromium proxy doc](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)).

**How common runtimes consume it:**
- **.NET `HttpClient.DefaultProxy`.** On Windows it reads the environment variables first and otherwise the user's proxy settings. It accepts `http://`, `https://`, `socks4://`, `socks4a://`, and `socks5://` proxy URLs, with optional `user:password@` (the password is ignored for SOCKS4). A scheme-less value means `http` ([docs](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.defaultproxy)).
- **Rust `reqwest` 0.13.** It honours `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY`, plus the Windows registry and macOS system settings. It supports HTTP, HTTPS, and, with the `socks` feature, SOCKS4/4a/5/5h. It also offers `basic_auth` and custom proxy headers ([docs](https://docs.rs/reqwest/latest/reqwest/struct.Proxy.html)).
- **Chromium, Electron, and WebView2.** Chromium supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies. With SOCKS5 it always resolves DNS on the proxy side. It supports no SOCKS5 authentication, and it ignores credentials embedded in manual proxy settings. HTTP proxies can authenticate with Basic, Digest, Negotiate, or NTLM ([Chromium proxy doc](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)).
  - Electron exposes the modes `direct`, `auto_detect`, `pac_script`, `fixed_servers`, and `system`, with `proxyRules` such as `http=foopy:80;socks=socks5://…` and `proxyBypassRules` ([ProxyConfig](https://www.electronjs.org/docs/latest/api/structures/proxy-config)).
  - WebView2 follows system settings unless `--proxy-server` is passed through `AdditionalBrowserArguments` before the environment is created ([WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags), [AdditionalBrowserArguments](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2environmentoptions.additionalbrowserarguments)).

**Environment variables.**
- **Names.** `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (fallback), and `NO_PROXY` (exclusions).
- **Case rules.**
  - .NET accepts lowercase or uppercase names and checks lowercase first.
  - curl accepts `http_proxy` only in lowercase, because `HTTP_PROXY` can be injected through CGI. That clash has caused security bugs ([everything curl](https://everything.curl.dev/usingcurl/proxies/env.html)).
- **`NO_PROXY` semantics.**
  - In .NET, a leading dot matches subdomains only (`.example.com` does not match `example.com`), and `*` wildcards are not supported.
  - curl accepts `*` for all hosts, a leading dot for a whole domain, and CIDR ranges since 7.86.0.

**SOCKS details.** `socks5://` resolves DNS locally and `socks5h://` resolves it on the proxy (curl convention). `socks4` resolves locally and `socks4a` on the proxy. SOCKS4 has no IPv6 ([everything curl: SOCKS](https://everything.curl.dev/usingcurl/proxies/socks.html)).

**Common modes across these stacks.** Direct, system (including WPAD/PAC), manual HTTP(S), manual SOCKS5, and PAC URL. Credentials are either part of the proxy URL or handled by a separate auth flow.

## Open points

- **OpenAI detail levels.** The Chat Completions `detail` enum (`auto`/`low`/`high`) disagrees with the vision guide's `original` level. It is untested whether Chat Completions accepts `original`.
- **DeepSeek.** Nothing documents whether `deepseek-flash` can think over image input.
- **Ollama Cloud.** Two behaviours come from source code or live probes rather than docs: the `delta.reasoning` field name and unauthenticated `/api/show` on ollama.com. Both could change without notice.
- **Proxy authentication beyond Basic.** NTLM/Negotiate proxy auth outside Chromium, and .NET default-credential behaviour, were not researched.
