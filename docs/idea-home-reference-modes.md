# Idea Home: creation modes and references

## Product flow

- Creative: request + optional references → three directions → production settings → confirmation → build.
- Blueprint: request + optional references → production settings → confirmation → build. No idea-generation or attachment-analysis model call before settings.
- Both use the existing bootstrap and Foundation authoring entry, not a separate attachment build workflow.

## Responsibilities

- Frontend: select mode, collect files, preserve settings, ask for explicit build confirmation.
- Intake reference decoder: turn documents into text and visual references into model image parts; does not invent a game design.
- Bootstrap: validate uploads, save original bytes under the new project's attachment directory, and bind relative paths + hashes into the confirmed brief.
- Foundation author workspace: copy the confirmed originals into its existing isolated workspace. The Agent decides how to use the references alongside the user's request.

## Supported inputs and limits

- Images: PNG, JPEG, WebP.
- Documents: text-based PDF, DOCX, XLSX, TXT, Markdown, CSV, JSON, JSONL. Legacy DOC/XLS must be converted.
- Video: MP4, MOV, WebM. Creative intake uses six timestamped frames; it does not transcribe audio or claim to inspect every frame. FFmpeg and FFprobe must be available on the runtime server.
- Uploads: at most eight files, 10 MB each, 32 MB total. Intake text: 100,000 characters total; PDF: 100 pages; video: ten minutes.
- The original files are retained unchanged. Resized images and sampled video frames are only planning inputs.
- Before project creation, binary attachments live in memory. Refresh/login redirects require reattachment; missing references block generation/build with an explicit message rather than silently disappearing.

## No-cost checks (2026-09-22)

- Frontend mode regressions: direct blueprint settings, restore/back, creative request with attachments, both build handoffs, missing-reference guard.
- Backend: real PDF/DOCX/XLSX decoding, image processing, silent FFmpeg sampling, valid Base64 padding, original-file hashes, isolated author copies, bootstrap metadata, and reference content at the model boundary.
- Browser: blueprint submission opens production settings directly. Did not click build or invoke a paid model.
- Existing unrelated checks are not claimed green: nine LandingView tests still fail (native-select/old UI assumptions and account/history assertions); backend typecheck has an existing UI-editor fixture typing error.
