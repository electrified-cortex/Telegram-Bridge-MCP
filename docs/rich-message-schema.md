# Rich Message Schema — Bot API 10.1

**Source URL:** https://core.telegram.org/bots/api  
**Fetch date:** 2026-06-13  
**Bot API version:** 10.1 (released 2026-06-11)

---

## Summary

Bot API 10.1 adds full support for Rich Messages, allowing bots to send highly structured
text and stream AI-generated replies with seamless rich formatting.

### Availability

- `sendRichMessage` — **CONFIRMED present** in live docs
- `sendRichMessageDraft` — **CONFIRMED present** in live docs
- Draft lifecycle: `sendRichMessageDraft` streams an ephemeral 30-second preview; caller must
  follow up with `sendRichMessage` to persist the final message.
- Minimum Telegram client version required for rich messages — **not documented** in the fetched
  API page.

---

## Rich Message Limits

| Limit | Value |
|---|---|
| Max UTF-8 characters in rich message text | 32 768 (includes custom emoji alt-text and formula source) |
| Max blocks (incl. nested, list items, table rows, quotation/details blocks) | 500 |
| Max nesting levels of formatting / blocks | 16 |
| Max media attachments (photos, videos, audio) | 50 |
| Max columns in a table | 20 |

---

## Methods

### `sendRichMessage`

> Use this method to send rich messages. If the message contains a block with a media element,
> then the bot must have the right to send the media to the chat. On success, the sent `Message`
> is returned.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `business_connection_id` | String | Optional | Unique identifier of the business connection on behalf of which the message will be sent |
| `chat_id` | Integer or String | **Yes** | Unique identifier for the target chat or username of the target bot, supergroup or channel in the format @username |
| `message_thread_id` | Integer | Optional | Unique identifier for the target message thread (topic) of a forum; for forum supergroups and private chats of bots with forum topic mode enabled only |
| `direct_messages_topic_id` | Integer | Optional | Identifier of the direct messages topic; required if the message is sent to a direct messages chat |
| `rich_message` | InputRichMessage | **Yes** | The message to be sent |
| `disable_notification` | Boolean | Optional | Sends the message silently |
| `protect_content` | Boolean | Optional | Protects the contents of the sent message from forwarding and saving |
| `allow_paid_broadcast` | Boolean | Optional | Pass True to allow up to 1000 messages per second, ignoring broadcasting limits for a fee of 0.1 Telegram Stars per message |
| `message_effect_id` | String | Optional | Unique identifier of the message effect; for private chats only |
| `suggested_post_parameters` | SuggestedPostParameters | Optional | Parameters of the suggested post; for direct messages chats only |
| `reply_parameters` | ReplyParameters | Optional | Description of the message to reply to |
| `reply_markup` | InlineKeyboardMarkup or ReplyKeyboardMarkup or ReplyKeyboardRemove or ForceReply | Optional | Additional interface options |

---

### `sendRichMessageDraft`

