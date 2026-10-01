# Coding standards

Read during review. Each rule is a judgement call no automated check can make.

## End-to-end tests

- Every assertion can go red today: name the break in the app that would fail it. An assertion that compares two empty values, or guards a feature that doesn't exist yet, waits for the ticket that brings the feature.
- A test's name promises only what its assertions check.
- Each test launches the app itself (`relaunch`), so it passes alone and in any order.
- Tests observe only what a user or caller can, and the app carries no code that exists only for tests (#29 → Testing Decisions → What makes a good test).
- Tests find elements as a user does: by role (`[role=toolbar]`, a paragraph), accessible name, or visible text, never by class or component structure. Finding one by its position (the toolbar's last button) is fine when the test's name promises that position.
