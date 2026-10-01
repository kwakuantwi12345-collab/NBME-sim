# NBME / USMLE Exam Simulator (static web app)

Upload an exam PDF and take it as a timed, NBME-style block. You get scoring, a review report and optional AI explanations.

It runs **entirely in the browser**. There's no server, so it can be hosted free on GitHub Pages.

## Files

```
index.html          page layout
style.css           styles (light + dark mode)
app.js              all logic: PDF parsing, exam, timer, scoring, AI
vendor/pdfjs/       Mozilla pdf.js (legacy build, Apache-2.0) for reading PDFs
samples/            sample_exam.pdf + sample_key.txt (the "Try the sample exam" button)
```

## Put it online with GitHub Pages

1. **Create a repo.** On github.com, click **+** → **New repository**. Name it, e.g. `nbme-simulator`, choose **Public**, then click **Create repository**.
2. **Upload the files.** Click **uploading an existing file**. Drag in **everything inside this folder**: `index.html`, `app.js`, `style.css`, `README.md` and the `vendor` and `samples` folders. Then click **Commit changes**.
3. **Turn on Pages.** Go to **Settings** → **Pages**. Under "Build and deployment", set **Source** to **Deploy from a branch**, **Branch** to `main`, and the folder to `/ (root)`, then click **Save**.
4. **Wait 1–2 minutes.** Refresh the Pages settings screen and you'll see **"Your site is live at https://YOUR-USERNAME.github.io/nbme-simulator/"**.

To update the site, upload changed files to the repo again. Pages redeploys automatically in about a minute.

## Run it on your own computer

Opening `index.html` by double-clicking **won't work**, because browsers block the PDF reader on `file://` pages. Serve the folder instead:

```bash
python3 -m http.server 8000      # Windows: py -m http.server 8000
```

Then open http://localhost:8000.

## How it works

- **PDF parsing:** pdf.js reads the real text with its position on the page. The text is rebuilt into lines and split into questions and options (A–H). It recognises:
  - question starts: `1.`, `Question 1`, `Item 1 of 40`
  - options: `A.`, `A)`, `(A)`, and inline `A. x B. y`
  - answers printed in the PDF, e.g. `Correct answer: C`
- **Cleanup:** running headers and footers are removed. A numbered list inside a vignette stays in the vignette. Images are found from the PDF's drawing commands, cropped, and attached to their question.
- **Scanned PDFs:** if a PDF has no text layer, the app loads Tesseract.js from jsDelivr on demand and runs OCR.
- **Answer key:** TXT or PDF (`1. A, 2. C`), CSV (`question,answer`) or JSON (`{"1":"A"}`).
- **AI solver (optional):** each user pastes their own Anthropic or OpenAI API key. The browser calls the provider directly. Anthropic requires the `anthropic-dangerous-direct-browser-access` header, and the app sends it. The key is kept in memory only, unless the user ticks "Remember key on this device". This site never receives keys or exam content.
- **Exam:**
  - timed (default 75 min per 40 items) or tutor mode
  - Mark, a navigator, and keyboard shortcuts (A–H, ←/→, M)
  - auto-submit at 0:00
  - progress is saved in the browser, so a refresh lets you resume, and the timer pauses while the page is closed
- **Report:**
  - score, incorrect/omitted counts, and time per item
  - your answer vs. the correct answer
  - an explanation of every choice, with high-yield pearls
  - CSV and JSON export

## Privacy and limits

- Exam PDFs are processed on your device. When you use the AI, question text and images go to the AI provider you chose.
- AI-derived answers are labelled "AI" and can be wrong.
- Only upload material you have the right to use.
- Model names change over time; edit the model field in AI settings.
