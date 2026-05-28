# Idea: Agent Structure Methodology Document

Captured from operator voice (62784) during Curator spec v2 session, 2026-05-27.

## Operator intent

> "Maybe even have a side document going about how to properly build agent structure"

Mentioned in the context of rebuilding the Curator spec from scratch. The operator observed that agent specs historically conflate identity, purpose, and operational rules — and wanted a reference doc capturing the right way to structure an agent spec.

## Suggested scope

- Separation of purpose vs identity vs operational rules
- Purpose-only vs identity-bearing agents (and when each applies)
- Workspace-scoped vs fleet-scoped agents
- Operator dependency: when agents require operators vs when they're autonomous
- Spec format: third person, requirements-only, no implementation

## Relationship to current work

Curator spec v2 rebuild is the live example of applying these principles.
Could be extracted into a methodology doc once v2 is complete and patterns are clear.
