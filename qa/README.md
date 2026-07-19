# QA audit trail

Per PLAN.md §8.3, every milestone ends with a three-reviewer gate (QA
Reviewer, Security Reviewer, User Tester) plus a Global Tester run of the
full suite. Each milestone gets a directory `M<n>/` containing:

- `qa-report.md` — QA Reviewer findings (correctness/spec audit)
- `security-report.md` — Security Reviewer findings
- `user-test-report.md` — User Tester findings (real end-to-end play)
- `signoff.md` — final state: every finding listed with its fix commit and
  covering test; all three reviewers' sign-off; Global Tester full-suite
  result.

A milestone is cleared only when all findings are fixed (no severity
threshold), each fix has a covering test, and the Global Tester run is green.