> Use this method to stream a partial rich message to a user while the message is being generated.
> The streamed draft is ephemeral and acts as a temporary 30-second preview — once finalized,
> you **must** call `sendRichMessage` with the complete message to persist it.
> Returns `True` on success.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chat_id` | Integer | **Yes** | Unique identifier for the target private chat |
| `message_thread_id` | Integer | Optional | Unique identifier for the target message thread |
| `draft_id` | Integer | **Yes** | Unique identifier of the message draft; must be non-zero. Changes to drafts with the same identifier are animated. |
| `rich_message` | InputRichMessage | **Yes** | The partial message to be streamed |

---

## Types

### `RichMessage`

Rich formatted message (received in `Message.rich_message`).

| Field | Type | Required | Description |
|---|---|---|---|
| `blocks` | Array of RichBlock | **Yes** | Content of the message |
| `is_rtl` | Boolean | Optional | True, if the rich message must be shown right-to-left |

---

### `InputRichMessage`

Describes a rich message to be sent. Exactly **one** of the fields `html` or `markdown` must be used.

| Field | Type | Required | Description |
|---|---|---|---|
| `html` | String | Optional (one of) | Content described using HTML formatting |
| `markdown` | String | Optional (one of) | Content described using Markdown formatting |
| `is_rtl` | Boolean | Optional | Pass True if the rich message must be shown right-to-left |
| `skip_entity_detection` | Boolean | Optional | Pass True to skip automatic detection of URLs, email addresses, username mentions, hashtags, cashtags, bot commands, and phone numbers |

---

### `InputRichMessageContent`

Represents the content of a rich message to be sent as the result of an inline query.
Can be used as `InputMessageContent` in results of inline, guest, and Web App queries.

| Field | Type | Required | Description |
|---|---|---|---|
| `rich_message` | InputRichMessage | **Yes** | The message to be sent |

---

### `RichText`

This object represents rich formatted text. It can be:
- A plain `String`
- An `Array of RichText` (concatenation)
- Any of the typed variants listed below

| Variant type string | Interface | Description |
|---|---|---|
| `"bold"` | RichTextBold | Bold text |
| `"italic"` | RichTextItalic | Italic text |
| `"underline"` | RichTextUnderline | Underlined text |
| `"strikethrough"` | RichTextStrikethrough | Strikethrough text |
| `"spoiler"` | RichTextSpoiler | Text covered by a spoiler |
| `"date_time"` | RichTextDateTime | Formatted date and time |
| `"text_mention"` | RichTextTextMention | Mention by user identifier |
| `"subscript"` | RichTextSubscript | Subscript text |
| `"superscript"` | RichTextSuperscript | Superscript text |
| `"marked"` | RichTextMarked | Marked/highlighted text |
| `"code"` | RichTextCode | Monowidth (inline code) text |
| `"custom_emoji"` | RichTextCustomEmoji | Custom emoji |
| `"mathematical_expression"` | RichTextMathematicalExpression | Inline LaTeX expression |
| `"url"` | RichTextUrl | Text with a URL link |
| `"email_address"` | RichTextEmailAddress | Text with an email address |
| `"phone_number"` | RichTextPhoneNumber | Text with a phone number |
| `"bank_card_number"` | RichTextBankCardNumber | Text with a bank card number |
| `"mention"` | RichTextMention | Mention by username |
| `"hashtag"` | RichTextHashtag | Hashtag |
| `"cashtag"` | RichTextCashtag | Cashtag |
| `"bot_command"` | RichTextBotCommand | Bot command |
| `"anchor"` | RichTextAnchor | Named anchor (no text content) |
| `"anchor_link"` | RichTextAnchorLink | Link to an anchor |
| `"reference"` | RichTextReference | Reference definition |
| `"reference_link"` | RichTextReferenceLink | Link to a reference |

#### RichTextBold

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"bold"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextItalic

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"italic"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextUnderline

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"underline"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextStrikethrough

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"strikethrough"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextSpoiler

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"spoiler"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextDateTime

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"date_time"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `unix_time` | Integer | **Yes** | Unix timestamp |
| `date_time_format` | String | **Yes** | Format string; see date-time entity formatting docs |

#### RichTextTextMention

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"text_mention"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `user` | User | **Yes** | The mentioned user |

#### RichTextSubscript

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"subscript"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextSuperscript

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"superscript"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextMarked

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"marked"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextCode

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"code"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The text |

#### RichTextCustomEmoji

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"custom_emoji"` | **Yes** | Discriminant |
| `custom_emoji_id` | String | **Yes** | Unique identifier of the custom emoji |
| `alternative_text` | String | **Yes** | Alternative emoji for the custom emoji |

#### RichTextMathematicalExpression

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"mathematical_expression"` | **Yes** | Discriminant |
| `expression` | String | **Yes** | The expression in LaTeX format |

#### RichTextUrl

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"url"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `url` | String | **Yes** | URL of the link |

#### RichTextEmailAddress

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"email_address"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `email_address` | String | **Yes** | The email address |

#### RichTextPhoneNumber

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"phone_number"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `phone_number` | String | **Yes** | The phone number |

#### RichTextBankCardNumber

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"bank_card_number"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `bank_card_number` | String | **Yes** | The bank card number |

#### RichTextMention

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"mention"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `username` | String | **Yes** | The username |

#### RichTextHashtag

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"hashtag"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `hashtag` | String | **Yes** | The hashtag |

#### RichTextCashtag

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"cashtag"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `cashtag` | String | **Yes** | The cashtag |

#### RichTextBotCommand

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"bot_command"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The display text |
| `bot_command` | String | **Yes** | The bot command |

#### RichTextAnchor

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"anchor"` | **Yes** | Discriminant |
| `name` | String | **Yes** | The name of the anchor |

