import { describe, it, expect, beforeEach } from "vitest";
import {
  getTopic,
  setTopic,
  clearTopic,
  applyTopicToTitle,
  applyTopicToText,
  resetTopicStateForTest,
} from "./topic-state.js";

describe("topic-state", () => {
  beforeEach(() => { resetTopicStateForTest(); });

  describe("getTopic / setTopic / clearTopic", () => {
    it("returns null initially", () => {
      expect(getTopic()).toBeNull();
    });

    it("sets and gets a topic", () => {
      setTopic("Refactor Agent");
      expect(getTopic()).toBe("Refactor Agent");
    });

    it("trims whitespace when setting", () => {
      setTopic("  trimmed  ");
      expect(getTopic()).toBe("trimmed");
    });

    it("treats empty string as null", () => {
      setTopic("something");
      setTopic("");
      expect(getTopic()).toBeNull();
    });

    it("clears the topic", () => {
      setTopic("Test Runner");
      clearTopic();
      expect(getTopic()).toBeNull();
    });
  });

  describe("applyTopicToTitle", () => {
    it("returns title unchanged when no topic", () => {
      expect(applyTopicToTitle("My Title")).toBe("My Title");
    });

    it("prepends topic label to title", () => {
      setTopic("Agent");
      expect(applyTopicToTitle("My Title")).toBe("[Agent] My Title");
    });
  });

  describe("applyTopicToText", () => {
    it("returns text unchanged when no topic", () => {
      expect(applyTopicToText("hello")).toBe("hello");
    });

    it("prepends Markdown bold header by default", () => {
      setTopic("Bot");
      expect(applyTopicToText("body")).toBe("**[Bot]**\nbody");
    });

    it("prepends HTML bold header in HTML mode", () => {
      setTopic("Bot");
      expect(applyTopicToText("body", "HTML")).toBe("<b>[Bot]</b>\nbody");
    });

    it("does not inject in MarkdownV2 mode", () => {
      setTopic("Bot");
      expect(applyTopicToText("raw v2 text", "MarkdownV2")).toBe("raw v2 text");
    });
  });
});
