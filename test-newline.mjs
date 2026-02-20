import { markdownToV2 } from "./dist/markdown.js";

const body = "Line one.\n\nLine two.\n\n**Bold section** — detail here.\n\nLine three.";
const result = markdownToV2(body.trim());
console.log("JSON repr:", JSON.stringify(result));
console.log("---rendered---");
console.log(result);
