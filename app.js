/*
 * NBME / USMLE Exam Simulator — static, client-side web app.
 * Everything runs in the browser: PDF parsing (pdf.js), scoring, timer,
 * and optional AI calls made directly from the browser to Anthropic/OpenAI.
 */
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const { OPS } = pdfjsLib;
// 2-D affine matrix helpers [a,b,c,d,e,f] (own copies: pdf.js changed its helpers across versions)
const mulM = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
const applyM = ([x, y], m) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

const LETTERS = "ABCDEFGH";
const DEFAULT_MODELS = { Anthropic: "claude-sonnet-4-5", OpenAI: "gpt-4o" };
const MAX_IMAGES_TO_LLM = 4;
const AI_WORKERS = 4;
const STATE_KEY = "nbme_sim_state_v1";
const SETTINGS_KEY = "nbme_sim_settings_v1";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Vignette text -> HTML: paragraphs on blank lines, <br> on single newlines. */
function textToHtml(text) {
  return String(text || "").split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Tiny, safe markdown for AI output: **bold**, *italic*, `code`, - lists, paragraphs. */
function md(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = [];
  let list = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { (list ||= []).push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function hashBytes(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = Object.assign(document.createElement("script"), { src, async: true });
    s.onload = res; s.onerror = () => rej(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF extraction (pdf.js)
// ─────────────────────────────────────────────────────────────────────────────
/** Group pdf.js text items into visual lines with their vertical position. */
function itemsToLines(items, vp, pageIdx) {
  const pts = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const h = Math.abs(it.height || it.transform[3] || 10);
    pts.push({ x, y, h, w: it.width || 0, s: it.str });
  }
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const p of pts) {
    const row = rows.find((r) => Math.abs(r.y - p.y) < Math.max(2, 0.5 * Math.min(r.h, p.h)));
    if (row) row.items.push(p); else rows.push({ y: p.y, h: p.h, items: [p] });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = "", end = null;
    for (const it of r.items) {
      if (end !== null && it.x - end > 1.5 && !text.endsWith(" ") && !it.s.startsWith(" ")) text += " ";
      text += it.s; end = it.x + it.w;
    }
    return { page: pageIdx, top: r.y - r.h, text: text.replace(/\s+/g, " ").trim() };
  }).filter((l) => l.text);
}

/** Find bounding boxes of images drawn on the page by walking the operator list. */
async function findImageBoxes(page, vp) {
  const ops = await page.getOperatorList();
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const imgOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup].filter((v) => v !== undefined));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mulM(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mulM(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (imgOps.has(fn)) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => vp.convertToViewportPoint(...applyM(p, ctm)));
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(vp.width, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(vp.height, Math.max(...ys));
      const w = x1 - x0, h = y1 - y0;
      if (w < 40 || h < 40 || w * h > 0.85 * vp.width * vp.height) continue; // icons / full-page scans
      boxes.push({ x0, y0, w, h, sig: [x0, y0, w, h].map(Math.round).join(",") });
    }
  }
  return boxes;
}

async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

