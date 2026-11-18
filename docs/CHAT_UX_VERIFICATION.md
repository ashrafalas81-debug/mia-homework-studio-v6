# Conversational UX revision — 2026-11-13

## Changes
- The default workspace contains chat and attachment controls. Requirements, evidence, document editing and slide editing are opened explicitly, rather than rendered alongside the conversation.
- A schema-validated conversational AI operation reads recent conversation before asking a short, single clarification. Task understanding/planning are deferred until a concrete topic and sufficient instructions exist; generation still requires confirmation.
- Initial greetings do not generate a task or use an AI request.
- Auto-scroll is contained within the message list and follows only while the reader is near the bottom. Page height and composer placement were checked in browser DOM.
- All user chat turns are saved, including conversations with no task brief yet. Old projects are retained.

## Executed validation
- `npm test`: 26 tests passed across 4 suites.
- `npm run build`: TypeScript, client build and Worker bundle passed. Vite reports a large-bundle advisory; this is not an assertion of optimized startup performance.
- Local browser: verified default layout, attachment control, greeting response, hidden settings and page/composer bounds (viewport 936 px; document height 936 px; composer bottom 920 px).
- Published browser: sent 'عايز أسألك على حاجة' then 'الدكتورة طلبت مني أنا بحث'. The reply invited the question, then asked 'تمام، موضوع البحث إيه؟'. No task brief was created at that point.
- Supplied 'عن Dermatomes and Myotomes'. The model asked for delivery language in one short question. Supplied English, no further professor requirements, a short cited research draft followed by six slides. The agent produced a concise confirmation preserving both deliverables and six-slide count.

## Scope
Live conversation checks used the configured AI provider. Automated dialogue tests use mocked provider outputs to verify orchestration safeguards and complement the live conversation checks. These checks do not establish scientific correctness of generated medical content or guarantee error-free responses to every future prompt.

## Research failure found during live verification
- Initial research execution found zero records because the model-generated search query included deliverable boilerplate (scientific references, review). No research or slides were falsely reported as generated.
- Added concise-query guidance, removal of deliverable boilerplate, and a maximum of three actual query variants. NCBI failures are not retried for every alternative; Europe PMC remains the verified metadata/abstract fallback. Actual queries are saved in search history.
- Empty evidence now fails at the search stage with a concise retry action rather than incorrectly marking an empty search as a usable evidence batch. Retrying a previously saved empty search reruns that step.
- Three added regression tests cover query cleaning, bounded fallback and truthful empty results.

## Additional live observations
- After publication and browser refresh, reopened the saved conversation from My chats and resumed with 'حاول تاني'. The bounded query alternatives retrieved usable abstracts and produced a research draft. The following deck step encountered the configured provider's temporary free-capacity limit; the existing draft was preserved and the interface did not announce completion.
- Removed repeated full abstracts from the research-to-deck AI request: the existing citation-linked research draft is the authoritative synthesis, while verified source identifiers remain available. Reserved output tokens now scale with slide count instead of always reserving 7,000 tokens.
- Added a cancellation regression check: cancelling before work runs cannot announce a draft as ready.
- Menu closes after a navigation selection; main page does not scroll while reading chat.

- Review of the generated draft exposed weak topic relevance among retrieved records. Added a lexical topic-overlap gate for automatic evidence selection, excluded generic deliverable words from relevance terms, and made the dermatomes/myotomes alternative query explicitly Boolean. This is a transparent retrieval heuristic, not scientific validation or full-text appraisal. Existing older drafts are retained and are not silently rewritten.
