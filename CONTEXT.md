# sidelingo

A Windows desktop companion that turns captured text or images into structured, readable content, then translates it.

## Language

### Processing

**Input**:
The text or image handed to sidelingo for one round of processing.
_Avoid_: Query, selection (a selection is one place an Input can come from)

**Round** (一轮):
One pass of processing, from an Input through Structuring to a finished Translation.
_Avoid_: Request, job (a Round may involve several model requests)

**Structuring** (整理):
Turning an Input into well-organized, readable Source text; always applied, whether the Input is plain text or an image.
_Avoid_: Formatting, Markdown conversion, OCR

**Source text** (原文):
The structured result of Structuring, in the Input's own language.
_Avoid_: Original, raw text

**Translation** (翻译):
Rendering Source text into the target language.

**Translated text** (译文):
The result of Translation.

### Presentation

**Pin window** (悬浮窗):
The single, always-on-top sidelingo window that shows the results of the current round.
_Avoid_: Popup, overlay, 贴图 (a Snipaste pin holds an image)

**Display mode** (显示模式):
Which results the window shows: source only, translation only, or side-by-side.

### Providers

**Provider** (服务商):
The service hosting the model that sidelingo calls for every Round.
_Avoid_: Backend, API, vendor

**Preset** (预设):
One of the Provider choices sidelingo offers: OpenAI, OpenRouter, DeepSeek, Ollama Cloud, or Custom; at most one is active.
_Avoid_: Profile, template
