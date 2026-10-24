# Onboard-skill requirements (DRAFT, awaiting approval)

## Purpose
Turn a plain-language request ("add a skill that does X") into a fully tested skill in this plugin, plus every tool it needs to run.

## How it starts
- Natural request ("add a new skill for ...") OR a slash command (name TBD, e.g. /new-skill). Both lead to the same workflow.

## Process (reuses the Superpowers plugin; no custom process code)
1. Brainstorm: Superpowers `brainstorming`, interview the user, produce a spec.
2. Plan: Superpowers `writing-plans`.
3. APPROVAL GATE: user approves the requirements/spec before any files are created.
4. Write the skill: Superpowers `writing-skills`, using docs/skill-template.md. Creates skills/<name>/SKILL.md and docs/requirements/<name>.md.
5. Provision required tools (see below).
6. Test: dry run first, then a live test the user approves.
7. Verify: Superpowers `verification-before-completion`. A skill is "done" only when the test passes.

## Output per skill
- skills/<name>/SKILL.md (from the template)
- docs/requirements/<name>.md
- Every tool the skill needs, set up and checked (connectors, browser access, secrets, network allowlist entries, scheduled task)
- Test evidence (what was run, what happened)
- Readable Claude Doc copy of the requirements (on request)

## Rules
- Plain-text instructions first; scripts only if instructions cannot do the job.
- Secrets live in environment secrets, never the repo.
- Explain in plain language, ask clarifying questions first, present options and recommend one.
- One approval point (step 3), then build.

## Open questions
- Slash command name.
- Does the skill depend on Superpowers being installed, or should it bundle copies? (Recommended: depend on it.)
- What counts as "fully tested" for skills that act on the real world (e.g. booking)?
- How tools are provisioned in practice (what Claude can do itself vs what you must click).
