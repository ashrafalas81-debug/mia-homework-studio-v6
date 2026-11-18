# MIA Homework Studio — Medical Edition, v2 (Unified Agent Rebuild)

This release transforms MIA Homework Studio from four separate form questionnaires into a **Unified Academic Agent (`Agent Bot بواجهة شات واحدة`)** backed by a typed orchestration layer (`src/agent/`) and four callable academic capabilities (`Assignment Me`, `Research Me`, `File Maker`, `Present Me`), with an adjacent live editable workspace for inspecting, editing, and exporting documents, tables, evidence, slides, speaker notes, viva questions, and PDF files.

## Run locally
1. Install Node.js 20+ (or 24+).
2. `npm ci`
3. Copy `.env.example` to `.env` and set `GROQ_API_KEY` on the server (optional `GROQ_FALLBACK_MODEL=llama-3.3-70b-versatile` for automatic free fallback if the primary model is unavailable or requires qualification).
4. `npm run dev`
5. Open the printed local URL. `npm run build` checks TypeScript and builds the static app and deployable Cloudflare Worker (`dist/server/index.js`). `npm test` runs the regression and agent orchestration test suite.

Provider secrets never enter frontend bundles. Do not put keys in `VITE_*` variables. The delivered source includes no real keys.

## What was rebuilt in v2
1. **Typed Agent Orchestration Layer (`src/agent/`)**:
   - `src/agent/conversation.ts`: conversation messages, compact context builder, and patient-identifier redaction (`redactPatientIdentifiers`).
   - `src/agent/intent.ts`: detects single and chained deliverables (`research` + `present`), scoped revisions (`revise_slide`, `revise_section`, `change_theme`, `convert_research_to_slides`), and zero-AI mechanical file operations (`file_operation`).
   - `src/agent/requirements.ts`: checks only critical missing requirements (delivery language, slide count when unspecified), preserves unspecified professor parameters (`deadline`, `requestedCount`, `rubric`) as `null`, and generates quick-reply options in Arabic and English.
   - `src/agent/planner.ts`: schema-validated dependency graph (`ExecutionPlan`) chaining `search_literature` → `select_evidence` → `draft_research` → `create_slide_spec`.
   - `src/agent/registry.ts`: 18 registered typed tools (`extract_document`, `understand_task`, `ask_requirements`, `search_literature`, `retrieve_source`, `select_evidence`, `draft_assignment`, `draft_research`, `revise_section`, `create_slide_spec`, `revise_slide`, `export_docx`, `export_pdf`, `export_pptx`, `merge_pdf`, `extract_pdf_pages`, `images_to_pdf`, `save_project`) with Zod schemas, cost categories, and authorization checks.
   - `src/agent/executor.ts`: bounded execution loop with cancellation, input fingerprints, and partial-success recovery (a failed later step never erases a completed research draft or evidence selection).
   - `src/agent/artifacts.ts` & `src/agent/review.ts`: artifact provenance, version checkpoints, citation integrity checks, and clinical claim flags (`flagUnsupportedClaims`).
2. **Scientific Research & PubMed Book Record Support (`server/research.ts` & `shared/model.ts`)**:
   - Parses both `PubmedArticle` and `PubmedBookArticle` (NCBI Bookshelf / StatPearls chapters) so queries like `dermatomes myotomes` do not drop book records.
   - Extracts `volume`, `issue`, and `pages` (`MedlinePgn`) for complete APA and Vancouver references without inventing missing metadata.
   - Adds query expansion (`expandMedicalQuery`), deduplication by PMID/DOI (`deduplicateSources`), pagination, automatic evidence quality recommendation (`recommendEvidence`), and official Europe PMC fallback.
3. **PowerPoint & Provider Error Resilience (`server/ai.ts`, `server/app.ts`, `src/export.ts`)**:
   - Explicitly distinguishes HTTP `400` (`INVALID_REQUEST`), `401` (`KEY_REJECTED`), `403` (`MODEL_FORBIDDEN`), `404` (`MODEL_UNAVAILABLE`), `429` (`CAPACITY_LIMIT`), and `5xx` (`PROVIDER_UNAVAILABLE`).
   - Supports `GROQ_FALLBACK_MODEL` when the primary model is unavailable (`404`) or unqualified (`403`), without ever spilling invalid `400` requests into paid OpenRouter fallback.
   - Passes `researchDoc` into `deck` generation so chained Research → PowerPoint workflows synthesize the reviewed research draft and reuse its verified `sourceIds`.
   - Sanitizes slide titles, bullet counts, and character bounds (`sanitizeSlide` / `normalizeDeck`) while preserving overflow text in `speakerNotes` so PPTX export never fails on minor character overflows.

## Deployment & Supabase
See `database/setup.sql` and `.env.example`. Configure runtime secrets in your Cloudflare Worker or Vercel environment. Do not overwrite an existing MIA Study production application; mount the module under its dedicated route.
