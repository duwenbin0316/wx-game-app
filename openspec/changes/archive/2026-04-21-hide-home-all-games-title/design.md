## Context

The home page currently renders a title, subtitle, and a game list with a section label reading “全部游戏”. The label is redundant because the page already makes it clear that the cards are the available game entry points.

This change is isolated to the mini program home page UI. It does not affect routing, game data, or any cloud functionality.

## Goals / Non-Goals

**Goals:**
- Remove the “全部游戏” label from the home page.
- Keep the existing game list, navigation behavior, and page structure intact.
- Avoid unnecessary layout changes beyond what is needed to remove the label.

**Non-Goals:**
- Redesign the home page layout.
- Change the list of games or their URLs.
- Add new sections, filters, or dynamic content.

## Decisions

- Remove the label directly from `miniprogram/pages/home/index.wxml` instead of replacing it with another header.
  - Rationale: the user asked to stop showing “全部游戏”, and the current page already has enough context.
  - Alternatives considered: swap in a new label like “选择游戏” or restructure the section entirely. Both add design scope without solving a real problem.

- Leave the game list data in `index.js` unchanged.
  - Rationale: the request is purely presentational; changing the data model would add risk with no benefit.
  - Alternatives considered: filter or reorganize the list. That would be a behavior change, not a copy cleanup.

- Keep the existing `.section-label` style unless layout review shows spacing needs a small adjustment.
  - Rationale: removing the node should be enough; deleting styles can wait until they are actually unused.
  - Alternatives considered: immediate CSS cleanup. That is optional and can be done later if the class becomes dead code.

## Risks / Trade-offs

- [Risk] Removing the label may leave slightly more vertical space than desired if the list spacing was tuned around it. → Mitigation: inspect the home page after the change and only trim spacing if the layout feels unbalanced.
- [Risk] The unused `.section-label` style may remain in WXSS. → Mitigation: leave it for now to minimize scope, then remove it in a follow-up cleanup if desired.

## Migration Plan

1. Remove the label from the home page template.
2. Verify the home page still renders the game cards and navigation works.
3. If spacing looks off, make a minimal WXSS adjustment.
4. Rollback is trivial: restore the removed label if the page loses needed context.

## Open Questions

None.
