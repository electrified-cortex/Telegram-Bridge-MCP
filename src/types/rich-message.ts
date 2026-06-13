/**
 * Telegram Bot API 10.1 — Rich Message Type Definitions
 *
 * Source: https://core.telegram.org/bots/api
 * Verified: 2026-06-13
 *
 * This file is intentionally standalone — it imports nothing from grammY.
 * Minimal local stubs are defined for Telegram media/user objects that appear
 * as fields in rich block types. When grammY adds Bot API 10.1 support,
 * these stubs can be replaced with grammY imports.
 */

// ---------------------------------------------------------------------------
// Minimal stubs for referenced Telegram Bot API objects
// (kept here to avoid importing from grammY — replace once grammY supports 10.1)
// ---------------------------------------------------------------------------

/** Minimal stub for a Telegram User object. */
export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Minimal stub for a Telegram Location object. */
export interface TgLocation {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
}

/** Minimal stub for a Telegram PhotoSize object. */
export interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Minimal stub for a Telegram Animation object. */
export interface TgAnimation {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Minimal stub for a Telegram Audio object. */
export interface TgAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Minimal stub for a Telegram Video object. */
export interface TgVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Minimal stub for a Telegram Voice object. */
export interface TgVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

// ---------------------------------------------------------------------------
// RichText — inline formatting types
// ---------------------------------------------------------------------------

/**
 * Bold text.
 * HTML: <b>...</b> or <strong>...</strong>
 * Markdown: **...**
 */
export interface RichTextBold {
  type: "bold";
  /** The text */
  text: RichText;
}

/**
 * Italic text.
 * HTML: <i>...</i> or <em>...</em>
 * Markdown: *...* or _..._
 */
export interface RichTextItalic {
  type: "italic";
  /** The text */
  text: RichText;
}

/**
 * Underlined text.
 * HTML: <u>...</u> or <ins>...</ins>
 */
export interface RichTextUnderline {
  type: "underline";
  /** The text */
  text: RichText;
}

/**
 * Strikethrough text.
 * HTML: <s>...</s>, <strike>...</strike>, or <del>...</del>
 * Markdown: ~~...~~
 */
export interface RichTextStrikethrough {
  type: "strikethrough";
  /** The text */
  text: RichText;
}

/**
 * Text covered by a spoiler.
 * HTML: <tg-spoiler>...</tg-spoiler>
 * Markdown: ||...||
 */
export interface RichTextSpoiler {
  type: "spoiler";
  /** The text */
  text: RichText;
}

/**
 * Formatted date and time.
 * HTML: <tg-time unix="..." format="...">...</tg-time>
 * Markdown: ![display text](tg://time?unix=...&format=...)
 */
export interface RichTextDateTime {
  type: "date_time";
  /** The display text */
  text: RichText;
  /** The Unix timestamp associated with the entity */
  unix_time: number;
  /** Format string; see date-time entity formatting docs */
  date_time_format: string;
}

/**
 * A mention of a Telegram user by their identifier.
 * HTML: <a href="tg://user?id=...">...</a>
 * Markdown: [text](tg://user?id=...)
 */
export interface RichTextTextMention {
  type: "text_mention";
  /** The display text */
  text: RichText;
  /** The mentioned user */
  user: TgUser;
}

/**
 * Subscript text.
 * HTML: <sub>...</sub>
 */
export interface RichTextSubscript {
  type: "subscript";
  /** The text */
  text: RichText;
}

/**
 * Superscript text.
 * HTML: <sup>...</sup>
 */
export interface RichTextSuperscript {
  type: "superscript";
  /** The text */
  text: RichText;
}

/**
 * Marked (highlighted) text.
 * HTML: <mark>...</mark>
 * Markdown: ==...==
 */
export interface RichTextMarked {
  type: "marked";
  /** The text */
  text: RichText;
}

/**
 * Inline monowidth (code) text.
 * HTML: <code>...</code>
 * Markdown: `...`
 */
export interface RichTextCode {
  type: "code";
  /** The text */
  text: RichText;
}

/**
 * A custom emoji.
 * HTML: <tg-emoji emoji-id="..."> </tg-emoji>
 * Markdown: ![ ](tg://emoji?id=...)
 */
export interface RichTextCustomEmoji {
  type: "custom_emoji";
  /** Unique identifier of the custom emoji */
  custom_emoji_id: string;
  /** Alternative (fallback) emoji text */
  alternative_text: string;
}

/**
 * An inline mathematical expression in LaTeX format.
 * HTML: <tg-math>...</tg-math>
 * Markdown: $...$
 */
export interface RichTextMathematicalExpression {
  type: "mathematical_expression";
  /** The expression in LaTeX format */
  expression: string;
}

/**
 * Text with a hyperlink URL.
 * HTML: <a href="https://...">...</a>
 * Markdown: [text](https://...)
 */
export interface RichTextUrl {
  type: "url";
  /** The display text */
  text: RichText;
  /** URL of the link */
  url: string;
}

/**
 * Text with an email address link.
 * HTML: <a href="mailto:...">...</a>
 * Markdown: [text](mailto:...)
 */
export interface RichTextEmailAddress {
  type: "email_address";
  /** The display text */
  text: RichText;
  /** The email address */
  email_address: string;
}

/**
 * Text with a phone number link.
 * HTML: <a href="tel:...">...</a>
 * Markdown: [text](tel:...)
 */
export interface RichTextPhoneNumber {
  type: "phone_number";
  /** The display text */
  text: RichText;
  /** The phone number */
  phone_number: string;
}

/**
 * Text with a bank card number (auto-detected).
 */
export interface RichTextBankCardNumber {
  type: "bank_card_number";
  /** The display text */
  text: RichText;
  /** The bank card number */
  bank_card_number: string;
}

/**
 * A username mention (auto-detected @username).
 */
export interface RichTextMention {
  type: "mention";
  /** The display text */
  text: RichText;
  /** The username (without @) */
  username: string;
}

/**
 * A hashtag (auto-detected #hashtag).
 */
export interface RichTextHashtag {
  type: "hashtag";
  /** The display text */
  text: RichText;
  /** The hashtag (without #) */
  hashtag: string;
}

/**
 * A cashtag (auto-detected $USD).
 */
export interface RichTextCashtag {
  type: "cashtag";
  /** The display text */
  text: RichText;
  /** The cashtag (without $) */
  cashtag: string;
}

/**
 * A bot command (auto-detected /command).
 */
export interface RichTextBotCommand {
  type: "bot_command";
  /** The display text */
  text: RichText;
  /** The bot command */
  bot_command: string;
}

/**
 * A named anchor (link destination, no visual text).
 * HTML: <a name="..."></a>
 * Markdown: (no native syntax; use HTML inside Markdown)
 */
export interface RichTextAnchor {
  type: "anchor";
  /** The name of the anchor */
  name: string;
}

/**
 * A link to an in-document anchor.
 * HTML: <a href="#chapter-1">...</a>
 * Markdown: [text](#anchor-name)
 */
export interface RichTextAnchorLink {
  type: "anchor_link";
  /** The link text */
  text: RichText;
  /** The name of the anchor; empty string scrolls back to the top of the message */
  anchor_name: string;
}

/**
 * A reference definition (footnote target).
 * HTML: <tg-reference name="note-1">...</tg-reference>
 */
export interface RichTextReference {
  type: "reference";
  /** Text of the reference */
  text: RichText;
  /** The name of the reference */
  name: string;
}

/**
 * A link to a reference (footnote back-link).
 * HTML: <a href="#note-1">...</a>
 * Markdown: [^id]
 */
export interface RichTextReferenceLink {
  type: "reference_link";
  /** The link text */
  text: RichText;
  /** The name of the reference */
  reference_name: string;
}

/**
 * Union of all typed RichText variants (object forms).
 * The full RichText type also includes plain strings and arrays — see `RichText` below.
 */
export type RichTextTyped =
  | RichTextBold
  | RichTextItalic
  | RichTextUnderline
  | RichTextStrikethrough
  | RichTextSpoiler
  | RichTextDateTime
  | RichTextTextMention
  | RichTextSubscript
  | RichTextSuperscript
  | RichTextMarked
  | RichTextCode
  | RichTextCustomEmoji
  | RichTextMathematicalExpression
  | RichTextUrl
  | RichTextEmailAddress
  | RichTextPhoneNumber
  | RichTextBankCardNumber
  | RichTextMention
  | RichTextHashtag
  | RichTextCashtag
  | RichTextBotCommand
  | RichTextAnchor
  | RichTextAnchorLink
  | RichTextReference
  | RichTextReferenceLink;

/**
 * Rich formatted text node.
 *
 * A RichText value can be:
 * - A plain `string` (plain text)
 * - An `Array<RichText>` (concatenation of nodes)
 * - Any typed inline variant (RichTextBold, RichTextItalic, etc.)
 */
export type RichText = string | RichText[] | RichTextTyped;

// ---------------------------------------------------------------------------
// RichBlock — structural block types
// ---------------------------------------------------------------------------

/**
 * Caption for a rich block (used in media and layout blocks).
 */
export interface RichBlockCaption {
  /** Block caption text */
  text: RichText;
  /**
   * Optional credit (corresponds to HTML <cite> inside <figcaption>).
   */
  credit?: RichText;
}

/**
 * A cell in a table.
 *
 * Note: `align` and `valign` required/optional status is not explicitly stated
 * in the live API docs (AMBIGUOUS — treated as optional here).
 */
export interface RichBlockTableCell {
  /** Text in the cell; if omitted, the cell is invisible */
  text?: RichText;
  /** True if the cell is a header cell */
  is_header?: true;
  /** Number of columns the cell spans (omit if 1) */
  colspan?: number;
  /** Number of rows the cell spans (omit if 1) */
  rowspan?: number;
  /**
   * Horizontal content alignment.
   * AMBIGUOUS: required/optional not stated in live docs.
   * Values: "left" | "center" | "right"
   */
  align?: "left" | "center" | "right";
  /**
   * Vertical content alignment.
   * AMBIGUOUS: required/optional not stated in live docs.
   * Values: "top" | "middle" | "bottom"
   */
  valign?: "top" | "middle" | "bottom";
}

/**
 * An item in a list (ordered or unordered).
 */
export interface RichBlockListItem {
  /** Label of the item (the bullet character or number string) */
  label: string;
  /** The content blocks of the item */
  blocks: RichBlock[];
  /** True if the item has a checkbox */
  has_checkbox?: true;
  /** True if the item has a checked checkbox */
  is_checked?: true;
  /** For ordered lists: the numeric value of the item label */
  value?: number;
  /**
   * For ordered lists: the type of the item label.
   * "a" = lowercase letters, "A" = uppercase letters,
   * "i" = lowercase Roman numerals, "I" = uppercase Roman numerals,
   * "1" = decimal numbers.
   */
  type?: "a" | "A" | "i" | "I" | "1";
}

// --- Phase 1–3 structural blocks (concrete) ---

/**
 * A text paragraph.
 * HTML: <p>...</p>
 * Markdown: plain paragraph text
 */
export interface RichBlockParagraph {
  type: "paragraph";
  /** Text of the block */
  text: RichText;
}

/**
 * A section heading.
 * HTML: <h1>–<h6>
 * Markdown: # ... through ###### ...
 */
export interface RichBlockSectionHeading {
  type: "heading";
  /** Text of the block */
  text: RichText;
  /** Relative font size: 1 (largest, <h1>) through 6 (smallest, <h6>) */
  size: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * A preformatted (code block) text block.
 * HTML: <pre><code class="language-...">...</code></pre>
 * Markdown: ```lang\n...\n```
 */
export interface RichBlockPreformatted {
  type: "pre";
  /** Text of the block */
  text: RichText;
  /** Programming language of the text (optional) */
  language?: string;
}

/**
 * A footer block.
 * HTML: <footer>...</footer>
 */
export interface RichBlockFooter {
  type: "footer";
  /** Text of the block */
  text: RichText;
}

/**
 * A horizontal divider.
 * HTML: <hr/>
 * Markdown: ---
 */
export interface RichBlockDivider {
  type: "divider";
}

/**
 * A block-level mathematical expression in LaTeX format.
 * HTML: <tg-math-block>...</tg-math-block>
 * Markdown: $$...$$ or ```math\n...\n```
 */
export interface RichBlockMathematicalExpression {
  type: "mathematical_expression";
  /** The expression in LaTeX format */
  expression: string;
}

/**
 * A named anchor block.
 * HTML: <a name="..."></a>
 */
export interface RichBlockAnchor {
  type: "anchor";
  /** The name of the anchor */
  name: string;
}

/**
 * A list of items (ordered or unordered).
 * HTML: <ul><li>...</li></ul> or <ol><li>...</li></ol>
 * Markdown: - item or 1. item
 */
export interface RichBlockList {
  type: "list";
  /** The list items */
  items: RichBlockListItem[];
}

/**
 * A block quotation.
 * HTML: <blockquote>...</blockquote>
 * Markdown: >...
 */
export interface RichBlockBlockQuotation {
  type: "blockquote";
  /** Content blocks of the quotation */
  blocks: RichBlock[];
  /** Optional credit / attribution */
  credit?: RichText;
}

/**
 * A pull quotation (centered quote).
 * HTML: <aside>...</aside>
 */
export interface RichBlockPullQuotation {
  type: "pullquote";
  /** Text of the block */
  text: RichText;
  /** Optional credit / attribution */
  credit?: RichText;
}

/**
 * A table.
 * HTML: <table>...</table>
 */
export interface RichBlockTable {
  type: "table";
  /**
   * Table cells in row-major order: cells[rowIndex][colIndex].
   */
  cells: RichBlockTableCell[][];
  /** True if the table has borders */
  is_bordered?: true;
  /** True if the table is striped (alternating row colors) */
  is_striped?: true;
  /** Caption of the table */
  caption?: RichText;
}

/**
 * An expandable details/disclosure block.
 * HTML: <details [open]><summary>...</summary>...</details>
 * Markdown: <details open><summary>...</summary>...</details>
 */
export interface RichBlockDetails {
  type: "details";
  /** Always-visible summary text */
  summary: RichText;
  /** Content blocks (shown/hidden based on is_open) */
  blocks: RichBlock[];
  /** True if the content is expanded by default */
  is_open?: true;
}

// --- Media blocks (concrete — full schema confirmed in live docs) ---

/**
 * A collage of media items.
 * HTML: <tg-collage>...</tg-collage>
 * Markdown: <tg-collage>\n![](url)\n</tg-collage>
 */
export interface RichBlockCollage {
  type: "collage";
  /** Elements of the collage (media blocks) */
  blocks: RichBlock[];
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A slideshow of media items.
 * HTML: <tg-slideshow>...</tg-slideshow>
 */
export interface RichBlockSlideshow {
  type: "slideshow";
  /** Elements of the slideshow (media blocks) */
  blocks: RichBlock[];
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A GIF animation block.
 * HTML: <video src="...animation.gif"></video>
 * Markdown: ![](url) with a .gif URL
 */
export interface RichBlockAnimation {
  type: "animation";
  /** The animation object */
  animation: TgAnimation;
  /** True if the preview is covered by a spoiler animation */
  has_spoiler?: true;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A music audio file block.
 * HTML: <audio src="...audio.mp3"></audio>
 * Markdown: ![](url) with an audio URL
 */
export interface RichBlockAudio {
  type: "audio";
  /** The audio object */
  audio: TgAudio;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A photo block.
 * HTML: <img src="..."/> or <figure><img .../><figcaption>...</figcaption></figure>
 * Markdown: ![](url) with a photo URL
 */
export interface RichBlockPhoto {
  type: "photo";
  /** Available sizes of the photo */
  photo: TgPhotoSize[];
  /** True if the preview is covered by a spoiler animation */
  has_spoiler?: true;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A video block.
 * HTML: <video src="...video.mp4"></video>
 * Markdown: ![](url) with a video URL
 */
export interface RichBlockVideo {
  type: "video";
  /** The video object */
  video: TgVideo;
  /** True if the preview is covered by a spoiler animation */
  has_spoiler?: true;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A voice note block.
 * HTML: <audio src="...audio.ogg"></audio>
 * Markdown: ![](url) with an .ogg URL
 */
export interface RichBlockVoiceNote {
  type: "voice_note";
  /** The voice note object */
  voice_note: TgVoice;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A map block.
 * HTML: <tg-map lat="..." long="..." zoom="..."/>
 */
export interface RichBlockMap {
  type: "map";
  /** Location of the center of the map */
  location: TgLocation;
  /** Map zoom level; 13–20 */
  zoom: number;
  /** Expected width of the map (pixels) */
  width: number;
  /** Expected height of the map (pixels) */
  height: number;
  /** Optional caption */
  caption?: RichBlockCaption;
}

/**
 * A "Thinking…" placeholder block used during AI streaming.
 * Only valid in `sendRichMessageDraft` — cannot be received in messages.
 * HTML: <tg-thinking>...</tg-thinking>
 * See https://t.me/addemoji/AIActions for recommended custom emoji.
 */
export interface RichBlockThinking {
  type: "thinking";
  /** Text of the block (custom emoji recommended) */
  text: RichText;
}

/**
 * Union of all RichBlock types.
 */
export type RichBlock =
  | RichBlockParagraph
  | RichBlockSectionHeading
  | RichBlockPreformatted
  | RichBlockFooter
  | RichBlockDivider
  | RichBlockMathematicalExpression
  | RichBlockAnchor
  | RichBlockList
  | RichBlockBlockQuotation
  | RichBlockPullQuotation
  | RichBlockCollage
  | RichBlockSlideshow
  | RichBlockTable
  | RichBlockDetails
  | RichBlockMap
  | RichBlockAnimation
  | RichBlockAudio
  | RichBlockPhoto
  | RichBlockVideo
  | RichBlockVoiceNote
  | RichBlockThinking;

// ---------------------------------------------------------------------------
// Top-level message types
// ---------------------------------------------------------------------------

/**
 * A rich formatted message (as received in Message.rich_message).
 */
export interface RichMessage {
  /** Content blocks of the message */
  blocks: RichBlock[];
  /** True if the rich message must be shown right-to-left */
  is_rtl?: boolean;
}

/**
 * Describes a rich message to be sent.
 * Exactly **one** of `html` or `markdown` must be provided.
 */
export interface InputRichMessage {
  /**
   * Content described using HTML formatting.
   * Exactly one of html / markdown must be set.
   */
  html?: string;
  /**
   * Content described using Markdown formatting.
   * Exactly one of html / markdown must be set.
   */
  markdown?: string;
  /** Pass true if the rich message must be shown right-to-left */
  is_rtl?: boolean;
  /**
   * Pass true to skip automatic detection of plain-text entities
   * (URLs, email addresses, username mentions, hashtags, cashtags,
   *  bot commands, phone numbers, bank card numbers).
   */
  skip_entity_detection?: boolean;
}

/**
 * Content of a rich message for use as InputMessageContent in inline,
 * guest, and Web App query results.
 */
export interface InputRichMessageContent {
  /** The rich message to be sent */
  rich_message: InputRichMessage;
}

// ---------------------------------------------------------------------------
// Method parameter shapes
// ---------------------------------------------------------------------------

/**
 * Parameters for the `sendRichMessage` Bot API method.
 * Returns: Message (the sent message) on success.
 */
export interface SendRichMessageParams {
  /** Unique identifier of the business connection on behalf of which the message will be sent */
  business_connection_id?: string;
  /** Unique identifier for the target chat or @username */
  chat_id: number | string;
  /** Unique identifier for the target message thread (topic), for forum supergroups */
  message_thread_id?: number;
  /** Identifier of the direct messages topic; required for direct message chats */
  direct_messages_topic_id?: number;
  /** The message to be sent */
  rich_message: InputRichMessage;
  /** Send silently (users receive a notification with no sound) */
  disable_notification?: boolean;
  /** Protect the contents from forwarding and saving */
  protect_content?: boolean;
  /**
   * Pass true to allow up to 1000 messages/second, bypassing broadcast limits
   * for a fee of 0.1 Telegram Stars per message.
   */
  allow_paid_broadcast?: boolean;
  /** Unique identifier of the message effect; for private chats only */
  message_effect_id?: string;
  /** Parameters of the suggested post; for direct messages chats only */
  suggested_post_parameters?: Record<string, unknown>;
  /** Description of the message to reply to */
  reply_parameters?: Record<string, unknown>;
  /** Inline keyboard, reply keyboard, remove-keyboard, or force-reply markup */
  reply_markup?: Record<string, unknown>;
}

/**
 * Parameters for the `sendRichMessageDraft` Bot API method.
 * Streams an ephemeral partial rich message (30-second preview).
 * Must be followed by `sendRichMessage` to persist the final message.
 * Returns: True on success.
 */
export interface SendRichMessageDraftParams {
  /** Unique identifier for the target **private** chat */
  chat_id: number;
  /** Unique identifier for the target message thread */
  message_thread_id?: number;
  /**
   * Unique identifier of the message draft; must be non-zero.
   * Changes to drafts with the same identifier are animated.
   */
  draft_id: number;
  /** The partial message to be streamed */
  rich_message: InputRichMessage;
}