#### RichTextAnchorLink

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"anchor_link"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The link text |
| `anchor_name` | String | **Yes** | The name of the anchor; empty string scrolls to top of message |

#### RichTextReference

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"reference"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the reference |
| `name` | String | **Yes** | The name of the reference |

#### RichTextReferenceLink

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"reference_link"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | The link text |
| `reference_name` | String | **Yes** | The name of the reference |

---

### `RichBlock`

This object represents a block in a rich formatted message. It can be any of:

| Variant type string | Interface |
|---|---|
| `"paragraph"` | RichBlockParagraph |
| `"heading"` | RichBlockSectionHeading |
| `"pre"` | RichBlockPreformatted |
| `"footer"` | RichBlockFooter |
| `"divider"` | RichBlockDivider |
| `"mathematical_expression"` | RichBlockMathematicalExpression |
| `"anchor"` | RichBlockAnchor |
| `"list"` | RichBlockList |
| `"blockquote"` | RichBlockBlockQuotation |
| `"pullquote"` | RichBlockPullQuotation |
| `"collage"` | RichBlockCollage |
| `"slideshow"` | RichBlockSlideshow |
| `"table"` | RichBlockTable |
| `"details"` | RichBlockDetails |
| `"map"` | RichBlockMap |
| `"animation"` | RichBlockAnimation |
| `"audio"` | RichBlockAudio |
| `"photo"` | RichBlockPhoto |
| `"video"` | RichBlockVideo |
| `"voice_note"` | RichBlockVoiceNote |
| `"thinking"` | RichBlockThinking |

#### RichBlockCaption

Caption of a rich formatted block.

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | RichText | **Yes** | Block caption |
| `credit` | RichText | Optional | Block credit (corresponds to HTML `<cite>` tag) |

#### RichBlockTableCell

Cell in a table.

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | RichText | Optional | Text in the cell; if omitted, the cell is invisible |
| `is_header` | true | Optional | True if the cell is a header cell |
| `colspan` | Integer | Optional | Number of columns the cell spans (if > 1) |
| `rowspan` | Integer | Optional | Number of rows the cell spans (if > 1) |
| `align` | String | AMBIGUOUS: required/optional not stated | Horizontal alignment: `"left"`, `"center"`, or `"right"` |
| `valign` | String | AMBIGUOUS: required/optional not stated | Vertical alignment: `"top"`, `"middle"`, or `"bottom"` |

#### RichBlockListItem

An item of a list.

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | String | **Yes** | Label of the item |
| `blocks` | Array of RichBlock | **Yes** | The content of the item |
| `has_checkbox` | true | Optional | True if the item has a checkbox |
| `is_checked` | true | Optional | True if the item has a checked checkbox |
| `value` | Integer | Optional | For ordered lists: the numeric value of the item label |
| `type` | String | Optional | For ordered lists: label type — `"a"` (lowercase), `"A"` (uppercase), `"i"` (lowercase Roman), `"I"` (uppercase Roman), `"1"` (decimal) |

#### RichBlockParagraph

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"paragraph"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block |

#### RichBlockSectionHeading

Corresponds to `<h1>`–`<h6>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"heading"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block |
| `size` | Integer | **Yes** | Relative font size: 1 (largest) – 6 (smallest) |

#### RichBlockPreformatted

Corresponds to `<pre><code>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"pre"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block |
| `language` | String | Optional | Programming language of the text |

#### RichBlockFooter

Corresponds to `<footer>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"footer"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block |

#### RichBlockDivider

Corresponds to `<hr/>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"divider"` | **Yes** | Discriminant |

#### RichBlockMathematicalExpression

Corresponds to `<tg-math-block>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"mathematical_expression"` | **Yes** | Discriminant |
| `expression` | String | **Yes** | The mathematical expression in LaTeX format |

#### RichBlockAnchor

Corresponds to `<a name="..."></a>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"anchor"` | **Yes** | Discriminant |
| `name` | String | **Yes** | The name of the anchor |

#### RichBlockList

Corresponds to `<ul>` or `<ol>` with nested `<li>` tags.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"list"` | **Yes** | Discriminant |
| `items` | Array of RichBlockListItem | **Yes** | Items of the list |