function cropCanvas(src, box, scale) {
  const c = document.createElement("canvas");
  c.width = Math.round(box.w * scale); c.height = Math.round(box.h * scale);
  c.getContext("2d").drawImage(src, box.x0 * scale, box.y0 * scale, box.w * scale, box.h * scale, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

async function ocrPdf(pdf, onProgress) {
  await loadScript(TESSERACT_URL);
  const worker = await window.Tesseract.createWorker("eng");
  const lines = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.(`OCR page ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const canvas = await renderPage(page, 2.5);
      const { data } = await worker.recognize(canvas);
      String(data.text || "").split("\n").forEach((t, i) => { if (t.trim()) lines.push({ page: p - 1, top: i * 14, text: t.trim() }); });
    }
  } finally { await worker.terminate(); }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Question parsing (layout lines -> items)
// ─────────────────────────────────────────────────────────────────────────────
const Q_ITEM_RE = /^\s*(?:exam\s+section\s+\d+\s*:\s*)?item\s+(\d{1,3})\s+of\s+\d{1,3}\b[:.\s]*(.*)$/i;
const Q_WORD_RE = /^\s*(?:question|q)\s*#?\s*(\d{1,3})\s*[.):\-]?\s*(.*)$/i;
const Q_NUM_RE = /^\s*(\d{1,3})\s*[.)]\s+(\S.*)$/;
const OPT_RE = /^\s*[○●◯•◦□■\-–]?\s*\(?([A-H])\s*[.)]\s+(\S.*)$/;
const ANS_RE = /^\s*(?:correct\s+answer|answer(?:\s+key)?|key)\s*(?:is)?\s*[:\-]?\s*\(?([A-H])\b/i;
const EXPL_RE = /^\s*(?:explanation|educational\s+objective|rationale)\b/i;
const FOOTER_RE = /^\s*(?:page\s*\d+(?:\s*of\s*\d+)?|\d+\s*\/\s*\d+|\d{1,3}|copyright\b.*|©.*)\s*$/i;
const UI_CHROME_RE = /^\s*(?:mark|previous|next|lab values|calculator|notes|end block|question id\s*:?.*|block time (?:elapsed|remaining).*|time remaining.*)\s*$/i;

function matchQuestionStart(text, lastNum, curHasOptions) {
  for (const rx of [Q_ITEM_RE, Q_WORD_RE]) {
    const m = text.match(rx);
    if (m) return { num: +m[1], rest: (m[2] || "").trim() };
  }
  const m = text.match(Q_NUM_RE);
  if (m) {
    const n = +m[1];
    // A bare "12." only starts a question when numbering is sequential AND the current
    // item already has options, so numbered lists inside a vignette stay in the vignette.
    if ((lastNum === 0 && n <= 5) || (n === lastNum + 1 && curHasOptions)) return { num: n, rest: m[2].trim() };
  }
  return null;
}

/** "A. foo B. bar C. baz" on one line -> [[A,foo],[B,bar],[C,baz]] */
function splitInlineOptions(letter, text) {
  const out = [];
  let cur = letter, rest = text;
  while (cur !== "H") {
    const nxt = LETTERS[LETTERS.indexOf(cur) + 1];
    const m = rest.match(new RegExp(`\\s+\\(?${nxt}\\s*[.)]\\s+`));
    if (!m) break;
    out.push([cur, rest.slice(0, m.index).trim()]);
    cur = nxt; rest = rest.slice(m.index + m[0].length);
  }
  out.push([cur, rest.trim()]);
  return out;
}

async function parseExamPdf(buffer, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const nPages = pdf.numPages;
  let lines = [];
  const rawImages = [];
  const warnings = [];
  let usedOcr = false;

  for (let p = 1; p <= nPages; p++) {
    onProgress?.(`Reading page ${p}/${nPages}…`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    lines.push(...itemsToLines(tc.items, vp, p - 1));
    try {
      for (const b of await findImageBoxes(page, vp)) rawImages.push({ ...b, page: p - 1 });
    } catch (e) { console.warn("image scan failed on page", p, e); }
  }

  // Scanned document? Try OCR.
  if (lines.reduce((n, l) => n + l.text.length, 0) < 40 * Math.max(1, nPages)) {
    try {
      lines = await ocrPdf(pdf, onProgress);
      usedOcr = true;
      rawImages.length = 0;
    } catch (e) {
      warnings.push("Very little text found — this PDF looks scanned, and OCR could not run (" + e.message + ").");
    }
  }

  // Drop repeating logos (same position on >= 50% of pages), then crop the rest.
  const sigCount = {};
  rawImages.forEach((im) => (sigCount[im.sig] = (sigCount[im.sig] || 0) + 1));
  const keep = rawImages.filter((im) => !(nPages >= 3 && sigCount[im.sig] >= 0.5 * nPages));
  const images = [];
  const SCALE = 2;
  for (const pg of [...new Set(keep.map((im) => im.page))]) {
    onProgress?.(`Extracting images on page ${pg + 1}…`);
    const canvas = await renderPage(await pdf.getPage(pg + 1), SCALE);
    for (const im of keep.filter((k) => k.page === pg)) images.push({ page: pg, top: im.y0, src: cropCanvas(canvas, im, SCALE) });
  }

  // Running headers/footers: same (digit-normalised) text on most pages.
  const norm = (t) => t.trim().toLowerCase().replace(/\d+/g, "#");
  const repeated = new Set();
  if (nPages >= 3) {
    const pagesFor = {};
    lines.forEach((l) => { (pagesFor[norm(l.text)] ||= new Set()).add(l.page); });
    for (const [k, s] of Object.entries(pagesFor)) if (s.size >= 0.6 * nPages && k.length < 120) repeated.add(k);
  }

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (a.page === b.page && b.top - a.top > 0 && b.top - a.top < 60) gaps.push(b.top - a.top);
  }
  const lineH = median(gaps) || 14;

  const questions = [];
  let cur = null, mode = "stem", lastNum = 0, prev = null;

  const addText = (q, text, page, top) => {
    if (q.stem) {
      let sep = " ";
      if (prev && prev.page === page && top - prev.top > 1.6 * lineH) sep = "\n\n";
      else if (prev && prev.text.length < 55) sep = "\n"; // short line -> intentional break (lab tables)
      q.stem += sep + text;
    } else q.stem = text;
    prev = { page, top, text };
  };

  for (const { page, top, text } of lines) {
    const t = text.trim();
    if (!t) continue;
    const qs = matchQuestionStart(t, lastNum, !!(cur && Object.keys(cur.options).length >= 2));
    if (!qs && (repeated.has(norm(t)) || FOOTER_RE.test(t) || UI_CHROME_RE.test(t))) continue;
    if (qs) {
      cur = { num: qs.num, stem: "", options: {}, images: [], key: null, srcExpl: "", start: [page, top] };
      questions.push(cur);
      lastNum = qs.num; mode = "stem"; prev = null;
      if (qs.rest) addText(cur, qs.rest, page, top);
      continue;
    }
    if (!cur) continue; // cover page / instructions

    const am = t.match(ANS_RE);
    if (am && (mode === "opts" || mode === "expl")) { cur.key = am[1].toUpperCase(); mode = "expl"; continue; }
    if (EXPL_RE.test(t) && (mode === "opts" || mode === "expl")) { mode = "expl"; cur.srcExpl += t + "\n"; continue; }
    if (mode === "expl") { cur.srcExpl += t + "\n"; continue; }

    const om = t.match(OPT_RE);
    const nOpts = Object.keys(cur.options).length;
    const expected = nOpts < LETTERS.length ? LETTERS[nOpts] : null;
    if (om && om[1] === expected) {
      for (const [L, txt] of splitInlineOptions(om[1], om[2])) cur.options[L] = txt;
      mode = "opts";
      continue;
    }
    if (mode === "opts") {
      const last = Object.keys(cur.options).at(-1);
      cur.options[last] += " " + t;
    } else addText(cur, t, page, top);
  }

  // Attach each image to the question whose text it falls under.
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  for (const im of images) {
    let owner = null;
    for (const q of questions) { if (before(q.start, [im.page, im.top])) owner = q; else break; }
    (owner || questions[0])?.images.push(im.src);
  }

  const seen = new Set(), uniq = [];
  for (const q of questions) {
    if (seen.has(q.num)) continue;
    seen.add(q.num);
    q.stem = q.stem.trim(); q.srcExpl = q.srcExpl.trim(); delete q.start;
    uniq.push(q);
  }
  const bad = uniq.filter((q) => Object.keys(q.options).length < 2).map((q) => q.num);
  if (bad.length) warnings.push(`${bad.length} item(s) have fewer than 2 detected options: ${bad.slice(0, 15).join(", ")}${bad.length > 15 ? "…" : ""}`);
  if (!uniq.length) warnings.push("No questions detected. Items should start with “1.”, “Question 1” or “Item 1 of 40”, and options with “A.”, “A)” or “(A)”.");
  return { questions: uniq, warnings, pages: nPages, ocr: usedOcr };
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer key parsing
// ─────────────────────────────────────────────────────────────────────────────
const KEY_PAIR_RE = /(?:^|[\s,;|])(?:q(?:uestion)?\s*#?\s*)?(\d{1,3})\s*[.):\-=,|]?\s*\(?([A-Ha-h])\)?(?=$|[\s,;|.])/gm;

async function parseAnswerKey(file) {
  const ext = file.name.toLowerCase().split(".").pop();
  let text;
  if (ext === "pdf") {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const parts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      parts.push(itemsToLines((await page.getTextContent()).items, page.getViewport({ scale: 1 }), p).map((l) => l.text).join("\n"));
    }
    text = parts.join("\n");
  } else text = (await file.text()).replace(/^﻿/, "");

  const key = {};
  const put = (n, a) => { a = String(a || "").trim().toUpperCase()[0]; if (n && a && LETTERS.includes(a)) key[+n] = a; };

  if (ext === "json") {
    let obj = JSON.parse(text);
    if (obj && !Array.isArray(obj) && obj.answers) obj = obj.answers;
    if (Array.isArray(obj)) obj.forEach((it, i) => {
      if (it && typeof it === "object") put(it.question ?? it.q ?? it.number ?? i + 1, it.answer ?? it.key ?? it.correct);
      else put(i + 1, it);
    });
    else for (const [k, v] of Object.entries(obj || {})) if (/^\d+$/.test(k.trim())) put(k, v);
    return key;
  }
  if (ext === "csv") {
    for (const row of text.split(/\r?\n/)) {
      const cells = row.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);
      const num = cells.find((c) => /^\d+$/.test(c));
      const ans = cells.find((c) => c.length === 1 && LETTERS.includes(c.toUpperCase()));
      if (num && ans) put(num, ans);
    }
    if (Object.keys(key).length) return key;
  }
  for (const m of text.matchAll(KEY_PAIR_RE)) put(m[1], m[2]);
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI solver / explainer (direct browser -> provider)
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a board-certified physician and senior NBME item writer who tutors students for USMLE Step 1, Step 2 CK and Step 3.

Solve the multiple-choice item you are given and teach it. Reason carefully through the vignette (demographics, timeline, vitals, exam, labs, imaging) before committing to an answer.

Return ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "answer": "<single capital letter>",
  "confidence": "high" | "medium" | "low",
  "topic": "<system / discipline / tested concept>",
  "explanation": "<why the correct answer is correct: key clues -> diagnosis -> mechanism -> answer; markdown allowed>",
  "choices": {"A": "<why wrong (or why right) + a one-sentence vignette in which this choice WOULD be the answer>", "B": "..."},
  "pearls": ["<high-yield NBME/USMLE pearl>", "..."],
  "educational_objective": "<one sentence>"
}
Include every option letter present in the item in "choices".`;

function buildPrompt(q, official) {
  const opts = Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join("\n");
  let p = `Item ${q.num}\n\n${q.stem}\n\n${opts}\n`;
  if (q.images.length) p += `\n(${q.images.length} image(s) from this item are attached.)\n`;
  if (official) p += `\nThe official answer key says the correct answer is ${official}. Treat it as correct and explain accordingly; set "answer" to "${official}".\n`;
  return p;
}

function looseJson(raw) {
  const s = String(raw).replace(/```(?:json)?/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("Model did not return JSON");
  return JSON.parse(s.slice(a, b + 1));
}

async function apiError(res) {
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg += ": " + (j.error?.message || j.message || JSON.stringify(j).slice(0, 200)); } catch { /* ignore */ }
  if (res.status === 401) msg += " — check your API key.";
  if (res.status === 404) msg += " — check the model name.";
  return new Error(msg);
}

async function callLLM(q, official) {
  const { provider, apiKey, model } = settings;
  const prompt = buildPrompt(q, official);
  const imgs = q.images.slice(0, MAX_IMAGES_TO_LLM);
  let raw;
  if (provider === "Anthropic") {
    const content = imgs.map((src) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: src.split(",")[1] } }));
    content.push({ type: "text", text: prompt });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 3000, system: SYSTEM_PROMPT, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    raw = (j.content || []).map((b) => b.text || "").join("");
  } else {
    const content = [{ type: "text", text: prompt }, ...imgs.map((src) => ({ type: "image_url", image_url: { url: src } }))];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    raw = j.choices?.[0]?.message?.content || "";
  }
  const data = looseJson(raw);
  let ans = String(data.answer || "").trim().toUpperCase().slice(0, 1);
  if (official) ans = official;
  if (Object.keys(q.options).length && !(ans in q.options)) throw new Error(`Model answered "${ans}", which is not an option`);
  return { ...data, answer: ans, usedKey: !!official, choices: data.choices || {}, pearls: data.pearls || [] };
}

const aiReady = () => !!(settings.aiEnabled && settings.apiKey && settings.model && settings.provider);

async function runAiBatch(qs, label, progressEl) {
  const todo = qs.filter((q) => !S.ai[q.num]);
  let done = 0;
  const update = () => {
    if (!progressEl) return;
    progressEl.innerHTML = `<p class="small">${esc(label)} ${done}/${todo.length}</p><div class="progress"><div style="width:${todo.length ? (100 * done) / todo.length : 100}%"></div></div>`;
  };
  update();
  const queue = [...todo];
  const workers = Array.from({ length: Math.min(AI_WORKERS, queue.length) }, async () => {
    while (queue.length) {
      const q = queue.shift();
      try { S.ai[q.num] = await callLLM(q, S.key[q.num]); delete S.aiErr[q.num]; }
      catch (e) { S.aiErr[q.num] = e.message; }
      done++; update(); save();
    }
  });
  await Promise.all(workers);
}

// ─────────────────────────────────────────────────────────────────────────────
// State + persistence
// ─────────────────────────────────────────────────────────────────────────────
const blank = () => ({
  stage: "setup", examHash: null, examName: "", questions: [], key: {}, blockNums: [],
  answers: {}, marked: [], revealed: [], idx: 0, mode: "Timed test",
  durationS: 0, elapsedAccum: 0, segStart: 0, lastTick: 0, endTs: null,
  qtime: {}, navTs: 0, ai: {}, aiErr: {}, autoEnded: false, confirmEnd: false,
  reviewFilter: "All", openReview: [], selfKey: {},
});
let S = blank();
let draft = null; // setup-screen working data: { parsed, key, examName, hash, keyName, keyCount }

function save() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ ...S, confirmEnd: false })); }
  catch {
    try { // too big (images) -> save without images so progress survives
      const slim = { ...S, questions: S.questions.map((q) => ({ ...q, images: [] })) };
      localStorage.setItem(STATE_KEY, JSON.stringify(slim));
    } catch { /* storage unavailable */ }
  }
}
function loadSaved() {
  try { const s = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); return s && s.stage ? s : null; }
  catch { return null; }
}

const settings = { aiEnabled: false, provider: "Anthropic", apiKey: "", model: DEFAULT_MODELS.Anthropic, remember: false };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch { /* ignore */ }
}
function saveSettings() {
  try {
    const out = { ...settings };
    if (!settings.remember) out.apiKey = "";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

const block = () => S.blockNums.map((n) => S.questions.find((q) => q.num === n)).filter(Boolean);
const curQ = () => block()[S.idx];
const isMarked = (n) => S.marked.includes(n);
const elapsed = () => S.elapsedAccum + (S.stage === "exam" && S.segStart ? (Date.now() - S.segStart) / 1000 : 0);
const remaining = () => S.durationS - elapsed();

function correctAnswer(num) {
  if (S.key[num]) return [S.key[num], "Key"];
  if (S.selfKey?.[num]) return [S.selfKey[num], "You"];
  if (S.ai[num]?.answer) return [S.ai[num].answer, "AI"];
  return [null, null];
}

function logTime() {
  const q = curQ();
  if (q && S.navTs) S.qtime[q.num] = (S.qtime[q.num] || 0) + (Date.now() - S.navTs) / 1000;
  S.navTs = Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar settings
// ─────────────────────────────────────────────────────────────────────────────
function initSettingsUI() {
  const prov = $("#provider"), key = $("#apiKey"), model = $("#model"), rem = $("#rememberKey");
  prov.value = settings.provider; key.value = settings.apiKey; model.value = settings.model; rem.checked = settings.remember;
  const status = () => {
    $("#aiStatus").innerHTML = aiReady() ? `<span style="color:var(--ok)">✔ AI ready</span>` : "Paste an API key to use AI — or switch AI off.";
  };
  syncAiUI = () => {
    const on = !!settings.aiEnabled;
    document.querySelectorAll('input[name="aiMode"]').forEach((r) => (r.checked = r.value === (on ? "on" : "off")));
    $("#aiFields").hidden = !on;
    $("#aiOffNote").hidden = on;
    if (key.value !== settings.apiKey) key.value = settings.apiKey;
    $("#settingsToggle").textContent = on ? (aiReady() ? "🤖 AI: On" : "🤖 AI: needs key") : "🤖 AI: Off";
    status();
  };
  document.querySelectorAll('input[name="aiMode"]').forEach((r) => r.addEventListener("change", () => {
    settings.aiEnabled = r.value === "on" && r.checked;
    saveSettings(); syncAiUI(); rerenderAfterAiChange();
    if (settings.aiEnabled && !settings.apiKey) key.focus();
  }));
  prov.addEventListener("change", () => {
    settings.provider = prov.value;
    if (Object.values(DEFAULT_MODELS).includes(model.value) || !model.value) model.value = settings.model = DEFAULT_MODELS[prov.value];
    saveSettings(); status(); rerenderIfSetup();
  });
  key.addEventListener("input", () => { settings.apiKey = key.value.trim(); saveSettings(); syncAiUI(); });
  key.addEventListener("change", rerenderAfterAiChange);
  model.addEventListener("input", () => { settings.model = model.value.trim(); saveSettings(); status(); });
  rem.addEventListener("change", () => { settings.remember = rem.checked; saveSettings(); });
  syncAiUI();

  const sidebar = $("#sidebar"), toggle = $("#settingsToggle");
  sidebar.classList.add("collapsed-settings");
  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("collapsed-settings") === false;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) sidebar.scrollIntoView({ behavior: "smooth" });
  });
}
let setupRerender = null;
let syncAiUI = () => {};
const rerenderIfSetup = () => { if (S.stage === "setup" && setupRerender) setupRerender(); };
/** Refresh whichever screen shows AI-dependent UI (never interrupts an exam in progress). */
const rerenderAfterAiChange = () => {
  if (S.stage === "setup") rerenderIfSetup();
  else if (S.stage === "review") renderReview();
};

// ─────────────────────────────────────────────────────────────────────────────
// Screen: setup
// ─────────────────────────────────────────────────────────────────────────────
function renderSetup() {
  $("#navPanel").hidden = true;
  const saved = loadSaved();
  const resumable = saved && (saved.stage === "exam" || saved.stage === "review");

  app.innerHTML = `
    <h1>NBME / USMLE Exam Simulator</h1>
    <p class="muted">Upload an exam PDF, add an answer key (or let the AI solve it), then take the block under real timing. Everything runs in your browser — your files never leave your device unless you use the AI.</p>
    ${resumable ? `<div class="notice info row"><span>You have an unfinished ${saved.stage === "exam" ? "block" : "block report"} (${esc(saved.examName || "exam")}).</span><span class="spacer"></span><button class="btn small primary" id="resume">Resume</button><button class="btn small" id="discard">Discard</button></div>` : ""}
    <div class="drops">
      <label class="drop" id="dropExam"><strong>1 · Exam PDF</strong><span class="muted small">Click or drop a .pdf</span>
        <input type="file" id="examFile" accept="application/pdf,.pdf"><div class="fname" id="examName"></div></label>
      <label class="drop" id="dropKey"><strong>2 · Answer key <span class="muted">(optional)</span></strong><span class="muted small">CSV, JSON, TXT or PDF — e.g. “1. A, 2. C”</span>
        <input type="file" id="keyFile" accept=".csv,.json,.txt,.pdf,text/plain,application/json,text/csv,application/pdf"><div class="fname" id="keyName"></div></label>
    </div>
    <div class="row"><button class="btn small" id="sample">Try the sample exam</button><span class="muted small">Detected formats: “1.”, “Question 1”, “Item 1 of 40”; options “A.”, “A)”, “(A)”.</span></div>
    <div id="status"></div>
    <div id="summary"></div>`;

  if (resumable) {
    $("#resume").onclick = () => { S = { ...blank(), ...saved }; if (S.stage === "exam") { S.elapsedAccum += Math.max(0, ((S.lastTick || S.segStart) - S.segStart) / 1000); S.segStart = Date.now(); S.navTs = Date.now(); } route(); };
    $("#discard").onclick = () => { try { localStorage.removeItem(STATE_KEY); } catch { /* */ } renderSetup(); };
  }

  const status = $("#status");
  const handleExam = async (file) => {
    $("#examName").textContent = file.name;
    status.innerHTML = `<p class="notice info"><span class="spinner"></span> <span id="prog">Reading PDF…</span></p>`;
    try {
      const buf = await file.arrayBuffer();
      const hash = await hashBytes(buf);
      const parsed = await parseExamPdf(buf, (m) => { const p = $("#prog"); if (p) p.textContent = m; });
      const key = Object.fromEntries(parsed.questions.filter((q) => q.key).map((q) => [q.num, q.key]));
      draft = { parsed, embedded: { ...key }, key, examName: file.name, hash, keyName: draft?.keyFile ? draft.keyName : "", keyFile: draft?.keyFile || null };
      if (draft.keyFile) await applyKey(draft.keyFile);
      status.innerHTML = "";
      renderSummary();
    } catch (e) {
      console.error(e);
      status.innerHTML = `<p class="notice bad">Could not read this PDF: ${esc(e.message)}</p>`;
    }
  };
  const applyKey = async (file) => {
    try {
      const k = await parseAnswerKey(file);
      if (draft) draft.key = { ...draft.embedded, ...k };
      draft.keyFile = file; draft.keyName = file.name; draft.keyCount = Object.keys(k).length; draft.keyError = null;
    } catch (e) { if (draft) draft.keyError = e.message; }
  };
  const handleKey = async (file) => {
    $("#keyName").textContent = file.name;
    if (!draft) { draft = { keyFile: file, keyName: file.name }; return; }
    await applyKey(file);
    renderSummary();
  };

  for (const [id, dropId, fn] of [["examFile", "dropExam", handleExam], ["keyFile", "dropKey", handleKey]]) {
    const input = $("#" + id), drop = $("#" + dropId);
    input.addEventListener("change", () => input.files[0] && fn(input.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) fn(f); });
  }
  $("#sample").onclick = async () => {
    try {
      const [pdf, key] = await Promise.all([fetch("samples/sample_exam.pdf"), fetch("samples/sample_key.txt")]);
      if (!pdf.ok) throw new Error("sample not found");
      draft = { keyFile: new File([await key.blob()], "sample_key.txt"), keyName: "sample_key.txt" };
      $("#keyName").textContent = "sample_key.txt";
      await handleExam(new File([await pdf.blob()], "sample_exam.pdf", { type: "application/pdf" }));
    } catch (e) { status.innerHTML = `<p class="notice bad">Could not load the sample: ${esc(e.message)}</p>`; }
  };

  if (draft?.parsed) {
    $("#examName").textContent = draft.examName;
    if (draft.keyName) $("#keyName").textContent = draft.keyName;
    renderSummary();
  }
  setupRerender = () => draft?.parsed && renderSummary();
}

function renderSummary() {
  const box = $("#summary");
  if (!box || !draft?.parsed) return;
  const { parsed, key } = draft;
  const qs = parsed.questions;
  const n = qs.length;
  const covered = qs.filter((q) => key[q.num]).length;
  const nImg = qs.reduce((a, q) => a + q.images.length, 0);
  const embedded = Object.keys(draft.embedded || {}).length;
  const missing = n - covered;

  let html = parsed.warnings.map((w) => `<p class="notice warn">${esc(w)}</p>`).join("");
  if (draft.keyError) html += `<p class="notice bad">Could not read answer key: ${esc(draft.keyError)}</p>`;
  else if (draft.keyName && draft.keyCount !== undefined) html += `<p class="notice ok">Answer key loaded: ${draft.keyCount} answers.</p>`;
  if (!n) { box.innerHTML = html; return; }

  html += `<div class="metrics">
      <div class="metric"><div class="v">${n}</div><div class="l">Questions</div></div>
      <div class="metric"><div class="v">${parsed.pages}</div><div class="l">Pages</div></div>
      <div class="metric"><div class="v">${nImg}</div><div class="l">Images</div></div>
      <div class="metric"><div class="v">${covered}/${n}</div><div class="l">Answers known</div></div>
    </div>`;
  if (embedded) html += `<p class="muted small">${embedded} answer(s) were found inside the PDF itself.</p>`;
  if (parsed.ocr) html += `<p class="muted small">Text was recovered with OCR — double-check the preview.</p>`;
  if (missing) html += aiReady()
    ? `<p class="notice info">${missing} question(s) have no answer key — the AI will answer them when you end the block.</p>`
    : `<p class="notice info">${missing} question(s) have no answer key. That's fine — you can still take the block and mark the correct answers yourself in the report${settings.aiEnabled ? "" : ", or turn AI on (optional)"}.</p>`;

  html += `<details class="preview panel"><summary><strong>🔍 Preview parsed questions</strong></summary>
    ${qs.map((q) => `<div class="pq"><strong>${q.num}.</strong> ${esc(q.stem.slice(0, 400))}${q.stem.length > 400 ? "…" : ""}
      <div class="muted small">${Object.entries(q.options).map(([k, v]) => `${k}. ${esc(v.slice(0, 60))}`).join(" | ")}${q.images.length ? ` · 🖼 ${q.images.length}` : ""}${key[q.num] ? ` · key: ${key[q.num]}` : ""}</div></div>`).join("")}
  </details>`;

  html += `<h3>3 · Block settings</h3>
    <div class="panel"><div class="settings-grid">
      <label>Questions per block<input type="number" id="bsize" min="1" max="${n}" value="${Math.min(40, n)}"></label>
      <label>Block<select id="bsel"></select></label>
      <label>Minutes<input type="number" id="mins" min="1" max="600"></label>
      <div><span style="font-size:.9rem">Mode</span><div class="seg">
        <label><input type="radio" name="mode" value="Timed test" checked> Timed test</label>
        <label><input type="radio" name="mode" value="Tutor"> Tutor</label></div></div>
      <div><span style="font-size:.9rem">AI explanations</span><div class="seg">
        <label><input type="radio" name="aiSetup" value="off" ${settings.aiEnabled ? "" : "checked"}> Skip</label>
        <label><input type="radio" name="aiSetup" value="on" ${settings.aiEnabled ? "checked" : ""}> Use AI</label></div></div>
    </div>
    ${settings.aiEnabled ? `<div class="settings-grid" style="margin-top:.5rem">
      <label>Provider<select id="setupProvider"><option value="Anthropic">Anthropic (Claude)</option><option value="OpenAI">OpenAI</option></select></label>
      <label>API key<input id="setupKey" type="password" name="llm-api-key-2" autocomplete="new-password" data-lpignore="true" data-1p-ignore placeholder="Paste your API key" value="${esc(settings.apiKey)}"></label>
      </div><p class="muted small" id="setupAiStatus">${aiReady() ? "✔ AI ready" : "No key yet — the block still starts; AI just stays off until you add one."}</p>` : ""}
    <p class="muted small">NBME standard pace: 75 minutes per 40 items. Tutor mode reveals the answer after each item.</p>
    <button class="btn primary" id="start">▶ Start block</button></div>`;
  box.innerHTML = html;

  const bsize = $("#bsize"), bsel = $("#bsel"), mins = $("#mins");
  const blocks = () => { const s = Math.max(1, Math.min(n, +bsize.value || 40)); const out = []; for (let i = 0; i < n; i += s) out.push(qs.slice(i, i + s)); return out; };
  const fill = () => {
    const bl = blocks();
    bsel.innerHTML = bl.map((b, i) => `<option value="${i}">Block ${i + 1} (Q${b[0].num}–${b.at(-1).num})</option>`).join("");
    setMins();
  };
  const setMins = () => { const b = blocks()[+bsel.value || 0]; mins.value = Math.max(1, Math.round((b.length * 75) / 40)); };
  bsize.addEventListener("input", fill);
  document.querySelectorAll('input[name="aiSetup"]').forEach((r) => r.addEventListener("change", () => {
    settings.aiEnabled = r.value === "on" && r.checked; saveSettings(); syncAiUI();
    const keep = { bsize: bsize.value, bsel: bsel.value, mins: mins.value, mode: document.querySelector('input[name="mode"]:checked').value };
    renderSummary();
    $("#bsize").value = keep.bsize; $("#bsize").dispatchEvent(new Event("input")); $("#bsel").value = keep.bsel; $("#mins").value = keep.mins;
    document.querySelector(`input[name="mode"][value="${keep.mode}"]`).checked = true;
    if (settings.aiEnabled && !settings.apiKey) $("#setupKey")?.focus();
  }));
  const sk = $("#setupKey"), sp = $("#setupProvider");
  if (sp) { sp.value = settings.provider; sp.onchange = () => { $("#provider").value = sp.value; $("#provider").dispatchEvent(new Event("change")); }; }
  if (sk) sk.addEventListener("input", () => {
    settings.apiKey = sk.value.trim(); saveSettings(); syncAiUI();
    $("#setupAiStatus").textContent = aiReady() ? "✔ AI ready" : "No key yet — the block still starts; AI just stays off until you add one.";
  });
  bsel.addEventListener("change", setMins);
  fill();

  $("#start").onclick = () => {
    const b = blocks()[+bsel.value || 0];
    const sameExam = S.examHash === draft.hash;
    S = {
      ...blank(),
      examHash: draft.hash, examName: draft.examName, questions: qs, key: { ...key },
      blockNums: b.map((q) => q.num), mode: document.querySelector('input[name="mode"]:checked').value,
      durationS: Math.max(60, Math.round((+mins.value || 1) * 60)), segStart: Date.now(), lastTick: Date.now(), navTs: Date.now(),
      ai: sameExam ? S.ai : {}, stage: "exam",
    };
    save();
    route();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen: exam
// ─────────────────────────────────────────────────────────────────────────────
function explanationHtml(q, chosen) {
  const [ans, src] = correctAnswer(q.num);
  const aiTag = src === "AI" ? " (AI-derived)" : "";
  let html = "";
  if (ans) {
    if (chosen === ans) html += `<p class="notice ok">Correct — the answer is <strong>${ans}</strong>${aiTag}</p>`;
    else if (chosen) html += `<p class="notice bad">Incorrect — you chose <strong>${esc(chosen)}</strong>; the answer is <strong>${ans}</strong>${aiTag}</p>`;
    else html += `<p class="notice warn">Unanswered — the answer is <strong>${ans}</strong>${aiTag}</p>`;
  } else if (!S.aiErr[q.num]) {
    html += `<p class="notice info">No answer key for this item.</p>`;
  }
  if (q.srcExpl) html += `<div class="expl"><h4>Explanation from the PDF</h4>${textToHtml(q.srcExpl)}</div>`;
  const r = S.ai[q.num];
  if (r) {
    html += `<div class="expl"><h4>AI tutor explanation${r.topic ? ` · <span class="muted">${esc(r.topic)}</span>` : ""}${r.confidence && !r.usedKey ? ` <span class="muted small">· confidence: ${esc(r.confidence)}</span>` : ""}</h4>
      ${md(r.explanation)}
      <h4 style="margin-top:1rem">Every answer choice</h4>
      ${Object.entries(q.options).map(([L, t]) => {
        const icon = L === r.answer ? "✅" : L === chosen ? "❌" : "▫️";
        return `<div class="choice">${icon} <strong>${L}. ${esc(t)}</strong> — ${md(r.choices?.[L] || "").replace(/^<p>|<\/p>$/g, "")}</div>`;
      }).join("")}
      ${r.pearls?.length ? `<h4 style="margin-top:1rem">High-yield pearls</h4><ul>${r.pearls.map((p) => `<li>${md(p).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
      ${r.educational_objective ? `<div class="objective"><strong>Educational objective:</strong> ${esc(r.educational_objective)}</div>` : ""}
    </div>`;
  } else if (S.aiErr[q.num]) html += `<p class="notice bad">AI error: ${esc(S.aiErr[q.num])}</p>`;
  if (!r && aiReady()) html += `<p><button class="btn small" data-explain="${q.num}">🤖 Explain every choice with AI</button></p>`;
  if (S.stage === "review" && !S.key[q.num] && (src !== "AI")) {
    html += `<div class="selfgrade"><span class="small">${ans ? "Change the correct answer:" : "Know the answer? Mark it to score this item:"}</span>
      ${Object.keys(q.options).map((L) => `<button class="btn small ${ans === L ? "primary" : ""}" data-self="${q.num}:${L}" aria-pressed="${ans === L}">${L}</button>`).join("")}
      ${ans ? `<button class="btn small" data-self="${q.num}:">Clear</button>` : ""}</div>`;
  }
  return html;
}

function wireExplainButtons(root, after) {
  root.querySelectorAll("[data-explain]").forEach((btn) => {
    btn.onclick = async () => {
      const q = S.questions.find((x) => x.num === +btn.dataset.explain);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Asking the AI tutor…`;
      try { S.ai[q.num] = await callLLM(q, S.key[q.num]); delete S.aiErr[q.num]; }
      catch (e) { S.aiErr[q.num] = e.message; }
      save(); after();
    };
  });
}

function renderNav() {
  const b = block();
  $("#navPanel").hidden = false;
  $("#navSummary").textContent = `Answered ${b.filter((q) => S.answers[q.num]).length}/${b.length} · Marked ${S.marked.length}`;
  $("#navGrid").innerHTML = b.map((q, i) =>
    `<button data-i="${i}" class="${i === S.idx ? "current" : ""} ${S.answers[q.num] ? "answered" : ""} ${isMarked(q.num) ? "marked" : ""}" aria-label="Question ${q.num}${isMarked(q.num) ? ", marked" : ""}${S.answers[q.num] ? ", answered" : ""}">${q.num}</button>`).join("");
  $("#navGrid").querySelectorAll("button").forEach((btn) => (btn.onclick = () => goto(+btn.dataset.i)));
}

function goto(i) {
  logTime();
  S.idx = Math.max(0, Math.min(i, block().length - 1));
  S.confirmEnd = false;
  save();
  renderExam();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function choose(L) {
  const q = curQ();
  if (!q || !(L in q.options)) return;
  if (S.mode === "Tutor" && S.revealed.includes(q.num)) return;
  S.answers[q.num] = L;
  save();
  renderExam();
}

function toggleMark() {
  const q = curQ();
  S.marked = isMarked(q.num) ? S.marked.filter((n) => n !== q.num) : [...S.marked, q.num];
  save();
  renderExam();
}

function renderExam() {
  const b = block();
  const q = curQ();
  if (!q) { S.stage = "setup"; return route(); }
  const tutor = S.mode === "Tutor";
  const locked = tutor && S.revealed.includes(q.num);
  const chosen = S.answers[q.num];
  const [ans] = correctAnswer(q.num);

  renderNav();
  const unanswered = b.filter((x) => !S.answers[x.num]).length;
  app.innerHTML = `
    <div class="qbar">
      <b>Item ${S.idx + 1} of ${b.length}</b><span>Question #${q.num}</span><span class="muted" style="color:inherit;opacity:.8">${esc(S.mode)}</span>
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" id="mark" ${isMarked(q.num) ? "checked" : ""}> ⚑ Mark</label>
      <span id="timer" class="timer" aria-live="off"></span>
    </div>
    <div class="stem">${textToHtml(q.stem)}</div>
    ${q.images.map((src, i) => `<img class="qimg" src="${src}" alt="Figure ${i + 1} for question ${q.num}">`).join("")}
    ${Object.keys(q.options).length ? `<div class="options" role="radiogroup" aria-label="Answer choices">
      ${Object.entries(q.options).map(([L, t]) => {
        let cls = chosen === L ? "selected" : "", tag = "";
        if (locked && ans) {
          if (L === ans) { cls = "correct"; tag = "✅ correct"; }
          else if (L === chosen) { cls = "wrong"; tag = "❌ your answer"; }
        }
        return `<label class="opt ${cls} ${locked ? "locked" : ""}"><input type="radio" name="ans" value="${L}" ${chosen === L ? "checked" : ""} ${locked ? "disabled" : ""}><span><strong>${L}.</strong> ${esc(t)}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</label>`;
      }).join("")}</div>` : `<p class="notice warn">No options were detected for this item.</p>`}
    ${tutor ? (locked ? `<div id="tutorExpl">${explanationHtml(q, chosen)}</div>` : `<button class="btn" id="submitAns" ${chosen ? "" : "disabled"}>Submit answer</button>`) : ""}
    <div class="row" style="margin-top:1.2rem">
      <button class="btn" id="prev" ${S.idx === 0 ? "disabled" : ""}>⬅ Previous</button>
      <button class="btn" id="next" ${S.idx === b.length - 1 ? "disabled" : ""}>Next ➡</button>
      <span class="spacer"></span>
      <button class="btn primary" id="end">End block</button>
    </div>
    ${S.confirmEnd ? `<div class="notice warn confirm"><p style="margin:0 0 .6rem">End the block? ${unanswered} unanswered, ${S.marked.length} marked. Time remaining ${fmtClock(remaining())}.</p>
      <div class="row"><button class="btn danger" id="endYes">Yes, end block</button><button class="btn" id="endNo">Cancel</button></div></div>` : ""}`;

  tickTimer();
  app.querySelectorAll('input[name="ans"]').forEach((r) => (r.onchange = () => choose(r.value)));
  $("#mark").onchange = toggleMark;
  $("#prev").onclick = () => goto(S.idx - 1);
  $("#next").onclick = () => goto(S.idx + 1);
  $("#end").onclick = () => { S.confirmEnd = true; renderExam(); $("#endYes")?.focus(); };
  if (S.confirmEnd) { $("#endYes").onclick = () => finishExam(false); $("#endNo").onclick = () => { S.confirmEnd = false; renderExam(); }; }
  const submit = $("#submitAns");
  if (submit) submit.onclick = async () => {
    S.revealed.push(q.num);
    if (!S.key[q.num] && !S.ai[q.num] && aiReady()) {
      submit.disabled = true; submit.innerHTML = `<span class="spinner"></span> Asking the AI tutor…`;
      try { S.ai[q.num] = await callLLM(q, null); delete S.aiErr[q.num]; } catch (e) { S.aiErr[q.num] = e.message; }
    }
    save(); renderExam();
  };
  const te = $("#tutorExpl");
  if (te) wireExplainButtons(te, renderExam);
}

let timerHandle = null;
function tickTimer() {
  if (S.stage !== "exam") return;
  const rem = remaining();
  const el = $("#timer");
  if (el) { el.textContent = "⏱ " + fmtClock(rem); el.classList.toggle("low", rem < 300); }
  S.lastTick = Date.now();
  if (rem <= 0) finishExam(true);
}
function startTimer() {
  clearInterval(timerHandle);
  let n = 0;
  timerHandle = setInterval(() => { tickTimer(); if (++n % 5 === 0) save(); }, 1000);
}

function finishExam(auto) {
  if (S.stage !== "exam") return;
  logTime();
  S.elapsedAccum = elapsed();
  S.segStart = 0;
  S.endTs = Date.now();
  S.autoEnded = auto;
  S.stage = "grading";
  clearInterval(timerHandle);
  save();
  route();
}

document.addEventListener("keydown", (e) => {
  if (S.stage !== "exam" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "radio" && e.target.type !== "checkbox") return;
  const k = e.key.toUpperCase();
  if (LETTERS.includes(k) && k.length === 1) { choose(k); e.preventDefault(); }
  else if (e.key === "ArrowRight" || k === "N") { goto(S.idx + 1); e.preventDefault(); }
  else if (e.key === "ArrowLeft" || k === "P") { goto(S.idx - 1); e.preventDefault(); }
  else if (k === "M") { toggleMark(); e.preventDefault(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen: grading + review
// ─────────────────────────────────────────────────────────────────────────────
async function renderGrading() {
  $("#navPanel").hidden = true;
  app.innerHTML = `<h1>Scoring your block…</h1><div id="gprog"></div>`;
  const unkeyed = block().filter((q) => !S.key[q.num]);
  if (unkeyed.length && aiReady()) await runAiBatch(unkeyed, "AI solving unkeyed questions", $("#gprog"));
  S.stage = "review";
  save();
  route();
}

function reviewRows() {
  return block().map((q) => {
    const mine = S.answers[q.num];
    const [ans, src] = correctAnswer(q.num);
    let result = "— Ungraded", cls = "";
    if (ans) {
      if (mine === ans) { result = "✅ Correct"; cls = "r-ok"; }
      else if (!mine) result = "⬜ Omitted";
      else { result = "❌ Incorrect"; cls = "r-bad"; }
    }
    return { q, Q: q.num, your: mine || "—", correct: ans || "?", result, cls, source: src || "—", marked: isMarked(q.num), time: Math.round(S.qtime[q.num] || 0) };
  });
}

function renderReview() {
  $("#navPanel").hidden = true;
  const rows = reviewRows();
  const b = block();
  const graded = rows.filter((r) => r.correct !== "?").length;
  const correct = rows.filter((r) => r.result.startsWith("✅")).length;
  const pct = graded ? Math.round((100 * correct) / graded) : 0;
  const used = S.elapsedAccum;
  const nAi = rows.filter((r) => r.source === "AI").length;
  const filters = ["All", "Incorrect", "Omitted", "Marked", "Correct", ...(graded < b.length ? ["Ungraded"] : [])];
  if (!filters.includes(S.reviewFilter)) S.reviewFilter = "All";
  const show = (r) => ({
    All: true, Incorrect: r.result.startsWith("❌"), Omitted: r.result.startsWith("⬜"), Marked: r.marked, Correct: r.result.startsWith("✅"), Ungraded: r.correct === "?",
  })[S.reviewFilter];

  app.innerHTML = `
    <h1>📊 Block report</h1>
    <p class="muted">${esc(S.examName)} · ${esc(S.mode)}</p>
    ${S.autoEnded ? `<p class="notice warn">Time expired — the block was submitted automatically.</p>` : ""}
    <div class="metrics">
      <div class="metric"><div class="v">${correct}/${graded}</div><div class="l">Score · ${pct}%</div></div>
      <div class="metric"><div class="v">${rows.filter((r) => r.result.startsWith("❌")).length}</div><div class="l">Incorrect</div></div>
      <div class="metric"><div class="v">${rows.filter((r) => r.result.startsWith("⬜")).length}</div><div class="l">Omitted</div></div>
      <div class="metric"><div class="v">${fmtClock(used)}</div><div class="l">Time used of ${fmtClock(S.durationS)}</div></div>
      <div class="metric"><div class="v">${Math.round(used / Math.max(1, b.length))}s</div><div class="l">Avg / item</div></div>
    </div>
    ${nAi ? `<p class="notice warn">${nAi} item(s) were graded against AI-derived answers, which can be wrong. Treat those as provisional.</p>` : ""}
    ${graded < b.length ? `<p class="notice info">${b.length - graded} item(s) have no answer key yet. Open them under <strong>Ungraded</strong> below and click the correct letter to include them in your score.</p>` : ""}
    <div class="tablewrap"><table>
      <thead><tr><th>Q</th><th>Your answer</th><th>Correct</th><th>Result</th><th>Source</th><th>Marked</th><th>Time (s)</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.Q}</td><td>${esc(r.your)}</td><td>${esc(r.correct)}</td><td class="${r.cls}">${r.result}</td><td>${r.source}</td><td>${r.marked ? "⚑" : ""}</td><td>${r.time}</td></tr>`).join("")}</tbody>
    </table></div>
    <div class="row" style="margin:1rem 0">
      ${aiReady() ? `<button class="btn" id="explainAll">🤖 Generate explanations for all</button>` : ""}
      <button class="btn" id="dlCsv">⬇ Results CSV</button>
      <button class="btn" id="dlJson">⬇ Full review JSON</button>
      <span class="spacer"></span>
      <button class="btn primary" id="newExam">↺ New exam / block</button>
    </div>
    <div id="bprog"></div>
    <h3>Question review</h3>
    <div class="filters" role="group" aria-label="Filter questions">${filters.map((f) => `<button data-f="${f}" class="${S.reviewFilter === f ? "on" : ""}" aria-pressed="${S.reviewFilter === f}">${f}</button>`).join("")}</div>
    <div id="rlist">${rows.filter(show).map((r) => `
      <details class="rq" data-num="${r.Q}" ${S.openReview.includes(r.Q) ? "open" : ""}>
        <summary>Q${r.Q} · ${r.result} · you: ${esc(r.your)} · answer: ${esc(r.correct)} ${r.marked ? "⚑" : ""}</summary>
        <div class="body">
          <div class="stem">${textToHtml(r.q.stem)}</div>
          ${r.q.images.map((src, i) => `<img class="qimg" src="${src}" alt="Figure ${i + 1} for question ${r.Q}">`).join("")}
          <div class="options">${Object.entries(r.q.options).map(([L, t]) => {
            let cls = "", tag = "";
            if (L === r.correct) { cls = "correct"; tag = "✅ correct"; }
            if (L === r.your && L !== r.correct) { cls = "wrong"; tag = "❌ your answer"; }
            else if (L === r.your) tag += " · your answer";
            return `<div class="opt locked ${cls}"><span><strong>${L}.</strong> ${esc(t)}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</div>`;
          }).join("")}</div>
          ${explanationHtml(r.q, S.answers[r.Q])}
        </div>
      </details>`).join("") || `<p class="muted">No questions match this filter.</p>`}</div>`;

  app.querySelectorAll("details.rq").forEach((d) => d.addEventListener("toggle", () => {
    const n = +d.dataset.num;
    S.openReview = d.open ? [...new Set([...S.openReview, n])] : S.openReview.filter((x) => x !== n);
  }));
  app.querySelectorAll("[data-f]").forEach((btn) => (btn.onclick = () => { S.reviewFilter = btn.dataset.f; save(); renderReview(); }));
  wireExplainButtons($("#rlist"), renderReview);
  app.querySelectorAll("[data-self]").forEach((btn) => (btn.onclick = () => {
    const [n, L] = btn.dataset.self.split(":");
    S.selfKey = S.selfKey || {};
    if (L) S.selfKey[+n] = L; else delete S.selfKey[+n];
    if (!S.openReview.includes(+n)) S.openReview.push(+n);
    save(); renderReview();
  }));

  const ea = $("#explainAll");
  if (ea) ea.onclick = async () => {
    ea.disabled = true;
    await runAiBatch(b, "Explaining", $("#bprog"));
    renderReview();
  };
  $("#dlCsv").onclick = () => {
    const head = ["Q", "Your answer", "Correct", "Result", "Source", "Marked", "Time (s)"];
    const lines = rows.map((r) => [r.Q, r.your, r.correct, r.result.replace(/^\S+\s/, ""), r.source, r.marked ? "yes" : "", r.time]);
    download("nbme_results.csv", [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  };
  $("#dlJson").onclick = () => {
    const full = b.map((q) => ({ question: q.num, stem: q.stem, options: q.options, your_answer: S.answers[q.num] || null, correct: correctAnswer(q.num)[0], source: correctAnswer(q.num)[1], ai: S.ai[q.num] || null }));
    download("nbme_review.json", JSON.stringify(full, null, 2), "application/json");
  };
  $("#newExam").onclick = () => { S.stage = "setup"; save(); route(); };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
function route() {
  clearInterval(timerHandle);
  if (S.stage === "exam") { startTimer(); renderExam(); }
  else if (S.stage === "grading") renderGrading();
  else if (S.stage === "review") renderReview();
  else renderSetup();
}

window.addEventListener("beforeunload", () => { if (S.stage === "exam") { S.lastTick = Date.now(); save(); } });

loadSettings();
initSettingsUI();
route();
