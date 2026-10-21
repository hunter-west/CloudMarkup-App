# Execution plans

Paths in this policy are relative to the repository root.

Use an execution plan for work that crosses packages or architectural
boundaries, changes a public/persisted/cross-language contract, adds a migration
or security control, or cannot be safely completed as one small change.

Store active plans in `docs/roadmap/plans/`. Plans are resumable execution
records, not substitutes for product requirements, ADRs, or roadmap status. Keep
exactly one checkpoint marked `(current)`, update it as work advances, and make
the stopping condition objectively testable.

## Required template

````markdown
# <Outcome>

- Milestone: M<n>
- Workflows: WF-<n>, ...
- Status: proposed | active | blocked | complete
- Owners: <person/team or unassigned>

## Goals

- <Observable result.>
- <Contract or operational result, if applicable.>

## Context

<Current facts, prerequisites, relevant docs/ADRs, and affected packages or
contracts. Link rather than repeat stable repository guidance.>

## Constraints

- <Architectural, compatibility, security, sequencing, or tool constraint.>
- <Accepted decision this work must preserve.>

## Non-goals

- <Explicitly excluded behavior or later milestone.>

## Checkpoints

- [ ] (current) <Next bounded, verifiable checkpoint.>
- [ ] <Following checkpoint.>

## Validation commands

```powershell
<Exact commands, test layers, failure cases, and manual evidence.>
```

## Migration impact

<Data, schema, API, fixture, compiler, or rollout impact. Write "None" with a
reason when no migration applies. Include rollback/compatibility behavior.>

## Security impact

<Trust boundaries, tenant authorization, secrets, permissions, isolation,
network, logging, audit, and negative tests. Write "None" with a reason only
after review.>

## Stopping condition

<Objective completion evidence. Also state the blocker condition that requires
stopping rather than guessing or expanding scope.>

## Handoff

<Current checkpoint, verified evidence, unresolved items, and safest next
action.>
````

## Maintenance rules

- Record facts and discoveries in the plan; put durable decisions in an ADR and
  unresolved choices in `docs/roadmap/STATUS.md`.
- Never mark a checkpoint or plan complete before its evidence passes.
- Add explicit compatibility, rollback, documentation, and generated-fixture
  checkpoints when they apply.
- Update `docs/roadmap/HANDOFF.md` before stopping cross-session work.
- Do not create plans for hypothetical milestones or use a plan to authorize
  work outside the user's task.