#### RichBlockBlockQuotation

Corresponds to `<blockquote>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"blockquote"` | **Yes** | Discriminant |
| `blocks` | Array of RichBlock | **Yes** | Content of the block |
| `credit` | RichText | Optional | Credit of the block |

#### RichBlockPullQuotation

Corresponds to `<aside>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"pullquote"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block |
| `credit` | RichText | Optional | Credit of the block |

#### RichBlockCollage

Corresponds to `<tg-collage>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"collage"` | **Yes** | Discriminant |
| `blocks` | Array of RichBlock | **Yes** | Elements of the collage |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockSlideshow

Corresponds to `<tg-slideshow>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"slideshow"` | **Yes** | Discriminant |
| `blocks` | Array of RichBlock | **Yes** | Elements of the slideshow |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockTable

Corresponds to `<table>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"table"` | **Yes** | Discriminant |
| `cells` | Array of Array of RichBlockTableCell | **Yes** | Cells of the table (row-major: cells[row][col]) |
| `is_bordered` | true | Optional | True if the table has borders |
| `is_striped` | true | Optional | True if the table is striped |
| `caption` | RichText | Optional | Caption of the table |

#### RichBlockDetails

Corresponds to `<details>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"details"` | **Yes** | Discriminant |
| `summary` | RichText | **Yes** | Always shown summary of the block |
| `blocks` | Array of RichBlock | **Yes** | Content of the block |
| `is_open` | true | Optional | True if the content of the block is visible by default |

#### RichBlockMap

Corresponds to `<tg-map>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"map"` | **Yes** | Discriminant |
| `location` | Location | **Yes** | Location of the center of the map |
| `zoom` | Integer | **Yes** | Map zoom level; 13–20 |
| `width` | Integer | **Yes** | Expected width of the map |
| `height` | Integer | **Yes** | Expected height of the map |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockAnimation

Corresponds to `<video>` (GIF animation).

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"animation"` | **Yes** | Discriminant |
| `animation` | Animation | **Yes** | The animation |
| `has_spoiler` | true | Optional | True if the media preview is covered by a spoiler animation |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockAudio

Corresponds to `<audio>` (music file).

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"audio"` | **Yes** | Discriminant |
| `audio` | Audio | **Yes** | The audio |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockPhoto

Corresponds to `<img>` / `<photo>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"photo"` | **Yes** | Discriminant |
| `photo` | Array of PhotoSize | **Yes** | Available sizes of the photo |
| `has_spoiler` | true | Optional | True if the media preview is covered by a spoiler animation |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockVideo

Corresponds to `<video>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"video"` | **Yes** | Discriminant |
| `video` | Video | **Yes** | The video |
| `has_spoiler` | true | Optional | True if the media preview is covered by a spoiler animation |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockVoiceNote

Corresponds to `<audio>` (voice note / ogg file).

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"voice_note"` | **Yes** | Discriminant |
| `voice_note` | Voice | **Yes** | The voice note |
| `caption` | RichBlockCaption | Optional | Caption of the block |

#### RichBlockThinking

Corresponds to `<tg-thinking>`. **Only valid in `sendRichMessageDraft`** — cannot be received in messages.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"thinking"` | **Yes** | Discriminant |
| `text` | RichText | **Yes** | Text of the block (custom emoji from https://t.me/addemoji/AIActions recommended) |

---

## Notes

- `RichBlockThinking` can only be used in `sendRichMessageDraft`; it cannot appear in received messages.
- `RichBlockTableCell.align` and `RichBlockTableCell.valign` — required/optional status not stated
  in the live docs; treated as optional here (AMBIGUOUS).
- The `grammY` package (`^1.43.0`) does not expose Bot API 10.1 types — do not source types from there.
- `sendRichMessageDraft` targets only private chats (`chat_id: Integer`, not `Integer or String`).
- `editMessageText` now accepts a `rich_message: InputRichMessage` parameter as an alternative to `text`.
