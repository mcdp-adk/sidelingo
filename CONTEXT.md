# sidelingo

A Windows desktop companion that turns captured text or images into structured, readable content, then translates it or explains it as a dictionary entry.

## Language

### Processing

**Input**:
The text or image handed to sidelingo for one round of processing.
_Avoid_: Query, selection (a selection is one place an Input can come from)

**Structuring** (整理):
Turning an Input into well-organized, readable Source text; always applied, whether the Input is plain text or an image.
_Avoid_: Formatting, Markdown conversion, OCR

**Source text** (原文):
The structured result of Structuring, in the Input's own language.
_Avoid_: Original, raw text

**Entry** (词条):
Source text that is a single word or phrase rather than running text.
_Avoid_: Term, keyword

**Lookup** (查词):
Processing an Entry: explaining it in the source language and in the target language independently, rather than translating one explanation into the other.
_Avoid_: Dictionary mode, word explain

**Translation** (翻译):
Processing Source text that is not an Entry: rendering it into the target language.

**Translated text** (译文):
The result of Translation.

### Presentation

**Pin window** (悬浮窗):
The single, always-on-top sidelingo window that shows the results of the current round.
_Avoid_: Popup, overlay, 贴图 (a Snipaste pin holds an image)

**Display mode** (显示模式):
Which results the window shows: source only, translation only, or side-by-side. For a Lookup, "source" and "translation" mean the source-language and target-language explanations.
